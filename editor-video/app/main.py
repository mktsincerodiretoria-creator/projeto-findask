"""Servidor local do editor: API + interface web."""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import (acesso, analise, atualizacao, audio, dividir, exportar, filtros, legendas, midia, movimento, projetos,
               transcricao, vocabulario)
from .versao import VERSAO

ESTATICOS = Path(__file__).resolve().parent.parent / "static"
EXTENSOES = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts", ".3gp"}

# Uma tarefa pesada por vez (transcrição e exportação usam toda a CPU).
fila = ThreadPoolExecutor(max_workers=1)
fila_previa = ThreadPoolExecutor(max_workers=1)   # cópia em alta qualidade do editor (não atrasa exportação)
fila_exportar = ThreadPoolExecutor(max_workers=1)   # exportar não espera a análise de outro vídeo
exportacoes: dict[str, dict] = {}   # exportações na fila ou rodando: pid -> {cancelar, ultimo, rodando, motivo}
PARADA_MAX = 600   # s sem andar: a exportação travou e é cancelada (libera exportar de novo)
previas_hd: dict[str, dict] = {}
TIPOS_VIDEO = {".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
               ".3gp": "video/3gpp", ".mts": "video/mp2t"}
fila_dividir = ThreadPoolExecutor(max_workers=1)   # dividir vídeo em partes de até 28 MB
divisoes: dict[str, dict] = {}   # id -> como está a divisão (fica também no info.json da pasta)


@asynccontextmanager
async def ciclo_de_vida(_app):
    # Tarefas interrompidas quando o programa foi fechado não vão terminar sozinhas.
    for item in projetos.listar():
        dados = projetos.carregar(item["id"])
        mudou = False
        if dados["status"] in ("processando", "na_fila", "enviado"):
            dados.update(status="erro", erro="O processamento foi interrompido. Clique em Analisar de novo.")
            mudou = True
        if (dados.get("tarefa") or {}).get("status") in ("rodando", "na_fila"):
            dados["tarefa"] = {**dados["tarefa"], "status": "erro", "erro": "Exportação interrompida."}
            mudou = True
        if mudou:
            projetos.salvar(item["id"], dados)
    yield


app = FastAPI(title="CorteFácil", lifespan=ciclo_de_vida)
PORTA = int(os.environ.get("PORTA", "8765"))


@app.middleware("http")
async def proteger(request: Request, chamar):
    # Pedido de escrita vindo de outro site aberto no navegador: recusa.
    origem = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origem and origem.split("://")[-1] != request.headers.get("host"):
        return JSONResponse({"detail": "Origem não permitida."}, status_code=403)
    caminho = request.url.path
    cliente = request.client.host if request.client else ""
    quem = acesso.usuario(cliente, request.cookies.get(acesso.COOKIE))
    request.state.usuario = quem
    if quem and not quem["admin"]:
        # Cada pessoa só enxerga os próprios projetos.
        partes = caminho.split("/")
        if len(partes) > 3 and partes[1:3] == ["api", "projetos"] and partes[3]:
            try:
                dono = projetos.dono_de(projetos.carregar(partes[3]))
            except KeyError:
                dono = None
            if dono != quem["login"]:
                return JSONResponse({"detail": "Projeto não encontrado."}, status_code=404)
    if caminho in acesso.LIVRES or quem:
        resposta = await chamar(request)
        if not caminho.startswith("/api/"):
            # O navegador (principalmente o Safari do iPhone) guardava a versão antiga do
            # app.js/estilo.css depois de uma atualização: sempre confere se mudou.
            resposta.headers.setdefault("Cache-Control", "no-cache")
        return resposta
    if caminho.startswith("/api/"):
        return JSONResponse({"detail": "Digite a senha do CorteFácil."}, status_code=401)
    return RedirectResponse("/entrar.html")


def _usuario(request: Request) -> dict:
    return getattr(request.state, "usuario", None) or {"login": None, "admin": False}


def _so_admin(request: Request):
    if not _usuario(request)["admin"]:
        raise HTTPException(403, "Só o dono do CorteFácil (admin) pode fazer isso.")


def _chave_ia() -> Optional[str]:
    return projetos.config_app().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")


