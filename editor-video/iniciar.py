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
    print(f"\nCorteFácil rodando em {url}  (feche esta janela para sair)\n")
    if "--sem-navegador" not in sys.argv and not reiniciando:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=PORTA, log_level="warning")
