@echo off
title Desinstalar o Atlas
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Atlas.lnk" 2>nul
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Desktop') + '\Atlas.lnk') -ErrorAction SilentlyContinue; Get-NetTCPConnection -LocalPort 7717 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Atlas removido da inicializacao. Para apagar de vez, exclua esta pasta.
pause