def _ia_disponivel() -> bool:
    return bool(_chave_ia() or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _projeto_ou_404(pid: str) -> dict:
    try:
        return projetos.carregar(pid)
    except KeyError:
        raise HTTPException(404, "Projeto não encontrado.")


def _com_resumo(dados: dict) -> dict:
    if dados.get("meta"):
        dados["resumo"] = analise.resumo(dados["cortes"], dados["meta"]["duracao"])
    ativa = exportacoes.get(dados.get("id"))
    tarefa = dados.get("tarefa") or {}
    if ativa:
        dados["tarefa"] = _andamento(ativa)
    elif tarefa.get("status") in ("rodando", "na_fila"):
        # ficou marcada como "rodando" mas não tem nada rodando: não pode travar o botão Exportar
        dados["tarefa"] = {**tarefa, "status": "erro", "erro": "A exportação foi interrompida. Clique em Exportar agora."}
    return dados


def _andamento(ativa: dict) -> dict:
    """Como está a exportação agora (fica na memória: atualizar o arquivo a cada passo é que dava
    erro no Windows). "parada" = segundos sem andar."""
    agora = time.monotonic()
    if not ativa.get("rodando"):
        return {"tipo": "exportar", "status": "na_fila", "progresso": 0.0, "decorrido": 0, "parada": 0}
    return {"tipo": "exportar", "status": "rodando", "progresso": ativa.get("progresso", 0.0),
            "decorrido": round(agora - ativa["inicio"]), "parada": round(agora - ativa["ultimo"]),
            "limite": PARADA_MAX}


# ---------------------------------------------------------------- tarefas em segundo plano

def _etapa(pid, etapa, progresso):
    projetos.atualizar(pid, status="processando", etapa=etapa, progresso=round(progresso, 3))


def _cortes_automaticos(pid, dados, amostras, cfg):
    db = midia.energia_db(amostras)
    periodico = midia.periodicidade_salva(amostras, projetos.pasta(pid) / "periodicidade.npy")
    return analise.analisar(dados["palavras"], db, midia.PASSO_ENERGIA, dados["meta"]["duracao"], cfg, periodico)


def processar(pid: str, retranscrever: bool = True):
    try:
        dados = projetos.carregar(pid)
        p = projetos.pasta(pid)
        original = p / dados["original"]
        cfg = {**analise.CONFIG_PADRAO, **dados.get("config", {})}

        _etapa(pid, "Lendo o vídeo", 0.01)
        meta = midia.sondar(original)
        if not meta["tem_audio"]:
            raise ValueError("Este vídeo não tem áudio — não há fala para analisar.")
        projetos.atualizar(pid, meta=meta)

        if not (p / "previa.mp4").exists():
            _etapa(pid, "Preparando a prévia", 0.03)
            midia.gerar_previa(original, p / "previa.mp4", meta)
        if not (p / "audio.wav").exists():
            _etapa(pid, "Extraindo o áudio", 0.12)
            midia.extrair_audio(original, p / "audio.wav")

        amostras = midia.ler_wav(p / "audio.wav")
        (p / "onda.json").write_text(json.dumps(midia.forma_de_onda(amostras)))

        palavras = dados.get("palavras") or []
        if retranscrever or not palavras:
            _etapa(pid, "Carregando o reconhecimento de voz", 0.15)
            palavras = transcricao.transcrever(
                p / "audio.wav", cfg.get("modelo", "small"), cfg.get("idioma", "pt"),
                progresso=lambda f: _etapa(pid, "Transcrevendo a fala", 0.15 + 0.7 * f),
            )
            projetos.atualizar(pid, palavras=palavras)

        _etapa(pid, "Procurando silêncios e erros", 0.86)
        dados = projetos.carregar(pid)
        cortes = _cortes_automaticos(pid, dados, amostras, cfg)
        comentario = ""
        if cfg.get("usar_ia") and _ia_disponivel():
            _etapa(pid, "Revisão inteligente com IA", 0.9)
            from . import ia
            try:
                cortes_ia, comentario = ia.revisar(palavras, _chave_ia())
                cortes = ia.mesclar(cortes, cortes_ia)
            except Exception as e:  # noqa: BLE001 - sem IA o editor continua funcionando
                traceback.print_exc()
                comentario = f"A revisão com IA falhou ({e}). Os cortes automáticos continuam valendo."
        manuais = [c for c in dados.get("cortes", []) if c.get("origem") == "manual"]
        cortes = sorted(cortes + manuais, key=lambda c: c["inicio"])

        # Rosto e zooms automáticos: se falhar, o resto da edição continua valendo.
        _etapa(pid, "Procurando o rosto para o enquadramento", 0.94)
        try:
            if movimento.carregar_trilha(p) is None:
                amostras = movimento.detectar_rosto(p / "previa.mp4", meta["largura"], meta["altura"],
                                                    duracao=meta["duracao"])
                movimento.salvar_trilha(p, movimento.suavizar(amostras))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        mov = movimento.refazer_automaticos(dados.get("movimento"), palavras, cortes, meta["duracao"])
        projetos.atualizar(
            pid, cortes=cortes, movimento=mov,
            comentario_ia=comentario, status="pronto", etapa="Pronto", progresso=1.0, erro=None,
        )
    except Exception as e:  # noqa: BLE001 - qualquer falha vira mensagem para a pessoa
        traceback.print_exc()
        projetos.atualizar(pid, status="erro", erro=str(e) or e.__class__.__name__)


def _cancelar_paradas():
    """Exportação que passa 10 minutos sem andar travou: é cancelada e o botão Exportar volta."""
    agora = time.monotonic()
    for ativa in list(exportacoes.values()):
        if ativa.get("rodando") and agora - ativa["ultimo"] > PARADA_MAX:
            ativa["motivo"] = "A exportação parou de andar e foi cancelada. Clique em Exportar agora para tentar de novo."
            ativa["cancelar"].set()


def _vigiar_exportacoes():
    while True:
        time.sleep(20)
        _cancelar_paradas()


threading.Thread(target=_vigiar_exportacoes, daemon=True).start()


def tarefa_exportar(pid: str, opcoes: dict):
    ativa = exportacoes.get(pid)
    if ativa is None or ativa["cancelar"].is_set():   # cancelada enquanto esperava na fila
        if ativa is not None and exportacoes.get(pid) is ativa:
            exportacoes.pop(pid, None)
        return
    ativa.update(rodando=True, inicio=time.monotonic(), ultimo=time.monotonic(), progresso=0.0)

    def prog(f):
        ativa["ultimo"] = time.monotonic()
        ativa["progresso"] = round(f, 3)

    try:
        projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "rodando", "progresso": 0.0})
        dados = projetos.carregar(pid)
        p = projetos.pasta(pid)
        n = len(dados.get("exportacoes", [])) + 1
        resultado = exportar.exportar(
            p, p / dados["original"], dados["meta"], dados["palavras"], dados["cortes"],
            dados.get("estilo_legenda", {}), opcoes, f"video_editado_{n}", progresso=prog,
            filtro=dados.get("filtro"),
            mov=dados.get("movimento"), trilha=movimento.carregar_trilha(p),
            enq=dados.get("enquadramento"), cancelar=ativa["cancelar"], audio=dados.get("audio"),
        )
        dados = projetos.carregar(pid)
        dados["exportacoes"] = dados.get("exportacoes", []) + [resultado]
        dados["tarefa"] = {"tipo": "exportar", "status": "concluida", "progresso": 1.0, "resultado": resultado}
        projetos.salvar(pid, dados)
    except exportar.Cancelado:
        projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "cancelada",
                                        "erro": ativa.get("motivo") or "Exportação cancelada."})
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "erro", "erro": str(e)})
    finally:
        if exportacoes.get(pid) is ativa:
            exportacoes.pop(pid, None)


