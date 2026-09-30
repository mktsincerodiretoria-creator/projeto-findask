"""Gera um vídeo de teste com fala sintética (espeak-ng) cheia de erros de gravação.

Cada palavra é sintetizada separadamente e colada com pausas conhecidas, então
sabemos o tempo exato de cada uma — isso substitui o Whisper nos testes.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

TAXA = 16000

# (frase, pausa antes em segundos)
ROTEIRO = [
    ("Olá pessoal, tudo bem?", 0.6),
    ("Hoje eu vou ensinar a fazer um bolo de chuc", 1.6),
    ("Hoje eu vou ensinar a fazer um bolo de cenoura.", 0.7),
    ("hã", 2.0),
    ("O preço é cinquenta desculpa", 0.6),
    ("o preço é quarenta reais.", 0.4),
    ("eu eu vou mostrar tudo passo a passo.", 1.3),
]
SILENCIO_FINAL = 1.2


def _falar(texto: str, destino: Path) -> np.ndarray:
    subprocess.run(["espeak-ng", "-v", "pt-br", "-s", "165", "-w", str(destino), texto], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(destino), "-ac", "1", "-ar", str(TAXA),
        str(destino.with_suffix(".16k.wav")),
    ], check=True)
    with wave.open(str(destino.with_suffix(".16k.wav"))) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    # Remove o silêncio que o espeak coloca antes e depois.
    alto = np.where(np.abs(a) > 0.02)[0]
    return a[alto[0]:alto[-1] + 1] if len(alto) else a


def gerar(pasta: Path) -> tuple[Path, list[dict]]:
    pasta.mkdir(parents=True, exist_ok=True)
    trilha = []
    palavras = []
    t = 0.0
    with tempfile.TemporaryDirectory() as tmp:
        n = 0
        for frase, pausa in ROTEIRO:
            trilha.append(np.zeros(int(pausa * TAXA), dtype=np.float32))
            t += pausa
            for k, palavra in enumerate(frase.split()):
                if k:
                    trilha.append(np.zeros(int(0.06 * TAXA), dtype=np.float32))
                    t += 0.06
                som = _falar(palavra, Path(tmp) / f"p{n}.wav")
                n += 1
                trilha.append(som)
                dur = len(som) / TAXA
                palavras.append({"i": len(palavras), "texto": palavra, "inicio": round(t, 3),
                                 "fim": round(t + dur, 3), "prob": 0.9})
                t += dur
        trilha.append(np.zeros(int(SILENCIO_FINAL * TAXA), dtype=np.float32))
        audio = np.concatenate(trilha)
        wav = Path(tmp) / "fala.wav"
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(TAXA)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        duracao = len(audio) / TAXA
        video = pasta / "teste.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate=30:duration={duracao}",
            "-i", str(wav), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(video),
        ], check=True)
    (pasta / "palavras.json").write_text(json.dumps(palavras, ensure_ascii=False, indent=1))
    return video, palavras


if __name__ == "__main__":
    destino = Path(sys.argv[1] if len(sys.argv) > 1 else "video_teste")
    v, p = gerar(destino)
    print(v, len(p), "palavras")
