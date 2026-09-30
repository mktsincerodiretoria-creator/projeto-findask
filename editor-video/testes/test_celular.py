"""Acesso pelo celular: senha obrigatória fora do computador, QR Code e proteções."""
import importlib

import pytest
from fastapi.testclient import TestClient

CELULAR = ("192.168.0.50", 50000)   # um aparelho na rede Wi-Fi


@pytest.fixture()
def app_teste(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    from app import projetos
    importlib.reload(projetos)
    from app import acesso, main
    importlib.reload(acesso)
    importlib.reload(main)
    acesso._tentativas.clear()
    return main, acesso


def test_computador_entra_sem_senha_e_celular_nao(app_teste):
    main, _ = app_teste
    pc = TestClient(main.app)
    cel = TestClient(main.app, client=CELULAR)
    assert pc.get("/api/projetos").status_code == 200
    assert cel.get("/api/projetos").status_code == 401
    r = cel.get("/", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/entrar.html"
    assert cel.get("/entrar.html").status_code == 200   # a página de senha abre


def test_senha_certa_libera_e_trocar_senha_desloga(app_teste):
    main, acesso = app_teste
    pc = TestClient(main.app)
    acesso.ativar(True)
    info = pc.get("/api/celular").json()
    assert info["ativo"] and len(info["senha"]) == 6 and info["qr"].startswith("<svg")
    assert info["endereco"].startswith("http://")

    cel = TestClient(main.app, client=CELULAR)
    assert cel.post("/api/entrar", json={"senha": "errada"}).status_code == 401
    assert cel.post("/api/entrar", json={"senha": info["senha"]}).status_code == 200
    assert cel.get("/api/projetos").status_code == 200

    pc.post("/api/celular/nova-senha")
    assert cel.get("/api/projetos").status_code == 401


def test_celular_desligado_nao_entra_nem_com_senha_antiga(app_teste):
    main, acesso = app_teste
    cfg = acesso.ativar(True)
    cel = TestClient(main.app, client=CELULAR)
    assert cel.post("/api/entrar", json={"senha": cfg["senha_celular"]}).status_code == 200
    c = acesso.config()
    c["celular"] = False
    acesso.projetos.salvar_config_app(c)
    assert cel.get("/api/projetos").status_code == 401


def test_muitas_tentativas_bloqueiam(app_teste):
    main, acesso = app_teste
    cfg = acesso.ativar(True)
    cel = TestClient(main.app, client=CELULAR)
    for _ in range(8):
        cel.post("/api/entrar", json={"senha": "000000" if cfg["senha_celular"] != "000000" else "111111"})
    # Mesmo a senha certa é recusada durante o bloqueio (1 minuto).
    assert cel.post("/api/entrar", json={"senha": cfg["senha_celular"]}).status_code == 401


def test_celular_nao_mexe_nas_configuracoes_do_computador(app_teste):
    main, acesso = app_teste
    cfg = acesso.ativar(True)
    cel = TestClient(main.app, client=CELULAR)
    cel.post("/api/entrar", json={"senha": cfg["senha_celular"]})
    assert cel.get("/api/celular").status_code == 403
    assert cel.post("/api/celular/nova-senha").status_code == 403


def test_outro_site_nao_consegue_mandar_comandos(app_teste):
    main, _ = app_teste
    pc = TestClient(main.app)
    r = pc.post("/api/config", json={"anthropic_api_key": "x"}, headers={"Origin": "https://site-malicioso.com"})
    assert r.status_code == 403
