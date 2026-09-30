@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo [ERRO] Python nao encontrado. Instale em https://www.python.org/downloads/ marcando "Add python.exe to PATH". & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo [ERRO] ffmpeg nao encontrado. Rode no PowerShell:  winget install Gyan.FFmpeg  e abra de novo. & pause & exit /b 1)
if not exist .venv (
  echo Primeira vez: instalando o CorteFacil, aguarde alguns minutos...
  python -m venv .venv || (pause & exit /b 1)
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt || (pause & exit /b 1)
)
.venv\Scripts\python iniciar.py
pause
