"""Abre o CorteFácil: sobe o servidor local e abre o navegador."""
import os
import sys
import threading
import urllib.request
import webbrowser

import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PORTA = int(os.environ.get("PORTA", "8765"))

if __name__ == "__main__":
    from app.midia import ffmpeg_disponivel

    if not ffmpeg_disponivel():
        print("\n[ERRO] ffmpeg não encontrado. Instale seguindo o README.md e abra de novo.\n")
        sys.exit(1)
    url = f"http://127.0.0.1:{PORTA}"
    try:
        # Já está aberto (ícone clicado duas vezes)? Só mostra a página de novo.
        urllib.request.urlopen(f"{url}/api/status", timeout=1)
        webbrowser.open(url)
        sys.exit(0)
    except OSError:
        pass
    from app.projetos import RAIZ

    # Reiniciando depois de uma atualização: a aba do navegador já está aberta.
    marca = RAIZ / ".reiniciando"
    reiniciando = marca.exists()
    if reiniciando:
        marca.unlink()
    from app.acesso import celular_ativo, ip_da_rede

    # Com o acesso pelo celular ligado, escuta a rede Wi-Fi (o Windows pode pedir
    # permissão ao firewall na primeira vez: clique em "Permitir").
    from app.acesso import modo_servidor

    # No servidor (VPS) o Caddy recebe o https e repassa para cá: escuta só localmente.
    host = "0.0.0.0" if celular_ativo() and not modo_servidor() else "127.0.0.1"
    os.environ["CF_HOST"] = host
    print(f"\nCorteFácil rodando em {url}  (feche esta janela para sair)")
    if host == "0.0.0.0":
        print(f"No celular (mesmo Wi-Fi): http://{ip_da_rede()}:{PORTA}")
    print()
    if "--sem-navegador" not in sys.argv and not reiniciando:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host=host, port=PORTA, log_level="warning")
