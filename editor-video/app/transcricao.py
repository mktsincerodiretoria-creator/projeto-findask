"""Transcrição com tempo de cada palavra (faster-whisper, roda no seu computador)."""
from __future__ import annotations

import threading
from pathlib import Path

_modelos = {}
_trava = threading.Lock()

# Incentiva o Whisper a escrever as hesitações em vez de "limpar" a fala,
# senão os vícios de linguagem somem da transcrição e não dá para cortá-los.
PROMPT_INICIAL = "Hã, é... então, tipo, eu, eu vou... hum, né? Ahn, deixa eu ver."

MODELOS = ["tiny", "base", "small", "medium", "large-v3"]


def _carregar(nome: str):
    with _trava:
        if nome not in _modelos:
            from faster_whisper import WhisperModel
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                _modelos[nome] = WhisperModel(nome, device="cuda", compute_type="float16")
            else:
                _modelos[nome] = WhisperModel(nome, device="cpu", compute_type="int8")
        return _modelos[nome]


def transcrever(wav: Path, modelo: str = "small", idioma: str = "pt", progresso=None) -> list[dict]:
    """Devolve [{i, texto, inicio, fim, prob}] para cada palavra falada."""
    from .midia import ler_wav

    whisper = _carregar(modelo)
    # Passa o áudio já decodificado (16 kHz mono): não depende do decodificador
    # interno do faster-whisper, que quebrou com o PyAV 19.
    segmentos, info = whisper.transcribe(
        ler_wav(wav),
        language=idioma or None,
        word_timestamps=True,
        initial_prompt=PROMPT_INICIAL,
        condition_on_previous_text=False,
        beam_size=5,
        vad_filter=False,
    )
    palavras = []
    for seg in segmentos:
        for w in seg.words or []:
            texto = w.word.strip()
            if not texto:
                continue
            palavras.append({
                "i": len(palavras),
                "texto": texto,
                "inicio": round(float(w.start), 3),
                "fim": round(float(max(w.end, w.start + 0.02)), 3),
                "prob": round(float(w.probability), 3),
            })
        if progresso and info.duration:
            progresso(min(1.0, seg.end / info.duration))
    return palavras
