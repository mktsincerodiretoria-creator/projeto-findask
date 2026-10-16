"""Dicionário de palavras: "chopi" vira "Shopee" na transcrição e na legenda."""
import importlib

import pytest

from app import legendas, vocabulario


@pytest.fixture(autouse=True)
def dados_limpos(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    from app import projetos
    importlib.reload(projetos)
    importlib.reload(vocabulario)
    yield projetos


def pal(*textos):
    return [{"i": i, "texto": t, "inicio": i * 0.5, "fim": i * 0.5 + 0.4, "prob": 0.9} for i, t in enumerate(textos)]


def test_shopee_ja_vem_no_dicionario():
    for errado in ["Chopi", "chopi,", "Xopi.", "shopi", "Chópi!", "shoppe"]:
        assert vocabulario.corrigir_texto(errado).startswith("Shopee"), errado
    assert vocabulario.corrigir_texto("chopi,") == "Shopee,"
    assert vocabulario.corrigir_texto("chope") == "chope"          # não mexe em outras palavras


def test_junta_palavra_que_veio_partida():
    r = vocabulario.corrigir_palavras(pal("vendo", "na", "cho", "pi.", "hoje"))
    assert [p["texto"] for p in r] == ["vendo", "na", "Shopee.", "hoje"]
    assert [p["i"] for p in r] == [0, 1, 2, 3]
    assert r[2]["inicio"] == 1.0 and r[2]["fim"] == 1.9


def test_legenda_de_projeto_antigo_ja_sai_certa():
    blocos = legendas.montar_blocos(pal("compre", "na", "chopi"), [], 3.0, {"maiusculas": False, "modo": "frase"})
    assert "Shopee" in " ".join(b["texto"] for b in blocos)


def test_dicionario_personalizado(dados_limpos):
    dados_limpos.salvar_config_app({"vocabulario": "Shopee = chopi\nMercado Livre = mercadolivre"})
    assert vocabulario.corrigir_texto("mercadolivre") == "Mercado Livre"
    assert vocabulario.palavras_certas() == ["Mercado Livre", "Shopee"]
