"""Acesso pelo celular na mesma rede Wi-Fi, protegido por uma senha de 6 números.

No próprio computador (127.0.0.1) não pede senha. De qualquer outro aparelho,
só entra quem digitou a senha; o navegador guarda um cookie por 30 dias.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import socket
import threading
import time

from . import projetos

COOKIE = "cf_sessao"
# "testclient" é o endereço usado pelo cliente de testes do FastAPI.
LOCAIS = {"127.0.0.1", "::1", "localhost", "testclient"}
# Sem senha: a página de entrada e o que ela precisa para aparecer.
LIVRES = {"/entrar.html", "/estilo.css", "/icone.png", "/api/entrar"}

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


def conferir_senha(senha: str) -> str | None:
    """Devolve o valor do cookie se a senha estiver certa. Limita tentativas erradas."""
    with _trava:
        agora = time.time()
        _tentativas[:] = [t for t in _tentativas if agora - t < 60]
        if len(_tentativas) >= 8:
            return None
        cfg = config()
        certa = cfg.get("senha_celular", "")
        if certa and hmac.compare_digest(senha.strip(), certa):
            return _token(cfg)
        _tentativas.append(agora)
        return None


def local(host_cliente: str) -> bool:
    return host_cliente in LOCAIS and not modo_servidor()


def autorizado(host_cliente: str, cookie: str | None) -> bool:
    if local(host_cliente):
        return True
    cfg = config()
    return bool(cfg.get("celular") and cookie and hmac.compare_digest(cookie, _token(cfg)))


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
