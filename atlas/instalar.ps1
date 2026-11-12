# Instalador do Atlas (Windows). Texto sem acentos de proposito, para nao quebrar no PowerShell 5.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

function Atualizar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Existe($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host ''
Write-Host '=== ATLAS - instalacao ===' -ForegroundColor Green
Write-Host ''

# 1) Node.js
Write-Host '[1/4] Node.js...' -ForegroundColor Green
if (-not (Existe 'node')) {
  if (-not (Existe 'winget')) {
    Write-Host 'Nao encontrei o Node.js nem o winget. Instale o Node.js LTS em https://nodejs.org e rode este instalador de novo.' -ForegroundColor Yellow
    exit 1
  }
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Atualizar-Path
  if (-not (Existe 'node')) {
    Write-Host 'Node.js instalado. Feche esta janela e rode o instalar.bat de novo para continuar.' -ForegroundColor Yellow
    exit 1
  }
}
Write-Host ('      ok: ' + (node -v))

# Git (o Claude Code no Windows usa o Git Bash)
if (-not (Existe 'git') -and (Existe 'winget')) {
  Write-Host '      instalando o Git...'
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  Atualizar-Path
}

# 2) Claude Code
Write-Host '[2/4] Claude Code...' -ForegroundColor Green
if (-not (Existe 'claude')) {
  cmd /c "npm install -g @anthropic-ai/claude-code"
  Atualizar-Path
  if (-not (Existe 'claude')) {
    Write-Host 'Nao consegui instalar o Claude Code. Rode no Prompt de Comando: npm install -g @anthropic-ai/claude-code' -ForegroundColor Yellow
    exit 1
  }
}
Write-Host '      ok'

# 3) Login no plano
Write-Host '[3/4] Conferindo o login do Claude (pode levar alguns segundos)...' -ForegroundColor Green
$logado = $false
try {
  $r = cmd /c "echo responda apenas ok | claude -p --model haiku 2>&1"
  if ($LASTEXITCODE -eq 0) { $logado = $true }
} catch { }
if (-not $logado) {
  Write-Host ''
  Write-Host 'Voce ainda nao esta logado no Claude Code neste computador.' -ForegroundColor Yellow
  Write-Host 'Vou abrir uma janela do Claude. Nela:' -ForegroundColor Yellow
  Write-Host '  1. Escolha entrar com a sua conta Claude (a do seu plano).' -ForegroundColor Yellow
  Write-Host '  2. Conclua o login no navegador.' -ForegroundColor Yellow
  Write-Host '  3. Quando aparecer a tela do Claude, digite /exit e feche a janela.' -ForegroundColor Yellow
  Write-Host 'Depois volte aqui e aperte Enter.' -ForegroundColor Yellow
  Start-Process cmd -ArgumentList '/k', 'claude'
  Read-Host 'Aperte Enter quando terminar o login'
}

# 4) Iniciar junto com o Windows + atalho
Write-Host '[4/4] Configurando para ligar junto com o computador...' -ForegroundColor Green
$node = (Get-Command node).Source
$vbs = Join-Path $dir 'Atlas.vbs'
$conteudo = @"
Set s = CreateObject("WScript.Shell")
s.CurrentDirectory = "$dir"
s.Environment("PROCESS")("ATLAS_NODE") = """$node"""
s.Run "cmd /c rodar.bat", 0, False
"@
Set-Content -Path $vbs -Value $conteudo -Encoding Default

$shell = New-Object -ComObject WScript.Shell
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
foreach ($pasta in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('Desktop'))) {
  $atalho = $shell.CreateShortcut((Join-Path $pasta 'Atlas.lnk'))
  $atalho.TargetPath = $wscript
  $atalho.Arguments = '"' + $vbs + '"'
  $atalho.WorkingDirectory = $dir
  $atalho.Description = 'Atlas - assistente de voz'
  $atalho.Save()
}

# Desliga uma versao antiga que esteja rodando, para a nova assumir
try {
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*rodar.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-NetTCPConnection -LocalPort 7717 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
} catch { }
Start-Sleep -Seconds 1

Start-Process $wscript -ArgumentList ('"' + $vbs + '"')

# Confere se o Atlas respondeu
$ligou = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:7717/config' -TimeoutSec 2; $ligou = $true; break } catch { }
}
if (-not $ligou) {
  Write-Host ''
  Write-Host 'O Atlas NAO respondeu. Tire uma foto desta janela e envie. Ultimas linhas do registro:' -ForegroundColor Red
  if (Test-Path (Join-Path $dir 'atlas.log')) { Get-Content (Join-Path $dir 'atlas.log') -Tail 15 }
  Write-Host '--- tentativa direta ---' -ForegroundColor Red
  $env:ATLAS_SEM_JANELA = '1'
  & $node (Join-Path $dir 'server.js')
  exit 1
}

Write-Host ''
Write-Host 'Pronto. O Atlas esta abrindo agora e vai abrir sozinho sempre que voce ligar o computador.' -ForegroundColor Green
Write-Host 'Na primeira vez, clique em PERMITIR quando o navegador pedir o microfone.' -ForegroundColor Green
Write-Host 'Depois e so dizer: Atlas.' -ForegroundColor Green
