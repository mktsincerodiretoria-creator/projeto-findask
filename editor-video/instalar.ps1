# CorteFácil: instala tudo o que precisa (só na primeira vez) e abre o editor.
# Python e ffmpeg ficam dentro da pasta "ferramentas", sem mexer no resto do computador.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base = Split-Path -Parent $MyInvocation.MyCommand.Path
$Ferramentas = Join-Path $Base "ferramentas"
$PastaPython = Join-Path $Ferramentas "python"
$Python = Join-Path $PastaPython "tools\python.exe"
$PastaFfmpeg = Join-Path $Ferramentas "ffmpeg"

$UrlPython = "https://api.nuget.org/v3-flatcontainer/python/3.12.10/python.3.12.10.nupkg"
$UrlsFfmpeg = @(
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
)
$UrlVcRedist = "https://aka.ms/vs/17/release/vc_redist.x64.exe"

function Passo($texto) {
    Write-Host ""
    Write-Host "==> $texto" -ForegroundColor Cyan
}

function Baixar($url, $destino) {
    Write-Host "    baixando: $url"
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -L --fail --retry 3 --progress-bar -o $destino $url
        if ($LASTEXITCODE -eq 0) { return }
    }
    Invoke-WebRequest -Uri $url -OutFile $destino -UseBasicParsing
}

function Extrair($zip, $destino) {
    New-Item -ItemType Directory -Force -Path $destino | Out-Null
    if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
        & tar.exe -xf $zip -C $destino
        if ($LASTEXITCODE -eq 0) { return }
    }
    Expand-Archive -Path $zip -DestinationPath $destino -Force
}

function AcharFfmpeg {
    Get-ChildItem -Path $PastaFfmpeg -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
}

try {
    Write-Host "CorteFácil - editor inteligente de vídeo" -ForegroundColor Green
    New-Item -ItemType Directory -Force -Path $Ferramentas | Out-Null

    # 1) Python portátil
    if (-not (Test-Path $Python)) {
        Passo "Baixando o Python (etapa 1 de 4)..."
        $zip = Join-Path $Ferramentas "python.zip"
        Baixar $UrlPython $zip
        Extrair $zip $PastaPython
        Remove-Item $zip -Force
        if (-not (Test-Path $Python)) { throw "O Python não foi extraído corretamente." }
    }

    # 2) ffmpeg portátil
    $ffmpeg = AcharFfmpeg
    if (-not $ffmpeg) {
        Passo "Baixando o ffmpeg (etapa 2 de 4, cerca de 100-200 MB)..."
        $zip = Join-Path $Ferramentas "ffmpeg.zip"
        $baixou = $false
        foreach ($url in $UrlsFfmpeg) {
            try { Baixar $url $zip; $baixou = $true; break }
            catch { Write-Host "    não deu, tentando outro endereço..." -ForegroundColor Yellow }
        }
        if (-not $baixou) { throw "Não consegui baixar o ffmpeg. Confira sua internet." }
        Write-Host "    extraindo..."
        Extrair $zip $PastaFfmpeg
        Remove-Item $zip -Force
        $ffmpeg = AcharFfmpeg
        if (-not $ffmpeg) { throw "O ffmpeg não foi extraído corretamente." }
    }
    $env:PATH = "$($ffmpeg.DirectoryName);$env:PATH"

    # 3) Bibliotecas do Visual C++ (usadas pelo reconhecimento de voz)
    if (-not (Test-Path "$env:SystemRoot\System32\msvcp140.dll")) {
        Passo "Instalando componente do Windows (etapa 3 de 4). Se o Windows pedir permissão, clique em Sim."
        $exe = Join-Path $Ferramentas "vc_redist.x64.exe"
        Baixar $UrlVcRedist $exe
        Start-Process -FilePath $exe -ArgumentList "/install", "/passive", "/norestart" -Wait
        Remove-Item $exe -Force -ErrorAction SilentlyContinue
    }

    # 4) Pacotes do editor (refaz se o requirements.txt mudar)
    $requisitos = Join-Path $Base "requirements.txt"
    $marca = Join-Path $Ferramentas "pacotes.ok"
    $hash = (Get-FileHash $requisitos).Hash
    if (-not (Test-Path $marca) -or ((Get-Content $marca -Raw).Trim() -ne $hash)) {
        Passo "Instalando os componentes do editor (etapa 4 de 4, alguns minutos)..."
        & $Python -m pip install --disable-pip-version-check --no-warn-script-location -r $requisitos
        if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar os componentes do editor." }
        Set-Content -Path $marca -Value $hash
    }

    Passo "Abrindo o CorteFácil no navegador... (deixe esta janela aberta enquanto usa)"
    & $Python (Join-Path $Base "iniciar.py")
    exit $LASTEXITCODE
}
catch {
    Write-Host ""
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Tire um print desta janela e mande para quem te ajudou a instalar." -ForegroundColor Yellow
    exit 1
}
