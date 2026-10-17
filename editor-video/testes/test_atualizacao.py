"""Atualização: componentes novos são instalados antes de reiniciar (sem a página cair)."""
import hashlib
import importlib
import json
import subprocess

import pytest

from app import atualizacao


@pytest.fixture()
def instalacao(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    from app import projetos
    importlib.reload(projetos)
    raiz = tmp_path / "CorteFacil"
    (raiz / "ferramentas").mkdir(parents=True)
    (raiz / "app").mkdir()
    (raiz / "requirements.txt").write_text("fastapi==1\n")
    (raiz / "app" / "a.py").write_text("velho = 1\n")
    monkeypatch.setattr(atualizacao, "RAIZ", raiz)
    remoto = {"requirements.txt": b"fastapi==1\nopencv-python-headless==5\n", "app/a.py": b"novo = 2\n"}
    manifesto = {"versao": "9.9.9", "arquivos": {k: atualizacao.hash_conteudo(k, v) for k, v in remoto.items()}}
    def baixar(url, timeout=20):
        nome = url.split("/editor-video/")[-1]
        return json.dumps(manifesto).encode() if nome == "versao.json" else remoto[nome]
    monkeypatch.setattr(atualizacao, "_baixar", baixar)
    monkeypatch.delenv("CF_SEM_PIP", raising=False)
    return raiz, remoto


def test_instala_componentes_novos_antes_de_trocar_os_arquivos(instalacao, monkeypatch):
    raiz, remoto = instalacao
    chamadas = []
    def pip(cmd, **kw):
        chamadas.append(cmd)
        assert (raiz / "app" / "a.py").read_text() == "velho = 1\n"   # ainda não trocou nada
        return subprocess.CompletedProcess(cmd, 0, "", "")
    monkeypatch.setattr(atualizacao.subprocess, "run", pip)
    r = atualizacao.aplicar()
    assert r["arquivos"] == 2 and chamadas and "pip" in chamadas[0]
    assert (raiz / "app" / "a.py").read_text() == "novo = 2\n"
    # carimbo do Windows: o instalar.ps1 não reinstala tudo de novo ao reabrir
    esperado = hashlib.sha256(remoto["requirements.txt"]).hexdigest().upper()
    assert (raiz / "ferramentas" / "pacotes.ok").read_text() == esperado


def test_se_a_instalacao_falhar_nada_e_trocado(instalacao, monkeypatch):
    raiz, _ = instalacao
    monkeypatch.setattr(atualizacao.subprocess, "run",
                        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, "", "sem internet"))
    with pytest.raises(RuntimeError):
        atualizacao.aplicar()
    assert (raiz / "app" / "a.py").read_text() == "velho = 1\n"
    assert (raiz / "requirements.txt").read_text() == "fastapi==1\n"