# ---------------------------------------------------------------- API

@app.get("/api/status")
def status(request: Request):
    return {
        "versao": VERSAO,
        "servidor": acesso.modo_servidor(),
        "local": acesso.local(request.client.host if request.client else ""),
        "usuario": _usuario(request) if acesso.modo_servidor() else None,
        "pendentes": acesso.pendentes() if acesso.modo_servidor() and _usuario(request)["admin"] else 0,
        "ffmpeg": midia.ffmpeg_disponivel(),
        "ia_disponivel": _ia_disponivel(),
        "vocabulario": vocabulario.texto_configurado(),
        "modelos": transcricao.MODELOS,
        "config_padrao": analise.CONFIG_PADRAO,
        "estilo_padrao": legendas.ESTILO_PADRAO,
        "audio_padrao": audio.AUDIO_PADRAO,
        "exportacao_padrao": exportar.OPCOES_PADRAO,
    }


class Entrada(BaseModel):
    senha: str
    usuario: str = ""


@app.post("/api/entrar")
def entrar(dados: Entrada):
    try:
        token = acesso.conferir_senha(dados.senha, dados.usuario)
    except acesso.ContaPendente:
        raise HTTPException(403, "Seu cadastro está esperando a aprovação do administrador. Tente mais tarde.")
    if not token:
        if acesso.modo_servidor():
            raise HTTPException(401, "Usuário ou senha errados. Depois de várias tentativas, espere 1 minuto.")
        raise HTTPException(401, "Senha errada. Confira a senha na tela do computador.")
    resposta = JSONResponse({"ok": True})
    resposta.set_cookie(acesso.COOKIE, token, max_age=30 * 24 * 3600, httponly=True, samesite="lax")
    return resposta


@app.post("/api/sair")
def sair():
    resposta = JSONResponse({"ok": True})
    resposta.delete_cookie(acesso.COOKIE)
    return resposta


# ---------------------------------------------------------------- contas de usuário (servidor)

def _so_no_servidor():
    if not acesso.modo_servidor():
        raise HTTPException(404, "Contas de usuário só existem no CorteFácil instalado no servidor.")


@app.get("/api/usuarios")
def listar_usuarios(request: Request):
    _so_no_servidor()
    _so_admin(request)
    contagem: dict[str, int] = {}
    for item in projetos.listar():
        contagem[item["dono"]] = contagem.get(item["dono"], 0) + 1
    lista = [{"login": acesso.ADMIN, "admin": True, "projetos": contagem.get(acesso.ADMIN, 0)}]
    for login, u in sorted(acesso.usuarios().items(), key=lambda kv: (not kv[1].get("pendente"), kv[0])):
        lista.append({"login": login, "admin": False, "projetos": contagem.get(login, 0),
                      "nome": u.get("nome", ""), "pendente": bool(u.get("pendente")),
                      "criado_em": u.get("criado_em")})
    return lista


class Cadastro(BaseModel):
    nome: str = ""
    login: str
    senha: str


@app.get("/api/modo")
def modo():
    """Para a tela de entrada saber se mostra "Criar conta" (só no servidor)."""
    return {"servidor": acesso.modo_servidor()}


@app.post("/api/cadastro")
def pedir_cadastro(pedido: Cadastro):
    """A pessoa cria a própria conta; ela só entra depois que o admin aceitar."""
    _so_no_servidor()
    if len(pedido.nome.strip()) < 2:
        raise HTTPException(400, "Digite o seu nome.")
    try:
        acesso.criar_usuario(pedido.login, pedido.senha, nome=pedido.nome, pendente=True)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.post("/api/usuarios/{login}/aprovar")
def aprovar_usuario(login: str, request: Request):
    _so_no_servidor()
    _so_admin(request)
    try:
        acesso.aprovar_usuario(login)
    except KeyError:
        raise HTTPException(404, "Usuário não encontrado.")
    return {"ok": True}


class NovoUsuario(BaseModel):
    login: str
    senha: str


@app.post("/api/usuarios")
def criar_usuario(novo: NovoUsuario, request: Request):
    _so_no_servidor()
    _so_admin(request)
    try:
        acesso.criar_usuario(novo.login, novo.senha)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"login": acesso.normalizar_login(novo.login)}


class NovaSenha(BaseModel):
    senha: str
    atual: str = ""


