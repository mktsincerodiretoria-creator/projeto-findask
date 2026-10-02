"""Servidor local do editor: API + interface web."""
from __future__ import annotations

import json
import os
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import acesso, analise, atualizacao, exportar, filtros, legendas, midia, movimento, projetos, transcricao
from .versao import VERSAO

ESTATICOS = Path(__file__).resolve().parent.parent / "static"
EXTENSOES = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts", ".3gp"}

# Uma tarefa pesada por vez (transcrição e exportação usam toda a CPU).
fila = ThreadPoolExecutor(max_workers=1)


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
    return dados


# ---------------------------------------------------------------- tarefas em segundo plano

def _etapa(pid, etapa, progresso):
    projetos.atualizar(pid, status="processando", etapa=etapa, progresso=round(progresso, 3))


def _cortes_automaticos(dados, db, cfg):
    return analise.analisar(dados["palavras"], db, midia.PASSO_ENERGIA, dados["meta"]["duracao"], cfg)


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
            midia.gerar_previa(original, p / "previa.mp4")
        if not (p / "audio.wav").exists():
            _etapa(pid, "Extraindo o áudio", 0.12)
            midia.extrair_audio(original, p / "audio.wav")

        amostras = midia.ler_wav(p / "audio.wav")
        (p / "onda.json").write_text(json.dumps(midia.forma_de_onda(amostras)))
        db = midia.energia_db(amostras)

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
        cortes = _cortes_automaticos(dados, db, cfg)
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


def tarefa_exportar(pid: str, opcoes: dict):
    def prog(f):
        projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "rodando", "progresso": round(f, 3)})

    try:
        prog(0.0)
        dados = projetos.carregar(pid)
        p = projetos.pasta(pid)
        n = len(dados.get("exportacoes", [])) + 1
        resultado = exportar.exportar(
            p, p / dados["original"], dados["meta"], dados["palavras"], dados["cortes"],
            dados.get("estilo_legenda", {}), opcoes, f"video_editado_{n}", progresso=prog,
            filtro=dados.get("filtro"),
            mov=dados.get("movimento"), trilha=movimento.carregar_trilha(p),
        )
        dados = projetos.carregar(pid)
        dados["exportacoes"] = dados.get("exportacoes", []) + [resultado]
        dados["tarefa"] = {"tipo": "exportar", "status": "concluida", "progresso": 1.0, "resultado": resultado}
        projetos.salvar(pid, dados)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "erro", "erro": str(e)})


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
        "modelos": transcricao.MODELOS,
        "config_padrao": analise.CONFIG_PADRAO,
        "estilo_padrao": legendas.ESTILO_PADRAO,
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
    anthropic_api_key: str = ""


@app.post("/api/config")
def salvar_config(cfg: ConfigApp, request: Request):
    _so_admin(request)
    atual = projetos.config_app()
    atual["anthropic_api_key"] = cfg.anthropic_api_key.strip()
    projetos.salvar_config_app(atual)
    return {"ia_disponivel": _ia_disponivel()}


@app.get("/api/projetos")
def listar_projetos(request: Request):
    quem = _usuario(request)
    itens = projetos.listar()
    if not quem["admin"]:
        itens = [i for i in itens if i["dono"] == quem["login"]]
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
    projetos.atualizar(pid, config=cfg, status="na_fila", etapa="Na fila")
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
    db = midia.energia_db(midia.ler_wav(projetos.pasta(pid) / "audio.wav"))
    cortes = _cortes_automaticos(dados, db, cfg)
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
    for item in projetos.listar():
        d = projetos.carregar(item["id"])
        if d["status"] in ("processando", "na_fila") or (d.get("tarefa") or {}).get("status") in ("rodando", "na_fila"):
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
    if (dados.get("tarefa") or {}).get("status") in ("rodando", "na_fila"):
        raise HTTPException(409, "Já existe uma exportação em andamento.")
    projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "na_fila", "progresso": 0.0})
    fila.submit(tarefa_exportar, pid, opcoes)
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


@app.get("/entrar.html", include_in_schema=False)
def pagina_entrar():
    return _pagina("entrar.html")


app.mount("/", StaticFiles(directory=ESTATICOS, html=True), name="estaticos")
