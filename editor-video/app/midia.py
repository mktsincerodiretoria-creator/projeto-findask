"""Tudo que chama ffmpeg/ffprobe ou lê o áudio."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np

TAXA_AUDIO = 16000
PASSO_ENERGIA = 0.01   # 10 ms por valor de energia
PONTOS_ONDA_POR_S = 50


def ffmpeg_disponivel() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


@lru_cache(maxsize=1)
def versao_ffmpeg() -> int:
    saida = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    m = re.search(r"ffmpeg version n?(\d+)", saida)
    # Builds de desenvolvimento ("N-12345-...") são mais novas que a 7.
    return int(m.group(1)) if m else 7


def _rodar(cmd, cwd=None):
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=cwd)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou: {proc.stderr[-1500:]}")
    return proc


def sondar(caminho: Path) -> dict:
    """Duração, resolução (já considerando rotação de celular), fps e se tem áudio."""
    proc = _rodar([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(caminho),
    ])
    info = json.loads(proc.stdout)
    video = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    audio = next((s for s in info["streams"] if s.get("codec_type") == "audio"), None)
    if video is None:
        raise ValueError("O arquivo não tem trilha de vídeo.")

    largura, altura = int(video["width"]), int(video["height"])
    rotacao = 0
    if "rotate" in video.get("tags", {}):
        rotacao = int(video["tags"]["rotate"])
    for dado in video.get("side_data_list", []):
        if "rotation" in dado:
            rotacao = int(dado["rotation"])
    if abs(rotacao) % 180 == 90:
        largura, altura = altura, largura

    num, _, den = video.get("avg_frame_rate", "30/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    duracao = float(info["format"].get("duration") or video.get("duration") or 0)
    return {
        # iPhone/Android gravam em HDR (HLG/PQ): sem converter, a cor sai lavada e sem contraste.
        "hdr": video.get("color_transfer") in ("arib-std-b67", "smpte2084"),
        "duracao": round(duracao, 3),
        "largura": largura,
        "altura": altura,
        "fps": round(fps or 30.0, 3),
        "tem_audio": audio is not None,
    }


def extrair_audio(origem: Path, destino: Path) -> None:
    _rodar([
        "ffmpeg", "-y", "-v", "error", "-i", str(origem), "-vn",
        "-ac", "1", "-ar", str(TAXA_AUDIO), "-c:a", "pcm_s16le", str(destino),
    ])


@lru_cache(maxsize=1)
def tem_zscale() -> bool:
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    return " zscale " in proc.stdout and " tonemap " in proc.stdout


def filtro_hdr(meta: dict | None) -> list[str]:
    """Converte HDR para a cor normal (SDR) com o contraste certo; vazio se não for HDR."""
    if not meta or not meta.get("hdr") or not tem_zscale():
        return []
    return ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709",
            "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv", "format=yuv420p"]


def gerar_previa(origem: Path, destino: Path, meta: dict | None = None) -> None:
    """Cópia leve (540p) para o navegador tocar qualquer formato e buscar rápido."""
    _rodar([
        "ffmpeg", "-y", "-v", "error", "-i", str(origem),
        "-vf", ",".join(filtro_hdr(meta) + ["scale='if(gt(iw,ih),-2,540)':'if(gt(iw,ih),540,-2)'"]),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "15",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(destino),
    ])


def ler_wav(caminho: Path) -> np.ndarray:
    with wave.open(str(caminho), "rb") as w:
        bruto = w.readframes(w.getnframes())
    return np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0


def energia_db(amostras: np.ndarray, taxa: int = TAXA_AUDIO, passo: float = PASSO_ENERGIA) -> np.ndarray:
    tam = int(taxa * passo)
    n = len(amostras) // tam
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    quadros = amostras[: n * tam].reshape(n, tam)
    rms = np.sqrt(np.mean(quadros ** 2, axis=1))
    return (20 * np.log10(rms + 1e-6)).astype(np.float32)


def forma_de_onda(amostras: np.ndarray, taxa: int = TAXA_AUDIO) -> list[float]:
    tam = max(1, taxa // PONTOS_ONDA_POR_S)
    n = len(amostras) // tam
    if n == 0:
        return []
    picos = np.abs(amostras[: n * tam].reshape(n, tam)).max(axis=1)
    topo = float(np.percentile(picos, 99.5)) or 1.0
    return [round(float(v), 3) for v in np.clip(picos / topo, 0, 1)]


ALTURA_QUADRO = 72   # altura de cada miniatura da linha do tempo (px)


def gerar_quadros(previa: Path, pasta: Path, duracao: float, largura: int, altura: int) -> dict:
    """Miniaturas do vídeo para a linha do tempo (como no CapCut), numa única imagem
    lado a lado: quadros.jpg + quadros.json com o intervalo entre elas."""
    l = max(2, round(ALTURA_QUADRO * largura / altura / 2) * 2)
    # ~2 por segundo em vídeos curtos, no máximo 300 (e a imagem com menos de 60 mil px de largura).
    n = int(max(1, min(300, duracao * 2, 60000 // l)))
    # Um pouco menos que a duração: a trilha de vídeo às vezes acaba antes da de áudio.
    passo = duracao * 0.98 / n
    _rodar([
        "ffmpeg", "-y", "-v", "error", "-i", str(previa),
        "-vf", f"fps=1/{passo:.5f}:round=down,scale={l}:{ALTURA_QUADRO},tile={n}x1",
        "-frames:v", "1", "-q:v", "5", str(pasta / "quadros.jpg"),
    ])
    info = {"n": n, "passo": passo, "largura": l, "altura": ALTURA_QUADRO}
    (pasta / "quadros.json").write_text(json.dumps(info))
    return info
