"""Gera o instalador de arquivo único: dist/Instalar CorteFacil.bat.

O .bat carrega o programa inteiro dentro dele (zip em base64). Ao dar dois
cliques, ele se extrai em %LOCALAPPDATA%\\CorteFacil (fora do OneDrive, sem
precisar de administrador), roda o instalar.ps1 e cria o ícone na Área de
Trabalho. Também gera o versao.json usado pela atualização automática.
Uso: python empacotar.py  (e faça commit do versao.json junto)
"""
import base64
import io
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.atualizacao import hash_conteudo  # noqa: E402
from app.versao import NOVIDADES, RAMO, VERSAO  # noqa: E402

RAIZ = Path(__file__).resolve().parent
IGNORAR = {"testes", "dados", "ferramentas", "dist", "__pycache__", ".pytest_cache", ".venv"}
IGNORAR_ARQUIVOS = {"requirements-dev.txt", "iniciar.sh", "empacotar.py", ".gitignore", ".gitattributes"}

# Parte lida pelo cmd.exe. Os marcadores são montados por concatenação para que
# o texto literal só exista nas linhas-marcador lá embaixo.
CABECALHO = r"""@echo off
chcp 65001 >nul
title Instalando o CorteFacil
set "CF_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:CF_BAT); $a=$t.IndexOf('#==CODI'+'GO=='); $b=$t.IndexOf('#==DA'+'DOS=='); Invoke-Expression $t.Substring($a, $b-$a)"
if errorlevel 1 pause
exit /b
"""

# Parte executada pelo PowerShell: extrai o programa e chama o instalador.
CODIGO = r"""#==CODIGO==
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Destino = if ($env:CF_DESTINO) { $env:CF_DESTINO } else { Join-Path $env:LOCALAPPDATA "CorteFacil" }
try {
    Write-Host "Instalando o CorteFácil..." -ForegroundColor Green
    $texto = [IO.File]::ReadAllText($env:CF_BAT)
    $marca = '#==DA' + 'DOS=='
    $b64 = $texto.Substring($texto.IndexOf($marca) + $marca.Length) -replace '[^A-Za-z0-9+/=]', ''
    New-Item -ItemType Directory -Force -Path $Destino | Out-Null
    $zip = Join-Path $Destino "programa.zip"
    [IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($b64))
    Expand-Archive -Path $zip -DestinationPath $Destino -Force
    Remove-Item $zip -Force
}
catch {
    Write-Host "ERRO ao extrair o programa: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Tire um print desta janela e mande para quem te ajudou a instalar." -ForegroundColor Yellow
    exit 1
}
if ($env:CF_SO_EXTRAIR) { exit 0 }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Destino "instalar.ps1") -CriarAtalhos
exit $LASTEXITCODE
"""


def arquivos():
    for p in sorted(RAIZ.rglob("*")):
        rel = p.relative_to(RAIZ)
        if p.is_file() and not (set(rel.parts) & IGNORAR) and rel.name not in IGNORAR_ARQUIVOS:
            yield p, rel


def gerar_manifesto() -> Path:
    """versao.json: o que o botão "Atualizar" compara e baixa (tem que ir no commit)."""
    lista = {
        rel.as_posix(): hash_conteudo(rel.as_posix(), p.read_bytes())
        for p, rel in arquivos() if rel.name != "versao.json"
    }
    destino = RAIZ / "versao.json"
    destino.write_text(json.dumps(
        {"versao": VERSAO, "ramo": RAMO, "novidades": NOVIDADES, "arquivos": lista},
        ensure_ascii=False, indent=1,
    ) + "\n", encoding="utf-8")
    return destino


def gerar() -> Path:
    gerar_manifesto()
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p, rel in arquivos():
            if p.suffix in (".bat", ".ps1"):
                # Scripts do Windows com CRLF, independente de como o git fez o checkout.
                texto = p.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
                z.writestr(rel.as_posix(), texto)
            else:
                z.write(p, rel.as_posix())
    dados = base64.b64encode(memoria.getvalue()).decode()
    linhas = [dados[i:i + 100] for i in range(0, len(dados), 100)]
    conteudo = CABECALHO + CODIGO + "#==DADOS==\n" + "\n".join(linhas) + "\n"
    destino = RAIZ / "dist" / "Instalar CorteFacil.bat"
    destino.parent.mkdir(exist_ok=True)
    # cmd.exe precisa de CRLF; sem BOM, senão a primeira linha quebra.
    destino.write_bytes(conteudo.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))
    return destino


if __name__ == "__main__":
    saida = gerar()
    print(f"{saida}  ({saida.stat().st_size // 1024} KB)")
