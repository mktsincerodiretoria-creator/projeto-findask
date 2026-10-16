"""Dicionário de palavras: o que o reconhecimento de voz costuma errar -> como deve ficar.

Ex.: "chopi", "xopi" -> "Shopee". Vale na transcrição (o Whisper também recebe a palavra
certa como dica) e na legenda, inclusive em projetos antigos, sem precisar transcrever de novo.
Você acrescenta palavras em ⚙ Configurações (uma por linha: "Certo = errado1, errado2").
"""
from __future__ import annotations

import re
import unicodedata

from . import projetos

VOCABULARIO_PADRAO = "Shopee = chopi, chopee, chopí, chópi, xopi, xopee, xópi, shopi, shoppe, shoppee, shopy, chopy"


def _chave(texto: str) -> str:
    """Minúsculas, sem acento e sem pontuação: "Chópi," -> "chopi"."""
    sem = "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", sem)


def texto_configurado() -> str:
    return projetos.config_app().get("vocabulario", VOCABULARIO_PADRAO)


def ler(texto: str) -> dict[str, str]:
    """{"chopi": "Shopee", "shopee": "Shopee", ...} a partir das linhas "Certo = errado, errado"."""
    mapa = {}
    for linha in (texto or "").splitlines():
        if "=" not in linha:
            continue
        certo, _, errados = linha.partition("=")
        certo = certo.strip()
        if not certo:
            continue
        for e in [certo, *errados.split(",")]:
            k = _chave(e)
            if k:
                mapa[k] = certo
    return mapa


def mapa() -> dict[str, str]:
    return ler(texto_configurado())


def palavras_certas() -> list[str]:
    return sorted(set(mapa().values()))


def corrigir_texto(texto: str, m: dict | None = None) -> str:
    """Troca a palavra mantendo a pontuação em volta ("chopi," -> "Shopee,")."""
    m = mapa() if m is None else m
    k = _chave(texto)
    if not k or k not in m:
        return texto
    antes = re.match(r"^\W*", texto).group(0)
    depois = re.search(r"\W*$", texto).group(0)
    return f"{antes}{m[k]}{depois}"


def corrigir_palavras(palavras: list[dict], m: dict | None = None) -> list[dict]:
    """Corrige cada palavra e junta pedaços que o Whisper separou ("cho" + "pi" -> "Shopee")."""
    m = mapa() if m is None else m
    if not m:
        return palavras
    saida, i = [], 0
    while i < len(palavras):
        p = palavras[i]
        if i + 1 < len(palavras):
            q = palavras[i + 1]
            junto = _chave(p["texto"]) + _chave(q["texto"])
            if junto in m and _chave(p["texto"]) not in m and q["inicio"] - p["fim"] < 0.3:
                depois = re.search(r"\W*$", q["texto"]).group(0)
                saida.append({**p, "texto": m[junto] + depois, "fim": q["fim"]})
                i += 2
                continue
        saida.append({**p, "texto": corrigir_texto(p["texto"], m)} if _chave(p["texto"]) in m else p)
        i += 1
    if len(saida) != len(palavras):
        saida = [{**p, "i": n} for n, p in enumerate(saida)]
    return saida
