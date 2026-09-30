"""Guarda cada projeto numa pasta própria: vídeo original, prévia, áudio e projeto.json."""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

RAIZ = Path(os.environ.get("EDITOR_DADOS", Path(__file__).resolve().parent.parent / "dados"))
PASTA_PROJETOS = RAIZ / "projetos"
ARQUIVO_CONFIG = RAIZ / "config.json"

_trava = threading.RLock()
_ID_VALIDO = re.compile(r"^[a-f0-9]{12}$")


def pasta(pid: str) -> Path:
    if not _ID_VALIDO.match(pid):
        raise KeyError(pid)
    return PASTA_PROJETOS / pid


def criar(nome: str, extensao: str) -> tuple[str, Path]:
    pid = uuid.uuid4().hex[:12]
    p = pasta(pid)
    p.mkdir(parents=True)
    dados = {
        "id": pid,
        "nome": nome,
        "criado_em": time.time(),
        "original": f"original{extensao}",
        "status": "enviado",
        "etapa": "Enviando",
        "progresso": 0.0,
        "erro": None,
        "meta": None,
        "config": {},
        "palavras": [],
        "cortes": [],
        "estilo_legenda": {},
        "comentario_ia": "",
        "exportacoes": [],
    }
    salvar(pid, dados)
    return pid, p


def carregar(pid: str) -> dict:
    arquivo = pasta(pid) / "projeto.json"
    if not arquivo.exists():
        raise KeyError(pid)
    with _trava:
        return json.loads(arquivo.read_text(encoding="utf-8"))


def salvar(pid: str, dados: dict) -> None:
    arquivo = pasta(pid) / "projeto.json"
    with _trava:
        tmp = arquivo.with_suffix(".tmp")
        tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        tmp.replace(arquivo)


def atualizar(pid: str, **campos) -> dict:
    with _trava:
        dados = carregar(pid)
        dados.update(campos)
        salvar(pid, dados)
        return dados


def listar() -> list[dict]:
    if not PASTA_PROJETOS.exists():
        return []
    itens = []
    for p in PASTA_PROJETOS.iterdir():
        try:
            d = carregar(p.name)
        except (KeyError, json.JSONDecodeError):
            continue
        itens.append({k: d.get(k) for k in ("id", "nome", "criado_em", "status", "etapa", "progresso", "meta")})
    return sorted(itens, key=lambda d: d["criado_em"], reverse=True)


def apagar(pid: str) -> None:
    shutil.rmtree(pasta(pid), ignore_errors=True)


def config_app() -> dict:
    if ARQUIVO_CONFIG.exists():
        return json.loads(ARQUIVO_CONFIG.read_text(encoding="utf-8"))
    return {}


def salvar_config_app(dados: dict) -> None:
    RAIZ.mkdir(parents=True, exist_ok=True)
    ARQUIVO_CONFIG.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
