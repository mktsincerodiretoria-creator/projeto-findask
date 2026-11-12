@echo off
title Desinstalar o Atlas
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Atlas.lnk" 2>nul
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Desktop') + '\Atlas.lnk') -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*rodar.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-NetTCPConnection -LocalPort 7717 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Atlas removido da inicializacao. Para apagar de vez, exclua esta pasta.
pause
