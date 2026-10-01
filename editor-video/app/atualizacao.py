"""Atualização com um clique: baixa do GitHub só os arquivos que mudaram.

O manifesto ``versao.json`` (gerado pelo empacotar.py) lista cada arquivo do
programa com o seu SHA-256. Tudo é baixado e conferido antes de qualquer
arquivo ser trocado, então uma queda de internet no meio não deixa o programa
pela metade.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

from . import projetos
from .versao import PASTA, RAMO, REPO, VERSAO

RAIZ = Path(__file__).resolve().parent.parent
# O cmd.exe lê o .bat enquanto ele roda: trocar o arquivo no meio quebra a execução.
NAO_ATUALIZAR = {".bat"}
TEXTO = {".py", ".js", ".css", ".html", ".ps1", ".txt", ".json", ".md", ".sh"}


def hash_conteudo(caminho: str, dados: bytes) -> str:
    """SHA-256 ignorando a diferença de fim de linha (CRLF x LF) em arquivos de texto."""
    if PurePosixPath(caminho).suffix in TEXTO:
        dados = dados.replace(b"\r\n", b"\n")
    return hashlib.sha256(dados).hexdigest()


def _ramo() -> str:
    return projetos.config_app().get("ramo_atualizacao") or RAMO


def _url(ramo: str, caminho: str) -> str:
    return f"https://raw.githubusercontent.com/{REPO}/{ramo}/{PASTA}/{urllib.parse.quote(caminho)}"


def _baixar(url: str, timeout: float = 20) -> bytes:
    pedido = urllib.request.Request(url, headers={"User-Agent": "CorteFacil", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(pedido, timeout=timeout) as resposta:
        return resposta.read()


def _numero(v: str) -> tuple:
    return tuple(int(x) for x in v.split(".") if x.isdigit())


def _manifesto() -> dict:
    return json.loads(_baixar(_url(_ramo(), "versao.json")))


def verificar() -> dict:
    if os.environ.get("CF_CONTAINER"):
        # Num container os arquivos voltam ao original quando ele reinicia:
        # quem atualiza é o painel (EasyPanel: botão Deploy baixa a versão nova).
        return {"atual": VERSAO, "ha_atualizacao": False,
                "erro": "No servidor, atualize pelo botão Deploy do EasyPanel."}
    try:
        m = _manifesto()
    except Exception:  # noqa: BLE001 - sem internet não é erro para a pessoa
        return {"atual": VERSAO, "ha_atualizacao": False, "erro": "Sem conexão para procurar atualizações."}
    return {
        "atual": VERSAO,
        "disponivel": m["versao"],
        "novidades": m.get("novidades", []),
        "ha_atualizacao": _numero(m["versao"]) > _numero(VERSAO),
    }


def _destino_seguro(caminho: str) -> Path:
    p = PurePosixPath(caminho)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError(f"Caminho inválido no manifesto: {caminho}")
    return RAIZ.joinpath(*p.parts)


def aplicar() -> dict:
    ramo = _ramo()
    m = _manifesto()
    novos = {}
    for caminho, esperado in m["arquivos"].items():
        if PurePosixPath(caminho).suffix in NAO_ATUALIZAR:
            continue
        destino = _destino_seguro(caminho)
        if destino.exists() and hash_conteudo(caminho, destino.read_bytes()) == esperado:
            continue
        dados = _baixar(_url(ramo, caminho))
        if hash_conteudo(caminho, dados) != esperado:
            raise RuntimeError("A atualização ainda está sendo publicada. Tente de novo em alguns minutos.")
        novos[destino] = dados

    for destino, dados in novos.items():
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_name(destino.name + ".novo")
        tmp.write_bytes(dados)
        tmp.replace(destino)

    if m.get("ramo") and m["ramo"] != ramo:
        cfg = projetos.config_app()
        cfg["ramo_atualizacao"] = m["ramo"]
        projetos.salvar_config_app(cfg)
    return {"versao": m["versao"], "arquivos": len(novos)}