@app.post("/api/usuarios/{login}/senha")
def redefinir_senha(login: str, pedido: NovaSenha, request: Request):
    _so_no_servidor()
    _so_admin(request)
    if login == acesso.ADMIN:
        raise HTTPException(400, "A senha do admin é a CF_SENHA: troque no painel (EasyPanel → Environment).")
    try:
        acesso.trocar_senha_usuario(login, pedido.senha)
    except KeyError:
        raise HTTPException(404, "Usuário não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.delete("/api/usuarios/{login}")
def remover_usuario(login: str, request: Request):
    _so_no_servidor()
    _so_admin(request)
    if login == acesso.ADMIN:
        raise HTTPException(400, "O admin não pode ser removido.")
    try:
        acesso.remover_usuario(login)
    except KeyError:
        raise HTTPException(404, "Usuário não encontrado.")
    # Os vídeos da pessoa não somem: passam para o admin.
    for item in projetos.listar():
        if item["dono"] == login:
            projetos.atualizar(item["id"], dono=acesso.ADMIN)
    return {"ok": True}


@app.post("/api/minha-senha")
def trocar_minha_senha(pedido: NovaSenha, request: Request):
    _so_no_servidor()
    quem = _usuario(request)
    if quem["login"] in (None, acesso.ADMIN):
        raise HTTPException(400, "A senha do admin é a CF_SENHA: troque no painel (EasyPanel → Environment).")
    if not acesso.conferir_senha(pedido.atual, quem["login"]):
        raise HTTPException(400, "A senha atual não confere.")
    try:
        acesso.trocar_senha_usuario(quem["login"], pedido.senha)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # A senha mudou: entrega o cookie novo para continuar conectado neste aparelho.
    resposta = JSONResponse({"ok": True})
    resposta.set_cookie(acesso.COOKIE, acesso.token_usuario(quem["login"]),
                        max_age=30 * 24 * 3600, httponly=True, samesite="lax")
    return resposta


def _so_no_computador(request: Request):
    if not acesso.local(request.client.host if request.client else ""):
        raise HTTPException(403, "Isso só pode ser mudado no computador.")


@app.get("/api/celular")
def info_celular(request: Request):
    _so_no_computador(request)
    cfg = acesso.config()
    ativo = bool(cfg.get("celular"))
    endereco = f"http://{acesso.ip_da_rede()}:{PORTA}"
    # "escutando" = o servidor já foi reiniciado aceitando conexões da rede.
    return {
        "ativo": ativo,
        "escutando": os.environ.get("CF_HOST") == "0.0.0.0",
        "endereco": endereco,
        "senha": cfg.get("senha_celular", "") if ativo else "",
        "qr": acesso.qr_svg(endereco) if ativo else "",
    }


class PedidoCelular(BaseModel):
    ativo: bool


@app.post("/api/celular")
def mudar_celular(pedido: PedidoCelular, request: Request):
    _so_no_computador(request)
    if _ocupado():
        raise HTTPException(409, "Espere a análise ou a exportação terminar.")
    acesso.ativar(pedido.ativo)
    # O servidor precisa reabrir escutando (ou não) a rede: reinicia pelo código 42.
    projetos.RAIZ.mkdir(parents=True, exist_ok=True)
    (projetos.RAIZ / ".reiniciando").write_text("celular")
    threading.Timer(1.0, lambda: os._exit(42)).start()
    return {"ok": True}


@app.post("/api/celular/nova-senha")
def trocar_senha_celular(request: Request):
    _so_no_computador(request)
    return {"senha": acesso.nova_senha()}


class ConfigApp(BaseModel):
    anthropic_api_key: Optional[str] = None
    vocabulario: Optional[str] = None


@app.post("/api/config")
def salvar_config(cfg: ConfigApp, request: Request):
    _so_admin(request)
    atual = projetos.config_app()
    if cfg.anthropic_api_key is not None:
        atual["anthropic_api_key"] = cfg.anthropic_api_key.strip()
    if cfg.vocabulario is not None:
        atual["vocabulario"] = cfg.vocabulario.strip()[:5000]
    projetos.salvar_config_app(atual)
    return {"ia_disponivel": _ia_disponivel()}


@app.get("/api/projetos")
def listar_projetos(request: Request):
    quem = _usuario(request)
    itens = projetos.listar()
    if not quem["admin"]:
        itens = [i for i in itens if i["dono"] == quem["login"]]
    for item in itens:   # exportação rodando aparece na lista ("Exportando 45%")
        if item["id"] in exportacoes:
            item["exportacao"] = _andamento(exportacoes[item["id"]])
    return itens


@app.post("/api/projetos")
async def novo_projeto(request: Request, arquivo: UploadFile = File(...), config: str = Form("{}")):
    nome = Path(arquivo.filename or "video.mp4").name
    extensao = Path(nome).suffix.lower()
    if extensao not in EXTENSOES:
        raise HTTPException(400, f"Formato {extensao or 'desconhecido'} não suportado.")
    pid, p = projetos.criar(nome, extensao, dono=_usuario(request)["login"])
    with open(p / f"original{extensao}", "wb") as destino:
        while bloco := await arquivo.read(8 * 1024 * 1024):
            destino.write(bloco)
    cfg = {**analise.CONFIG_PADRAO, **json.loads(config or "{}")}
    mudancas = {"config": cfg, "status": "na_fila", "etapa": "Na fila"}
    if cfg.pop("legenda", True) is False:
        # "Legenda" desmarcada ao subir: o vídeo já abre e exporta sem legenda (o CC liga depois)
        mudancas["estilo_legenda"] = {"ativa": False}
    projetos.atualizar(pid, **mudancas)
    fila.submit(processar, pid, True)
    return {"id": pid}


@app.get("/api/projetos/{pid}")
def obter_projeto(pid: str):
    dados = _com_resumo(_projeto_ou_404(pid))
    dados["ia_disponivel"] = _ia_disponivel()
    return dados


@app.delete("/api/projetos/{pid}")
def apagar_projeto(pid: str):
    _projeto_ou_404(pid)
    projetos.apagar(pid)
    return {"ok": True}


@app.get("/api/projetos/{pid}/onda")
def onda(pid: str):
    arq = projetos.pasta(pid) / "onda.json"
    if not arq.exists():
        raise HTTPException(404, "Forma de onda ainda não gerada.")
    return FileResponse(arq, media_type="application/json")


@app.get("/api/projetos/{pid}/previa")
def previa(pid: str):
    arq = projetos.pasta(pid) / "previa.mp4"
    if not arq.exists():
        raise HTTPException(404, "Prévia ainda não gerada.")
    return FileResponse(arq, media_type="video/mp4")


TIPOS_AUDIO = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav",
               ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac"}


@app.post("/api/projetos/{pid}/musica")
async def enviar_musica(pid: str, arquivo: UploadFile = File(...)):
    """Música de fundo do vídeo (fica na pasta do projeto como "musica.mp3", "musica.m4a"...)."""
    dados = _projeto_ou_404(pid)
    nome = Path(arquivo.filename or "musica.mp3").name
    extensao = Path(nome).suffix.lower()
    if extensao not in audio.EXTENSOES_MUSICA:
        raise HTTPException(400, "Use uma música em MP3, M4A, WAV, OGG ou FLAC.")
    p = projetos.pasta(pid)
    for velha in p.glob("musica.*"):
        velha.unlink(missing_ok=True)
    with open(p / f"musica{extensao}", "wb") as destino:
        tamanho = 0
        while bloco := await arquivo.read(4 * 1024 * 1024):
            tamanho += len(bloco)
            if tamanho > 200 * 1024 * 1024:
                destino.close()
                (p / f"musica{extensao}").unlink(missing_ok=True)
                raise HTTPException(400, "Música grande demais (máximo 200 MB).")
            destino.write(bloco)
    dados = projetos.carregar(pid)
    dados["audio"] = audio.normalizar({**(dados.get("audio") or {}), "musica": f"musica{extensao}", "musica_nome": nome})
    projetos.salvar(pid, dados)
    return dados["audio"]


@app.delete("/api/projetos/{pid}/musica")
def remover_musica(pid: str):
    dados = _projeto_ou_404(pid)
    for velha in projetos.pasta(pid).glob("musica.*"):
        velha.unlink(missing_ok=True)
    dados["audio"] = audio.normalizar({**(dados.get("audio") or {}), "musica": None, "musica_nome": ""})
    projetos.salvar(pid, dados)
    return dados["audio"]


@app.get("/api/projetos/{pid}/musica")
def ouvir_musica(pid: str):
    dados = _projeto_ou_404(pid)
    nome = audio.normalizar(dados.get("audio"))["musica"]
    arq = projetos.pasta(pid) / nome if nome else None
    if not arq or not arq.exists():
        raise HTTPException(404, "Este vídeo não tem música.")
    return FileResponse(arq, media_type=TIPOS_AUDIO.get(arq.suffix.lower(), "audio/mpeg"))


# ---------------------------------------------------------------- dividir vídeo em partes de até 28 MB

def _pasta_divisao(did: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", did):
        raise HTTPException(404, "Divisão não encontrada.")
    return projetos.RAIZ / "divisoes" / did


def _divisao(did: str, request: Request) -> dict:
    """A divisão (só quem enviou o vídeo vê; o dono do programa vê todas)."""
    info = divisoes.get(did)
    if info is None:
        arq = _pasta_divisao(did) / "info.json"
        if not arq.exists():
            raise HTTPException(404, "Divisão não encontrada.")
        info = json.loads(arq.read_text(encoding="utf-8"))
        if info["status"] in ("na_fila", "dividindo"):   # o programa foi fechado no meio
            info.update(status="erro", erro="A divisão foi interrompida. Escolha o vídeo de novo.")
    quem = _usuario(request)
    if not quem["admin"] and info.get("dono") != quem["login"]:
        raise HTTPException(404, "Divisão não encontrada.")
    return info


def _guardar_divisao(info: dict):
    (_pasta_divisao(info["id"]) / "info.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")


def _limpar_divisoes_velhas():
    """As partes ficam um dia guardadas (já baixou, não precisa ocupar o disco)."""
    agora = time.time()
    for did, info in list(divisoes.items()):
        if info["status"] not in ("na_fila", "dividindo") and agora - info["criado_em"] > 24 * 3600:
            divisoes.pop(did, None)
    pasta = projetos.RAIZ / "divisoes"
    for p in pasta.glob("*") if pasta.exists() else []:
        if p.is_dir() and agora - p.stat().st_mtime > 24 * 3600 and p.name not in divisoes:
            shutil.rmtree(p, ignore_errors=True)


def _apagar_sobras(pasta: Path):
    """Divisão que não terminou: apaga os pedaços (fica só o info.json, para mostrar o que houve)."""
    for arq in pasta.glob("*"):
        if arq.name != "info.json":
            try:
                arq.unlink()
            except OSError:
                pass


def _tarefa_dividir(did: str):
    info = divisoes[did]
    pasta = _pasta_divisao(did)
    original = next(pasta.glob("original.*"))

    def andamento(f):
        info["progresso"] = round(f, 3)

    try:
        if info.get("cancelar"):
            raise dividir.Cancelado("Divisão cancelada.")
        info["status"] = "dividindo"
        info["partes"] = dividir.dividir(original, pasta, info["nome"], info["leve"], progresso=andamento,
                                         cancelado=lambda: info.get("cancelar"))
        info.update(status="pronto", progresso=1.0)
    except dividir.Cancelado:
        info.update(status="cancelada", partes=[])
    except Exception as e:  # noqa: BLE001 - vira mensagem para a pessoa
        traceback.print_exc()
        info.update(status="erro", erro=str(e)[-600:], partes=[])
    finally:
        try:
            projetos._insistir(lambda: original.unlink(missing_ok=True))   # o vídeo inteiro não precisa mais
        except OSError:
            pass
        if info["status"] != "pronto":
            _apagar_sobras(pasta)
        _guardar_divisao(info)


@app.post("/api/dividir")
async def nova_divisao(request: Request, arquivo: UploadFile = File(...), leve: str = Form("0")):
    nome = Path(arquivo.filename or "video.mp4").name
    extensao = Path(nome).suffix.lower()
    if extensao not in EXTENSOES:
        raise HTTPException(400, f"Formato {extensao or 'desconhecido'} não suportado.")
    _limpar_divisoes_velhas()
    did = uuid.uuid4().hex[:12]
    pasta = _pasta_divisao(did)
    pasta.mkdir(parents=True)
    with open(pasta / f"original{extensao}", "wb") as destino:
        while bloco := await arquivo.read(8 * 1024 * 1024):
            destino.write(bloco)
    info = {"id": did, "nome": nome, "dono": _usuario(request)["login"], "criado_em": time.time(),
            "leve": leve == "1", "status": "na_fila", "progresso": 0.0, "partes": [], "erro": None,
            "limite": dividir.LIMITE}
    divisoes[did] = info
    _guardar_divisao(info)
    fila_dividir.submit(_tarefa_dividir, did)
    return {"id": did}


@app.get("/api/dividir/{did}")
def estado_divisao(did: str, request: Request):
    return _divisao(did, request)


@app.delete("/api/dividir/{did}")
def cancelar_divisao(did: str, request: Request):
    """Rodando: cancela. Já terminou: apaga as partes do disco."""
    info = _divisao(did, request)
    if info["status"] in ("na_fila", "dividindo") and did in divisoes:
        divisoes[did]["cancelar"] = True
    else:
        divisoes.pop(did, None)
        shutil.rmtree(_pasta_divisao(did), ignore_errors=True)
    return {"ok": True}


@app.get("/api/dividir/{did}/{arquivo}")
def baixar_parte(did: str, arquivo: str, request: Request):
    info = _divisao(did, request)
    if arquivo not in {p["arquivo"] for p in info.get("partes", [])}:
        raise HTTPException(404, "Parte não encontrada.")
    return FileResponse(_pasta_divisao(did) / arquivo, media_type="video/mp4", filename=arquivo)


@app.get("/api/projetos/{pid}/original")
def video_original(pid: str):
    """O arquivo que você subiu: o editor no computador mostra a imagem na resolução cheia (até 4K)."""
    dados = _projeto_ou_404(pid)
    arq = projetos.pasta(pid) / dados["original"]
    if not arq.exists():
        raise HTTPException(404, "Arquivo original não encontrado.")
    # .mov do iPhone é o mesmo tipo de arquivo do .mp4: assim todo navegador tenta abrir
    return FileResponse(arq, media_type=TIPOS_VIDEO.get(arq.suffix.lower(), "video/mp4"))


def _gerar_previa_hd(pid: str):
    def andamento(f):
        previas_hd[pid] = {"status": "gerando", "progresso": round(f, 3)}
    try:
        dados = projetos.carregar(pid)
        p = projetos.pasta(pid)
        midia.gerar_previa_hd(p / dados["original"], p / "previa_hd.mp4", dados.get("meta"), andamento)
        previas_hd[pid] = {"status": "pronta", "progresso": 1.0}
    except Exception as e:  # noqa: BLE001 - sem a cópia o editor continua com a prévia leve
        traceback.print_exc()
        previas_hd[pid] = {"status": "erro", "progresso": 0.0, "erro": str(e)[-300:]}


def _estado_previa_hd(pid: str) -> dict:
    if (projetos.pasta(pid) / "previa_hd.mp4").exists():
        return {"status": "pronta", "progresso": 1.0}
    return previas_hd.get(pid, {"status": "nenhuma", "progresso": 0.0})


@app.post("/api/projetos/{pid}/previa-hd")
def pedir_previa_hd(pid: str):
    """Quando o navegador não toca o arquivo original, prepara uma cópia na mesma resolução."""
    dados = _projeto_ou_404(pid)
    if _estado_previa_hd(pid)["status"] in ("nenhuma", "erro") and dados.get("meta"):
        previas_hd[pid] = {"status": "gerando", "progresso": 0.0}
        fila_previa.submit(_gerar_previa_hd, pid)
    return _estado_previa_hd(pid)


@app.get("/api/projetos/{pid}/previa-hd/estado")
def estado_previa_hd(pid: str):
    _projeto_ou_404(pid)
    return _estado_previa_hd(pid)


@app.get("/api/projetos/{pid}/previa-hd")
def previa_hd(pid: str):
    arq = projetos.pasta(pid) / "previa_hd.mp4"
    if not arq.exists():
        raise HTTPException(404, "A cópia em alta qualidade ainda não está pronta.")
    return FileResponse(arq, media_type="video/mp4")


class PedidoAnalise(BaseModel):
    config: dict = {}
    retranscrever: bool = False


@app.post("/api/projetos/{pid}/analisar")
def reanalisar(pid: str, pedido: PedidoAnalise):
    dados = _projeto_ou_404(pid)
    if dados["status"] in ("processando", "na_fila"):
        raise HTTPException(409, "Este projeto já está sendo processado.")
    cfg = {**analise.CONFIG_PADRAO, **dados.get("config", {}), **pedido.config}
    projetos.atualizar(pid, config=cfg, status="na_fila", etapa="Na fila", progresso=0.0, erro=None)
    fila.submit(processar, pid, pedido.retranscrever)
    return {"ok": True}


@app.post("/api/projetos/{pid}/recalcular")
def recalcular(pid: str, pedido: PedidoAnalise):
    """Refaz só a detecção (sem transcrever de novo): é instantâneo."""
    dados = _projeto_ou_404(pid)
    if dados["status"] != "pronto":
        raise HTTPException(409, "O projeto ainda não terminou de ser analisado.")
    cfg = {**analise.CONFIG_PADRAO, **dados.get("config", {}), **pedido.config}
    cortes = _cortes_automaticos(pid, dados, midia.ler_wav(projetos.pasta(pid) / "audio.wav"), cfg)
    mantidos = [c for c in dados["cortes"] if c.get("origem") in ("manual", "ia")]
    if any(c.get("origem") == "ia" for c in mantidos):
        from . import ia
        cortes = ia.mesclar(cortes, [c for c in mantidos if c["origem"] == "ia"])
        mantidos = [c for c in mantidos if c["origem"] == "manual"]
    dados = projetos.atualizar(pid, config=cfg, cortes=sorted(cortes + mantidos, key=lambda c: c["inicio"]))
    return _com_resumo(dados)


class Corte(BaseModel):
    id: str
    inicio: float
    fim: float
    tipo: str
    titulo: str = ""
    motivo: str = ""
    ativo: bool = True
    origem: str = "manual"
    palavras: Optional[list[int]] = None
    trecho: str = ""


class Edicao(BaseModel):
    cortes: Optional[list[Corte]] = None
    textos: Optional[dict[int, str]] = None   # índice da palavra -> texto corrigido
    estilo_legenda: Optional[dict] = None
    filtro: Optional[dict] = None             # {"id": "cinema", "intensidade": 0.8}
    movimento: Optional[dict] = None          # tracking, zoom base e lista de zooms
    enquadramento: Optional[dict] = None      # formato (9:16, 1:1...), escala, posição e giro
    audio: Optional[dict] = None              # melhorar voz, volume da música, whoosh


@app.put("/api/projetos/{pid}/edicao")
def salvar_edicao(pid: str, edicao: Edicao):
    dados = _projeto_ou_404(pid)
    if edicao.cortes is not None:
        dados["cortes"] = sorted(
            (c.model_dump() for c in edicao.cortes if c.fim > c.inicio), key=lambda c: c["inicio"]
        )
    if edicao.textos:
        for i, texto in edicao.textos.items():
            if 0 <= i < len(dados["palavras"]):
                dados["palavras"][i]["texto"] = texto.strip() or dados["palavras"][i]["texto"]
    if edicao.estilo_legenda is not None:
        dados["estilo_legenda"] = {**legendas.ESTILO_PADRAO, **edicao.estilo_legenda}
    if edicao.movimento is not None:
        dados["movimento"] = movimento.normalizar(edicao.movimento)
    if edicao.enquadramento is not None:
        dados["enquadramento"] = movimento.normalizar_enquadramento(edicao.enquadramento)
    if edicao.audio is not None:
        # o arquivo da música só muda pelo envio dela (nada de apontar para outro arquivo)
        novo = {k: v for k, v in edicao.audio.items() if k not in ("musica", "musica_nome")}
        dados["audio"] = audio.normalizar({**(dados.get("audio") or {}), **novo})
    if edicao.filtro is not None:
        fid = edicao.filtro.get("id", "natural")
        dados["filtro"] = {
            "id": fid if fid in filtros.FILTROS else "natural",
            "intensidade": min(1.0, max(0.0, float(edicao.filtro.get("intensidade", 1.0)))),
        }
    projetos.salvar(pid, dados)
    return _com_resumo(dados)


@app.get("/api/projetos/{pid}/legendas")
def legendas_previa(pid: str):
    dados = _projeto_ou_404(pid)
    if not dados.get("meta"):
        return []
    meta = dados["meta"]
    return legendas.montar_blocos(
        dados["palavras"], dados["cortes"], meta["duracao"], dados.get("estilo_legenda"),
        meta["largura"] / meta["altura"],
    )


_trava_quadros = threading.Lock()


@app.get("/api/projetos/{pid}/quadros")
def quadros(pid: str):
    """Miniaturas da linha do tempo (geradas na primeira vez que o projeto abre)."""
    dados = _projeto_ou_404(pid)
    p, meta = projetos.pasta(pid), dados.get("meta")
    if not meta or not (p / "previa.mp4").exists():
        raise HTTPException(404, "Prévia ainda não gerada.")
    with _trava_quadros:
        arq = p / "quadros.json"
        if not arq.exists() or not (p / "quadros.jpg").exists():
            return midia.gerar_quadros(p / "previa.mp4", p, meta["duracao"], meta["largura"], meta["altura"])
        return json.loads(arq.read_text())


@app.get("/api/projetos/{pid}/quadros.jpg")
def quadros_imagem(pid: str):
    arq = projetos.pasta(pid) / "quadros.jpg"
    if not arq.exists():
        raise HTTPException(404, "Miniaturas ainda não geradas.")
    return FileResponse(arq, media_type="image/jpeg")


# ---------------------------------------------------------------- filtros de cor

_trava_miniaturas = threading.Lock()


# ---------------------------------------------------------------- zoom e rosto

@app.get("/api/projetos/{pid}/movimento")
def obter_movimento(pid: str):
    dados = _projeto_ou_404(pid)
    trilha = movimento.carregar_trilha(projetos.pasta(pid))
    return {"movimento": movimento.normalizar(dados.get("movimento")), "trilha": trilha}


@app.post("/api/projetos/{pid}/rosto/detectar")
def detectar_rosto(pid: str):
    """Para projetos antigos (feitos antes do tracking existir)."""
    dados = _projeto_ou_404(pid)
    p, meta = projetos.pasta(pid), dados["meta"]
    trilha = movimento.suavizar(movimento.detectar_rosto(p / "previa.mp4", meta["largura"], meta["altura"],
                                                         duracao=meta["duracao"]))
    movimento.salvar_trilha(p, trilha)
    return {"trilha": trilha}


class PedidoZooms(BaseModel):
    movimento: dict


@app.post("/api/projetos/{pid}/movimento/automatico")
def refazer_zooms(pid: str, pedido: PedidoZooms):
    """Refaz os zooms automáticos com a sensibilidade/intensidade escolhidas (os manuais ficam)."""
    dados = _projeto_ou_404(pid)
    mov = movimento.refazer_automaticos(pedido.movimento, dados["palavras"], dados["cortes"],
                                        dados["meta"]["duracao"])
    projetos.atualizar(pid, movimento=mov)
    return mov


@app.get("/api/filtros")
def listar_filtros():
    return filtros.lista()


@app.get("/api/filtros/{fid}/lut")
def lut_filtro(fid: str):
    if fid not in filtros.FILTROS:
        raise HTTPException(404, "Filtro não encontrado.")
    return Response(filtros.bytes_para_navegador(fid), media_type="application/octet-stream",
                    headers={"Cache-Control": "max-age=3600"})


@app.get("/api/projetos/{pid}/filtros/{fid}.jpg")
def miniatura_filtro(pid: str, fid: str):
    dados = _projeto_ou_404(pid)
    if fid not in filtros.FILTROS:
        raise HTTPException(404, "Filtro não encontrado.")
    pasta = projetos.pasta(pid) / "miniaturas"
    with _trava_miniaturas:
        if not (pasta / f"{fid}.jpg").exists():
            filtros.gerar_miniaturas(projetos.pasta(pid) / "previa.mp4", pasta, dados["meta"]["duracao"] * 0.3)
    return FileResponse(pasta / f"{fid}.jpg", media_type="image/jpeg")


# ---------------------------------------------------------------- atualização

@app.get("/api/atualizacao")
def verificar_atualizacao():
    return atualizacao.verificar()


def _ocupado() -> bool:
    if exportacoes:
        return True
    for item in projetos.listar():
        if projetos.carregar(item["id"])["status"] in ("processando", "na_fila"):
            return True
    return False


@app.post("/api/atualizacao/aplicar")
def aplicar_atualizacao(request: Request):
    _so_admin(request)
    if _ocupado():
        raise HTTPException(409, "Espere a análise ou a exportação terminar antes de atualizar.")
    try:
        resultado = atualizacao.aplicar()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Não consegui atualizar: {e}")
    # Código 42 = "reinicie": o iniciar.bat abre o programa de novo já atualizado.
    projetos.RAIZ.mkdir(parents=True, exist_ok=True)
    (projetos.RAIZ / ".reiniciando").write_text(resultado["versao"])
    threading.Timer(1.0, lambda: os._exit(42)).start()
    return resultado


@app.post("/api/projetos/{pid}/exportar")
def iniciar_exportacao(pid: str, opcoes: dict):
    dados = _projeto_ou_404(pid)
    if dados["status"] != "pronto":
        raise HTTPException(409, "Espere a análise terminar antes de exportar.")
    if pid in exportacoes:
        raise HTTPException(409, "Já existe uma exportação em andamento.")
    exportacoes[pid] = {"cancelar": threading.Event(), "ultimo": time.monotonic(), "rodando": False}
    projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "na_fila", "progresso": 0.0})
    fila_exportar.submit(tarefa_exportar, pid, opcoes)
    return {"ok": True}


