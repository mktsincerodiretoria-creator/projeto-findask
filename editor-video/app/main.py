"""Servidor local do editor: API + interface web."""
from __future__ import annotations

import json
import os
import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analise, exportar, legendas, midia, projetos, transcricao

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
        projetos.atualizar(
            pid, cortes=sorted(cortes + manuais, key=lambda c: c["inicio"]),
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
def status():
    return {
        "ffmpeg": midia.ffmpeg_disponivel(),
        "ia_disponivel": _ia_disponivel(),
        "modelos": transcricao.MODELOS,
        "config_padrao": analise.CONFIG_PADRAO,
        "estilo_padrao": legendas.ESTILO_PADRAO,
        "exportacao_padrao": exportar.OPCOES_PADRAO,
    }


class ConfigApp(BaseModel):
    anthropic_api_key: str = ""


@app.post("/api/config")
def salvar_config(cfg: ConfigApp):
    atual = projetos.config_app()
    atual["anthropic_api_key"] = cfg.anthropic_api_key.strip()
    projetos.salvar_config_app(atual)
    return {"ia_disponivel": _ia_disponivel()}


@app.get("/api/projetos")
def listar_projetos():
    return projetos.listar()


@app.post("/api/projetos")
async def novo_projeto(arquivo: UploadFile = File(...), config: str = Form("{}")):
    nome = Path(arquivo.filename or "video.mp4").name
    extensao = Path(nome).suffix.lower()
    if extensao not in EXTENSOES:
        raise HTTPException(400, f"Formato {extensao or 'desconhecido'} não suportado.")
    pid, p = projetos.criar(nome, extensao)
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
    projetos.salvar(pid, dados)
    return _com_resumo(dados)


@app.get("/api/projetos/{pid}/legendas")
def legendas_previa(pid: str):
    dados = _projeto_ou_404(pid)
    if not dados.get("meta"):
        return []
    return legendas.montar_blocos(
        dados["palavras"], dados["cortes"], dados["meta"]["duracao"], dados.get("estilo_legenda")
    )


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


app.mount("/", StaticFiles(directory=ESTATICOS, html=True), name="estaticos")
