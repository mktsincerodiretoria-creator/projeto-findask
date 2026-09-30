"""Exportação final: aplica os cortes, grava a legenda e codifica em alta qualidade."""
from __future__ import annotations

import subprocess
from pathlib import Path

from .analise import intervalos_mantidos
from .legendas import gerar_ass, gerar_srt, montar_blocos
from .midia import versao_ffmpeg

OPCOES_PADRAO = {
    "resolucao": "original",   # original | 720 | 1080 | 1440 | 2160 (lado menor)
    "qualidade": "alta",       # maxima | alta | normal
    "legenda": "gravada",      # gravada | arquivo | nenhuma
    "velocidade": "normal",    # normal | rapida (codifica mais rápido, arquivo maior)
}

CRF = {"maxima": 14, "alta": 17, "normal": 21}


def dimensoes_saida(largura: int, altura: int, resolucao: str) -> tuple[int, int]:
    if resolucao == "original":
        alvo_l, alvo_a = largura, altura
    else:
        lado = int(resolucao)
        fator = lado / min(largura, altura)
        alvo_l, alvo_a = largura * fator, altura * fator
    # H.264 exige dimensões pares.
    return int(round(alvo_l / 2) * 2), int(round(alvo_a / 2) * 2)


def montar_filtro(trechos, largura, altura, orig_l, orig_a, com_legenda: bool) -> str:
    linhas = []
    pares = []
    for k, (a, b) in enumerate(trechos):
        dur = b - a
        fade = min(0.012, dur / 4)
        linhas.append(f"[0:v]trim=start={a:.4f}:end={b:.4f},setpts=PTS-STARTPTS[v{k}]")
        linhas.append(
            f"[0:a]atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade:.4f},afade=t=out:st={dur - fade:.4f}:d={fade:.4f}[a{k}]"
        )
        pares.append(f"[v{k}][a{k}]")
    linhas.append(f"{''.join(pares)}concat=n={len(trechos)}:v=1:a=1[vc][ac]")

    posterior = []
    if (largura, altura) != (orig_l, orig_a):
        posterior.append(f"scale={largura}:{altura}:flags=lanczos")
    posterior.append("setsar=1")
    if com_legenda:
        posterior.append("subtitles=legendas.ass")
    posterior.append("format=yuv420p")
    linhas.append(f"[vc]{','.join(posterior)}[vout]")
    return ";\n".join(linhas)


def exportar(projeto_dir: Path, original: Path, meta: dict, palavras: list, cortes: list,
             estilo: dict, opcoes: dict, nome_saida: str, progresso=None) -> dict:
    opcoes = {**OPCOES_PADRAO, **(opcoes or {})}
    duracao = meta["duracao"]
    trechos = intervalos_mantidos(cortes, duracao)
    if not trechos:
        raise ValueError("Todos os trechos foram cortados: não sobrou nada para exportar.")
    total = sum(b - a for a, b in trechos)

    largura, altura = dimensoes_saida(meta["largura"], meta["altura"], opcoes["resolucao"])
    blocos = montar_blocos(palavras, cortes, duracao, estilo)
    arquivos = {"video": f"{nome_saida}.mp4"}

    legenda_ativa = opcoes["legenda"] != "nenhuma" and bool(blocos)
    if legenda_ativa:
        (projeto_dir / f"{nome_saida}.srt").write_text(gerar_srt(blocos), encoding="utf-8")
        arquivos["legenda"] = f"{nome_saida}.srt"
    gravar = legenda_ativa and opcoes["legenda"] == "gravada"
    if gravar:
        (projeto_dir / "legendas.ass").write_text(
            gerar_ass(blocos, largura, altura, estilo), encoding="utf-8"
        )

    filtro = montar_filtro(trechos, largura, altura, meta["largura"], meta["altura"], gravar)
    (projeto_dir / "filtro.txt").write_text(filtro, encoding="utf-8")
    flag_filtro = ["-/filter_complex", "filtro.txt"] if versao_ffmpeg() >= 7 else ["-filter_complex_script", "filtro.txt"]

    cmd = [
        "ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
        "-i", str(original.resolve()),
        *flag_filtro,
        "-map", "[vout]", "-map", "[ac]",
        "-c:v", "libx264", "-preset", "veryfast" if opcoes["velocidade"] == "rapida" else "slow",
        "-crf", str(CRF.get(opcoes["qualidade"], 17)), "-profile:v", "high",
        "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
        "-movflags", "+faststart",
        arquivos["video"],
    ]
    proc = subprocess.Popen(cmd, cwd=projeto_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace")
    for linha in proc.stdout:
        if linha.startswith("out_time_us=") and progresso:
            try:
                progresso(min(0.99, int(linha.split("=")[1]) / 1e6 / total))
            except ValueError:
                pass
    erro = proc.stderr.read()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou na exportação: {erro[-1500:]}")

    return {
        **arquivos,
        "duracao": round(total, 2),
        "largura": largura,
        "altura": altura,
        "opcoes": opcoes,
    }