@app.post("/api/projetos/{pid}/exportar/cancelar")
def cancelar_exportacao(pid: str):
    _projeto_ou_404(pid)
    ativa = exportacoes.get(pid)
    if ativa:
        ativa["motivo"] = "Exportação cancelada."
        ativa["cancelar"].set()   # fecha o ffmpeg na hora
        if not ativa.get("rodando"):   # ainda esperando na fila: sai dela agora
            exportacoes.pop(pid, None)
            projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "cancelada", "erro": "Exportação cancelada."})
    return {"ok": True}


@app.get("/api/projetos/{pid}/arquivos/{nome}")
def baixar(pid: str, nome: str):
    dados = _projeto_ou_404(pid)
    permitidos = {v for e in dados.get("exportacoes", []) for k, v in e.items() if k in ("video", "legenda")}
    if nome not in permitidos:
        raise HTTPException(404, "Arquivo não encontrado.")
    return FileResponse(projetos.pasta(pid) / nome, filename=f"{Path(dados['nome']).stem}_{nome}")


def _pagina(nome: str) -> HTMLResponse:
    """Página com ?v=versão no CSS e no JS: depois de atualizar, ninguém fica com a cópia antiga."""
    html = (ESTATICOS / nome).read_text(encoding="utf-8")
    html = html.replace('href="estilo.css"', f'href="estilo.css?v={VERSAO}"')
    html = html.replace('src="app.js"', f'src="app.js?v={VERSAO}"')
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def pagina_inicial():
    return _pagina("index.html")


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifesto():
    return FileResponse(ESTATICOS / "manifest.webmanifest", media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(ESTATICOS / "sw.js", media_type="text/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(ESTATICOS / "icone.ico", media_type="image/x-icon")


@app.get("/entrar.html", include_in_schema=False)
def pagina_entrar():
    return _pagina("entrar.html")


app.mount("/", StaticFiles(directory=ESTATICOS, html=True), name="estaticos")
