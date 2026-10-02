"""Contas de usuário no servidor: cada pessoa vê só os próprios vídeos; o admin vê todos."""
import importlib

import pytest
from fastapi.testclient import TestClient

VIA_CADDY = ("127.0.0.1", 40000)


@pytest.fixture()
def servidor(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    monkeypatch.setenv("CF_SENHA", "senha-do-dono")
    from app import projetos
    importlib.reload(projetos)
    from app import acesso, main
    importlib.reload(acesso)
    importlib.reload(main)
    acesso._tentativas.clear()
    acesso._cadastros.clear()
    return main, acesso, projetos


def entrar(main, usuario, senha):
    c = TestClient(main.app, client=VIA_CADDY)
    r = c.post("/api/entrar", json={"usuario": usuario, "senha": senha})
    return c, r.status_code


def test_admin_entra_com_ou_sem_nome_e_cria_usuarios(servidor):
    main, _, _ = servidor
    admin, st = entrar(main, "", "senha-do-dono")
    assert st == 200
    assert entrar(main, "Admin", "senha-do-dono")[1] == 200
    assert admin.get("/api/status").json()["usuario"] == {"login": "admin", "admin": True}
    assert admin.post("/api/usuarios", json={"login": "Maria", "senha": "abc12345"}).json() == {"login": "maria"}
    assert admin.post("/api/usuarios", json={"login": "maria", "senha": "abc12345"}).status_code == 400
    assert admin.post("/api/usuarios", json={"login": "jo ão", "senha": "abc12345"}).status_code == 400
    assert admin.post("/api/usuarios", json={"login": "pedro", "senha": "123"}).status_code == 400
    assert [u["login"] for u in admin.get("/api/usuarios").json()] == ["admin", "maria"]

    maria, st = entrar(main, "maria", "abc12345")
    assert st == 200
    assert maria.get("/api/status").json()["usuario"] == {"login": "maria", "admin": False}
    assert entrar(main, "maria", "errada")[1] == 401
    # Usuário comum não administra.
    assert maria.get("/api/usuarios").status_code == 403
    assert maria.post("/api/usuarios", json={"login": "x1", "senha": "abc12345"}).status_code == 403
    assert maria.post("/api/config", json={"anthropic_api_key": "x"}).status_code == 403


def test_cada_um_ve_so_os_seus_projetos(servidor):
    main, _, projetos = servidor
    admin, _ = entrar(main, "", "senha-do-dono")
    admin.post("/api/usuarios", json={"login": "maria", "senha": "abc12345"})
    admin.post("/api/usuarios", json={"login": "joao", "senha": "abc12345"})
    pid_maria, _ = projetos.criar("maria.mp4", ".mp4", dono="maria")
    pid_joao, _ = projetos.criar("joao.mp4", ".mp4", dono="joao")
    pid_antigo, _ = projetos.criar("antigo.mp4", ".mp4")   # de antes das contas: é do admin

    maria, _ = entrar(main, "maria", "abc12345")
    assert [p["id"] for p in maria.get("/api/projetos").json()] == [pid_maria]
    assert maria.get(f"/api/projetos/{pid_maria}").status_code == 200
    for pid in (pid_joao, pid_antigo):
        assert maria.get(f"/api/projetos/{pid}").status_code == 404
        assert maria.delete(f"/api/projetos/{pid}").status_code == 404
        assert maria.get(f"/api/projetos/{pid}/previa").status_code == 404
    assert {p["id"] for p in admin.get("/api/projetos").json()} == {pid_maria, pid_joao, pid_antigo}
    assert admin.get(f"/api/projetos/{pid_joao}").status_code == 200


def test_nova_senha_e_remover_desconectam(servidor):
    main, _, projetos = servidor
    admin, _ = entrar(main, "", "senha-do-dono")
    admin.post("/api/usuarios", json={"login": "maria", "senha": "abc12345"})
    pid, _ = projetos.criar("maria.mp4", ".mp4", dono="maria")
    maria, _ = entrar(main, "maria", "abc12345")

    assert admin.post("/api/usuarios/maria/senha", json={"senha": "nova-senha-1"}).status_code == 200
    assert maria.get("/api/projetos").status_code == 401
    maria, st = entrar(main, "maria", "nova-senha-1")
    assert st == 200

    # Ela mesma troca a senha e continua conectada.
    assert maria.post("/api/minha-senha", json={"atual": "errada", "senha": "outra-123"}).status_code == 400
    assert maria.post("/api/minha-senha", json={"atual": "nova-senha-1", "senha": "outra-123"}).status_code == 200
    assert maria.get("/api/projetos").status_code == 200

    assert admin.delete("/api/usuarios/maria").status_code == 200
    assert maria.get("/api/projetos").status_code == 401
    assert entrar(main, "maria", "outra-123")[1] == 401
    assert projetos.carregar(pid)["dono"] == "admin"   # o vídeo dela passa para o admin
    assert admin.delete("/api/usuarios/admin").status_code == 400


def test_trocar_cf_senha_desconecta_o_admin(servidor, monkeypatch):
    main, _, _ = servidor
    admin, _ = entrar(main, "", "senha-do-dono")
    monkeypatch.setenv("CF_SENHA", "senha-nova")
    assert admin.get("/api/projetos").status_code == 401


def test_cookie_falsificado_nao_entra(servidor):
    main, _, _ = servidor
    c = TestClient(main.app, client=VIA_CADDY)
    c.cookies.set("cf_sessao", "admin.0000")
    assert c.get("/api/projetos").status_code == 401
    c.cookies.set("cf_sessao", "maria.abc")
    assert c.get("/api/projetos").status_code == 401


def test_sem_servidor_nao_existem_contas(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    monkeypatch.delenv("CF_SENHA", raising=False)
    from app import projetos
    importlib.reload(projetos)
    from app import acesso, main
    importlib.reload(acesso)
    importlib.reload(main)
    pc = TestClient(main.app)
    assert pc.get("/api/usuarios").status_code == 404
    assert pc.get("/api/status").json()["usuario"] is None


def test_pessoa_pede_cadastro_e_so_entra_depois_de_aceita(servidor):
    main, acesso, _ = servidor
    anonimo = TestClient(main.app, client=VIA_CADDY)
    assert anonimo.get("/api/modo").json() == {"servidor": True}
    assert anonimo.post("/api/cadastro", json={"nome": "", "login": "ana", "senha": "abc12345"}).status_code == 400
    assert anonimo.post("/api/cadastro", json={"nome": "Ana Souza", "login": "Ana", "senha": "abc12345"}).status_code == 200
    assert anonimo.post("/api/cadastro", json={"nome": "Outra", "login": "ana", "senha": "xyz12345"}).status_code == 400
    assert anonimo.post("/api/cadastro", json={"nome": "Robô", "login": "admin", "senha": "xyz12345"}).status_code == 400

    # Antes de aceitar: senha certa, mas não entra (e a mensagem diz por quê).
    r = anonimo.post("/api/entrar", json={"usuario": "ana", "senha": "abc12345"})
    assert r.status_code == 403 and "aprovação" in r.json()["detail"]

    admin, _ = entrar(main, "", "senha-do-dono")
    assert admin.get("/api/status").json()["pendentes"] == 1
    ana = [u for u in admin.get("/api/usuarios").json() if u["login"] == "ana"][0]
    assert ana["pendente"] and ana["nome"] == "Ana Souza"
    assert anonimo.post("/api/usuarios/ana/aprovar").status_code == 401   # só o admin aceita
    assert admin.post("/api/usuarios/ana/aprovar").status_code == 200
    assert admin.get("/api/status").json()["pendentes"] == 0

    c, st = entrar(main, "ana", "abc12345")
    assert st == 200 and c.get("/api/projetos").json() == []


def test_recusar_pedido_e_limite_de_cadastros(servidor):
    main, acesso, _ = servidor
    anonimo = TestClient(main.app, client=VIA_CADDY)
    for i in range(5):
        assert anonimo.post("/api/cadastro", json={"nome": "Robô", "login": f"robo{i}", "senha": "abc12345"}).status_code == 200
    assert anonimo.post("/api/cadastro", json={"nome": "Robô", "login": "robo9", "senha": "abc12345"}).status_code == 400
    admin, _ = entrar(main, "", "senha-do-dono")
    assert admin.delete("/api/usuarios/robo0").status_code == 200
    assert "robo0" not in acesso.usuarios()


def test_sem_servidor_nao_tem_cadastro(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    monkeypatch.delenv("CF_SENHA", raising=False)
    from app import projetos
    importlib.reload(projetos)
    from app import acesso, main
    importlib.reload(acesso)
    importlib.reload(main)
    cel = TestClient(main.app, client=("192.168.0.50", 1))
    assert cel.get("/api/modo").json() == {"servidor": False}
    assert cel.post("/api/cadastro", json={"nome": "Ana", "login": "ana", "senha": "abc12345"}).status_code == 404
