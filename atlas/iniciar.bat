@echo off
rem Abre o Atlas manualmente, com a janela de diagnostico visivel (util se algo der errado).
cd /d "%~dp0"
node server.js
pause
