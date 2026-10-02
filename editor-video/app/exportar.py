"""Exportação final: aplica os cortes, grava a legenda e codifica em alta qualidade."""
from __future__ import annotations

import bisect
import subprocess
from pathlib import Path

import numpy as np

from . import filtros, movimento
from .analise import intervalos_mantidos
from .legendas import gerar_ass, gerar_srt, montar_blocos
from .midia import versao_ffmpeg

OPCOES_PADRAO = {
    "resolucao": "original",   # original | 720 | 1080 | 1440 | 2160 (lado menor)
    "qualidade": "alta",       # maxima | alta | normal
    "legenda": "gravada",      # gravada | arquivo | nenhuma
    "velocidade": "normal",    # normal | rapida (codifica mais rápido, arquivo maior)
    "melhorar": "suave",       # nao | suave | forte (menos ruído + mais nitidez)
}

# "Melhorar imagem": tira o granulado antes de aumentar e devolve a nitidez depois.
MELHORIA = {
    "suave": (["hqdn3d=1.2:1.0:4:3"], ["unsharp=5:5:0.45:3:3:0"]),
    "forte": (["hqdn3d=2.2:1.8:6:5"], ["unsharp=5:5:0.85:3:3:0", "eq=contrast=1.03:saturation=1.06"]),
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


def filtro_saida(largura, altura, orig_l, orig_a, com_legenda: bool, melhorar: str = "nao") -> list[str]:
    """Melhoria de imagem, escala final, legenda gravada e formato de cor do arquivo."""
    antes, depois = MELHORIA.get(melhorar, ([], []))
    etapas = list(antes)
    if (largura, altura) != (orig_l, orig_a):
        etapas.append(f"scale={largura}:{altura}:flags=lanczos+accurate_rnd+full_chroma_int")
    etapas += depois   # nitidez depois da escala (e antes da legenda: o texto não é afetado)
    etapas.append("setsar=1")
    if com_legenda:
        etapas.append("subtitles=legendas.ass")
    etapas.append("format=yuv420p")
    return etapas


def montar_filtro(trechos, largura, altura, orig_l, orig_a, com_legenda: bool, com_cor: bool = False,
                  quadros_brutos_fps: float | None = None, melhorar: str = "nao") -> str:
    """Corta e junta os trechos. Com ``quadros_brutos_fps`` a saída são quadros RGB crus a
    taxa fixa (o Python aplica zoom/tracking e outro ffmpeg finaliza)."""
    linhas = []
    pares = []
    so_video = bool(quadros_brutos_fps)   # o áudio sai num passo separado
    for k, (a, b) in enumerate(trechos):
        dur = b - a
        fade = min(0.012, dur / 4)
        linhas.append(f"[0:v]trim=start={a:.4f}:end={b:.4f},setpts=PTS-STARTPTS[v{k}]")
        if so_video:
            pares.append(f"[v{k}]")
            continue
        linhas.append(
            f"[0:a]atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade:.4f},afade=t=out:st={dur - fade:.4f}:d={fade:.4f}[a{k}]"
        )
        pares.append(f"[v{k}][a{k}]")
    if so_video:
        linhas.append(f"{''.join(pares)}concat=n={len(trechos)}:v=1:a=0[vc]")
    else:
        linhas.append(f"{''.join(pares)}concat=n={len(trechos)}:v=1:a=1[vc][ac]")

    posterior = []
    if com_cor:
        # Filtro de cor antes da escala e da legenda (o texto não pode ficar colorido).
        posterior.append("lut3d=cor.cube:interp=tetrahedral")
    if quadros_brutos_fps:
        posterior += [f"fps={quadros_brutos_fps}", "format=rgb24"]
    else:
        posterior += filtro_saida(largura, altura, orig_l, orig_a, com_legenda, melhorar)
    linhas.append(f"[vc]{','.join(posterior)}[vout]")
    return ";\n".join(linhas)


def exportar(projeto_dir: Path, original: Path, meta: dict, palavras: list, cortes: list,
             estilo: dict, opcoes: dict, nome_saida: str, progresso=None, filtro: dict | None = None,
             mov: dict | None = None, trilha: dict | None = None) -> dict:
    opcoes = {**OPCOES_PADRAO, **(opcoes or {})}
    duracao = meta["duracao"]
    trechos = intervalos_mantidos(cortes, duracao)
    if not trechos:
        raise ValueError("Todos os trechos foram cortados: não sobrou nada para exportar.")
    total = sum(b - a for a, b in trechos)

    largura, altura = dimensoes_saida(meta["largura"], meta["altura"], opcoes["resolucao"])
    blocos = montar_blocos(palavras, cortes, duracao, estilo, meta["largura"] / meta["altura"])
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

    filtro = filtro or {}
    com_cor = filtro.get("id", "natural") in filtros.FILTROS and filtro.get("id", "natural") != "natural" \
        and float(filtro.get("intensidade", 1.0)) > 0
    if com_cor:
        filtros.escrever_cube(projeto_dir / "cor.cube", filtro["id"], float(filtro.get("intensidade", 1.0)))

    flag_filtro = ["-/filter_complex", "filtro.txt"] if versao_ffmpeg() >= 7 else ["-filter_complex_script", "filtro.txt"]
    codificacao = [
        "-c:v", "libx264", "-preset", "veryfast" if opcoes["velocidade"] == "rapida" else "slow",
        "-crf", str(CRF.get(opcoes["qualidade"], 17)), "-profile:v", "high",
        "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
        "-movflags", "+faststart",
    ]
    resultado = {**arquivos, "duracao": round(total, 2), "largura": largura, "altura": altura, "opcoes": opcoes}

    mov = movimento.normalizar(mov)
    if movimento.tem_efeito(mov):
        _exportar_com_movimento(projeto_dir, original, meta, trechos, total, largura, altura, gravar, com_cor,
                                mov, trilha, flag_filtro, codificacao, arquivos["video"], progresso,
                                opcoes["melhorar"])
        return resultado

    filtro = montar_filtro(trechos, largura, altura, meta["largura"], meta["altura"], gravar, com_cor,
                           melhorar=opcoes["melhorar"])
    (projeto_dir / "filtro.txt").write_text(filtro, encoding="utf-8")

    cmd = [
        "ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
        "-i", str(original.resolve()),
        *flag_filtro,
        "-map", "[vout]", "-map", "[ac]",
        *codificacao,
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

    return resultado


def montar_filtro_audio(trechos) -> str:
    linhas, pares = [], []
    for k, (a, b) in enumerate(trechos):
        dur = b - a
        fade = min(0.012, dur / 4)
        linhas.append(
            f"[0:a]atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade:.4f},afade=t=out:st={dur - fade:.4f}:d={fade:.4f}[a{k}]"
        )
        pares.append(f"[a{k}]")
    linhas.append(f"{''.join(pares)}concat=n={len(trechos)}:v=0:a=1[ac]")
    return ";\n".join(linhas)


def _tempo_original(trechos):
    """Função que converte tempo do vídeo final -> tempo do vídeo original."""
    inicios, acumulado, total = [], [], 0.0
    for a, b in trechos:
        inicios.append(a)
        acumulado.append(total)
        total += b - a

    def converter(t_final):
        i = max(0, bisect.bisect_right(acumulado, t_final) - 1)
        return inicios[i] + (t_final - acumulado[i])
    return converter


def _exportar_com_movimento(projeto_dir, original, meta, trechos, total, largura, altura, gravar, com_cor,
                            mov, trilha, flag_filtro, codificacao, saida, progresso, melhorar="nao"):
    """Três etapas em fila: ffmpeg (cortes + cor) -> Python (zoom e tracking em cada quadro,
    com precisão de subpixel) -> ffmpeg (escala, legenda e codificação)."""
    import cv2

    w, h = meta["largura"], meta["altura"]
    fps = meta.get("fps") or 30.0
    # 1) Áudio já cortado, num arquivo pronto antes de o vídeo começar.
    (projeto_dir / "filtro_audio.txt").write_text(montar_filtro_audio(trechos), encoding="utf-8")
    flag_audio = [flag_filtro[0], "filtro_audio.txt"]
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(original.resolve()), *flag_audio,
         "-map", "[ac]", "-c:a", "pcm_s16le", "-ar", "48000", "audio_final.wav"],
        cwd=projeto_dir, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou no áudio: {proc.stderr[-1500:]}")

    # 2) Quadros crus (cortes + cor) -> Python (zoom/tracking) -> 3) ffmpeg final.
    filtro = montar_filtro(trechos, largura, altura, w, h, gravar, com_cor, quadros_brutos_fps=fps)
    (projeto_dir / "filtro.txt").write_text(filtro, encoding="utf-8")
    entrada = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-i", str(original.resolve()), *flag_filtro,
         "-map", "[vout]", "-f", "rawvideo", "pipe:1"],
        cwd=projeto_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    saida_proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
         "-r", str(fps), "-i", "pipe:0", "-i", "audio_final.wav",
         "-vf", ",".join(filtro_saida(largura, altura, w, h, gravar, melhorar)),
         "-map", "0:v", "-map", "1:a", *codificacao, "-shortest", saida],
        cwd=projeto_dir, stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    para_original = _tempo_original(trechos)
    tamanho = w * h * 3
    total_quadros = max(1, int(total * fps))
    n = 0
    try:
        while True:
            bruto = entrada.stdout.read(tamanho)
            if len(bruto) < tamanho:
                break
            quadro = np.frombuffer(bruto, np.uint8).reshape(h, w, 3)
            z, x0, y0 = movimento.janela(para_original(n / fps), mov, trilha)
            if z > 1.0005:
                m = np.float32([[z, 0, -x0 * w * z], [0, z, -y0 * h * z]])
                quadro = cv2.warpAffine(quadro, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            saida_proc.stdin.write(quadro.tobytes())
            n += 1
            if progresso and n % 15 == 0:
                progresso(min(0.99, n / total_quadros))
    except BrokenPipeError:
        pass
    finally:
        if saida_proc.stdin and not saida_proc.stdin.closed:
            try:
                saida_proc.stdin.close()
            except BrokenPipeError:
                pass
    erro_entrada = entrada.stderr.read().decode("utf-8", "replace")
    erro_saida = saida_proc.stderr.read().decode("utf-8", "replace")
    if entrada.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou ao ler o vídeo: {erro_entrada[-1500:]}")
    if saida_proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou na exportação: {erro_saida[-1500:]}")
    (projeto_dir / "audio_final.wav").unlink(missing_ok=True)
