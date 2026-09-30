@echo off
chcp 65001 >nul
title CorteFacil
cd /d "%~dp0"
:inicio
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
rem Codigo 42 = o programa se atualizou e pediu para abrir de novo.
if %errorlevel%==42 goto inicio
if errorlevel 1 pause
