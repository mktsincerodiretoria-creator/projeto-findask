@echo off
rem Mantem o Atlas ligado: se o servidor cair, sobe de novo sozinho.
cd /d "%~dp0"
set ATLAS_SEM_JANELA=
:inicio
%ATLAS_NODE% server.js
if %errorlevel%==0 goto fim
set ATLAS_SEM_JANELA=1
timeout /t 3 /nobreak >nul
goto inicio
:fim
