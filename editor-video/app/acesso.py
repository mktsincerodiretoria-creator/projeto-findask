"""Acesso pelo celular na mesma rede Wi-Fi, protegido por uma senha de 6 números.

No próprio computador (127.0.0.1) não pede senha. De qualquer outro aparelho,
só entra quem digitou a senha; o navegador guarda um cookie por 30 dias.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import threading
import time

from . import projetos

COOKIE = "cf_sessao"
# "testclient" é o endereço usado pelo cliente de testes do FastAPI.
LOCAIS = {"127.0.0.1", "::1", "localhost", "testclient"}
# Sem senha: a página de entrada e o que ela precisa para aparecer.
LIVRES = {"/entrar.html", "/estilo.css", "/icone.png", "/api/entrar", "/api/sair"}

# No servidor: "admin" é o dono (entra com CF_SENHA); os outros são criados por ele.
ADMIN = "admin"
LOGIN_VALIDO = re.compile(r"^[a-z0-9][a-z0-9._-]{1,29}$")
SENHA_MINIMA = 6

_tentativas: list[float] = []
_trava = threading.Lock()


def modo_servidor() -> bool:
    """Instalado num servidor (VPS): a senha vem de CF_SENHA e vale para todo mundo,
    porque ali os pedidos chegam pelo Caddy (https) e sempre parecem vir de 127.0.0.1."""
    return bool(os.environ.get("CF_SENHA"))


def config() -> dict:
    cfg = projetos.config_app()
    if modo_servidor():
        if not cfg.get("segredo"):
            cfg["segredo"] = secrets.token_hex(16)
            projetos.salvar_config_app(cfg)
        cfg = {**cfg, "celular": True, "senha_celular": os.environ["CF_SENHA"]}
    return cfg


def celular_ativo() -> bool:
    return bool(config().get("celular"))


def ativar(ligar: bool) -> dict:
    cfg = config()
    cfg["celular"] = bool(ligar)
    if ligar and not cfg.get("senha_celular"):
        cfg["senha_celular"] = f"{secrets.randbelow(10**6):06d}"
    if not cfg.get("segredo"):
        cfg["segredo"] = secrets.token_hex(16)
    projetos.salvar_config_app(cfg)
    return cfg


def nova_senha() -> str:
    cfg = config()
    cfg["senha_celular"] = f"{secrets.randbelow(10**6):06d}"
    projetos.salvar_config_app(cfg)
    return cfg["senha_celular"]


def _token(cfg) -> str:
    # Trocar a senha invalida todos os celulares que já tinham entrado.
    return hmac.new(cfg.get("segredo", "").encode(), cfg.get("senha_celular", "").encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------- contas (só no servidor)

def _arquivo_usuarios():
    return projetos.RAIZ / "usuarios.json"


def usuarios() -> dict:
    arq = _arquivo_usuarios()
    return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}


def _salvar_usuarios(dados: dict) -> None:
    projetos.RAIZ.mkdir(parents=True, exist_ok=True)
    tmp = _arquivo_usuarios().with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(_arquivo_usuarios())


def _hash(senha: str, sal: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), 200_000).hex()


def normalizar_login(login: str) -> str:
    return (login or "").strip().lower()


def criar_usuario(login: str, senha: str) -> None:
    login = normalizar_login(login)
    if not LOGIN_VALIDO.match(login):
        raise ValueError("Use de 2 a 30 letras minúsculas, números, ponto, traço ou _ (sem espaço nem acento).")
    if login == ADMIN:
        raise ValueError('"admin" é você (o dono). Escolha outro nome.')
    if len(senha) < SENHA_MINIMA:
        raise ValueError(f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres.")
    with _trava:
        dados = usuarios()
        if login in dados:
            raise ValueError("Já existe um usuário com esse nome.")
        sal = secrets.token_hex(16)
        dados[login] = {"sal": sal, "hash": _hash(senha, sal), "versao": 1, "criado_em": time.time()}
        _salvar_usuarios(dados)


def trocar_senha_usuario(login: str, senha: str) -> None:
    if len(senha) < SENHA_MINIMA:
        raise ValueError(f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres.")
    with _trava:
        dados = usuarios()
        if login not in dados:
            raise KeyError(login)
        sal = secrets.token_hex(16)
        # Subir a versão desconecta quem estava usando a senha antiga.
        dados[login].update(sal=sal, hash=_hash(senha, sal), versao=dados[login].get("versao", 1) + 1)
        _salvar_usuarios(dados)


def remover_usuario(login: str) -> None:
    with _trava:
        dados = usuarios()
        if dados.pop(login, None) is None:
            raise KeyError(login)
        _salvar_usuarios(dados)


def token_usuario(login: str) -> str | None:
    cfg = config()
    if login == ADMIN:
        prova = "admin:" + os.environ.get("CF_SENHA", "")
    else:
        u = usuarios().get(login)
        if not u:
            return None
        prova = f"{login}:{u.get('versao', 1)}:{u['hash']}"
    assinatura = hmac.new(cfg["segredo"].encode(), prova.encode(), hashlib.sha256).hexdigest()
    return f"{login}.{assinatura}"


def _senha_confere(login: str, senha: str) -> bool:
    if login == ADMIN:
        return hmac.compare_digest(senha, os.environ.get("CF_SENHA", ""))
    u = usuarios().get(login)
    if not u:
        _hash(senha, "00" * 16)  # mesmo tempo de resposta para usuário que não existe
        return False
    return hmac.compare_digest(_hash(senha, u["sal"]), u["hash"])


def conferir_senha(senha: str, login: str = "") -> str | None:
    """Devolve o valor do cookie se a senha estiver certa. Limita tentativas erradas."""
    with _trava:
        agora = time.time()
        _tentativas[:] = [t for t in _tentativas if agora - t < 60]
        if len(_tentativas) >= 8:
            return None
        senha = senha.strip()
        if modo_servidor():
            login = normalizar_login(login) or ADMIN
            if _senha_confere(login, senha):
                return token_usuario(login)
        elif not normalizar_login(login):
            cfg = config()
            certa = cfg.get("senha_celular", "")
            if certa and hmac.compare_digest(senha, certa):
                return _token(cfg)
        _tentativas.append(agora)
        return None


def local(host_cliente: str) -> bool:
    return host_cliente in LOCAIS and not modo_servidor()


def usuario(host_cliente: str, cookie: str | None) -> dict | None:
    """Quem está usando. None = não entrou.
    {"login": None, "admin": True} = o computador (ou o celular dele): vê tudo, como sempre foi."""
    if local(host_cliente):
        return {"login": None, "admin": True}
    if not cookie:
        return None
    if modo_servidor():
        login = cookie.split(".", 1)[0]
        certo = token_usuario(login)
        if certo and hmac.compare_digest(cookie, certo):
            return {"login": login, "admin": login == ADMIN}
        return None
    cfg = config()
    if cfg.get("celular") and hmac.compare_digest(cookie, _token(cfg)):
        return {"login": None, "admin": True}
    return None


def autorizado(host_cliente: str, cookie: str | None) -> bool:
    return usuario(host_cliente, cookie) is not None


def ip_da_rede() -> str:
    """IP deste computador na rede local (o que o celular precisa digitar)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # não envia nada; só escolhe a interface de rede
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def qr_svg(texto: str) -> str:
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(texto, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    return img.to_string(encoding="unicode")
