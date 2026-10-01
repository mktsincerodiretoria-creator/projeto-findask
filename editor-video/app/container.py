"""Execução dentro de um container (EasyPanel, Docker)."""
from __future__ import annotations

import asyncio

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

AVISO_SEM_SENHA = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>CorteFácil: falta a senha</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8eaf0;
font:16px/1.5 system-ui,sans-serif;padding:16px}main{max-width:520px;background:#161920;border:1px solid #2a2f3a;
border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 12px}code{background:#1e222b;padding:2px 6px;
border-radius:6px;color:#19d3c5}li{margin:6px 0}</style></head><body><main>
<h1>✂ CorteFácil instalado: falta só a senha</h1>
<p>Por segurança, o editor só abre depois que você cria uma senha de acesso.</p>
<ol><li>No EasyPanel, abra o serviço <b>cortefacil</b> → aba <b>Environment</b>.</li>
<li>Escreva uma linha assim (troque pela sua senha): <code>CF_SENHA=SuaSenhaAqui</code></li>
<li>Clique em <b>Save</b> e depois em <b>Deploy</b>.</li>
<li>Recarregue esta página e entre com a senha.</li></ol></main></body></html>"""


def _app_aviso() -> FastAPI:
    aviso = FastAPI()

    @aviso.get("/{qualquer:path}", response_class=HTMLResponse)
    def pagina(qualquer: str = ""):
        return AVISO_SEM_SENHA

    return aviso


def rodar_em_container(host: str, portas: list[int], com_senha: bool) -> None:
    if com_senha:
        from .main import app
    else:
        print("\n[AVISO] Falta a variável CF_SENHA: mostrando a página de instruções.\n", flush=True)
        app = _app_aviso()
    print(f"CorteFácil escutando nas portas {', '.join(map(str, portas))}", flush=True)

    async def servir():
        servidores = [uvicorn.Server(uvicorn.Config(app, host=host, port=p, log_level="warning")) for p in portas]
        await asyncio.gather(*(s.serve() for s in servidores))

    asyncio.run(servir())
