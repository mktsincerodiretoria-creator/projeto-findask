#!/usr/bin/env bash
# Abre o CorteFácil no Mac/Linux. Na primeira vez instala as dependências.
set -e
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "[ERRO] Instale o Python 3 (Mac: brew install python)"; exit 1; }
command -v ffmpeg >/dev/null || { echo "[ERRO] Instale o ffmpeg (Mac: brew install ffmpeg | Linux: sudo apt install ffmpeg)"; exit 1; }
if [ ! -d .venv ]; then
  echo "Primeira vez: instalando o CorteFácil, aguarde alguns minutos..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip >/dev/null
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python iniciar.py
