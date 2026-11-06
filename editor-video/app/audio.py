"""Áudio do vídeo final: voz mais limpa, música de fundo que abaixa sozinha quando você fala e o
"whoosh" quando o zoom muda nos cortes. Tudo é aplicado na exportação (a prévia toca a música)."""
from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

AUDIO_PADRAO = {
    "melhorar_voz": True,      # tira ruído, iguala o volume das falas e deixa no padrão do Instagram
    "musica": None,            # arquivo da música, dentro da pasta do projeto ("musica.mp3")
    "musica_nome": "",         # nome do arquivo que você escolheu (só para mostrar)
    "volume_musica": 0.25,     # 25%: fica por baixo da voz
    "abaixar_na_fala": True,   # a música abaixa quando você fala e volta nas pausas
    "efeito_zoom": False,      # "whoosh" quando o zoom muda nos cortes
}
EXTENSOES_MUSICA = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"}
TAXA = 48000
# Volume padrão das redes (Instagram, TikTok e YouTube tocam tudo perto de -14 LUFS).
VOLUME_REDES = "loudnorm=I=-14:TP=-1.5:LRA=11"
ESTEREO = f"aformat=sample_rates={TAXA}:channel_layouts=stereo"


def normalizar(cfg: dict | None) -> dict:
    cfg = {**AUDIO_PADRAO, **(cfg or {})}
    for chave in ("melhorar_voz", "abaixar_na_fala", "efeito_zoom"):
        cfg[chave] = bool(cfg[chave])
    cfg["volume_musica"] = min(1.0, max(0.0, float(cfg["volume_musica"])))
    musica = cfg.get("musica")
    # só um arquivo "musica.xxx" da própria pasta do projeto
    cfg["musica"] = musica if isinstance(musica, str) and musica == Path(musica).name and musica.startswith("musica") else None
    cfg["musica_nome"] = str(cfg.get("musica_nome") or "")[:120]
    return {k: cfg[k] for k in AUDIO_PADRAO}


def cadeia_voz(cfg: dict) -> list[str]:
    """Voz mais limpa: tira o grave do ruído (ar-condicionado, trânsito), o chiado de fundo e
    deixa as falas com volume parecido (as baixinhas sobem, os picos não estouram)."""
    if not cfg["melhorar_voz"]:
        return []
    return ["highpass=f=75", "afftdn=nr=10:nf=-50:tn=1",
            "acompressor=threshold=-20dB:ratio=3:attack=10:release=150:makeup=2"]


def filtro_final(cfg: dict, total: float, entrada_musica: int | None = None,
                 entrada_efeitos: int | None = None) -> list[str]:
    """Do áudio já cortado ([ac]) até o áudio final ([aout]): voz, música e efeitos."""
    voz = cadeia_voz(cfg) + [ESTEREO]
    linhas = [f"[ac]{','.join(voz)}[voz]"]
    if entrada_musica is None and entrada_efeitos is None:
        linhas.append(f"[voz]{VOLUME_REDES + ',' if cfg['melhorar_voz'] else ''}aresample={TAXA}[aout]")
        return linhas
    partes = ["[voz_mix]"]
    if entrada_musica is not None:
        fade = min(2.0, total / 4)
        linhas.append(
            f"[{entrada_musica}:a]{ESTEREO},atrim=0:{total:.3f},asetpts=PTS-STARTPTS,volume={cfg['volume_musica']:.3f},"
            f"afade=t=in:d=0.5,afade=t=out:st={max(0.0, total - fade):.3f}:d={fade:.3f}[mus]")
        if cfg["abaixar_na_fala"]:
            # a voz comanda a música: falou, a música desce uns 15 dB; parou, ela volta devagar
            linhas.append("[voz]asplit=2[voz_mix][voz_chave]")
            linhas.append("[mus][voz_chave]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=450[mus_mix]")
        else:
            linhas.append("[voz]anull[voz_mix]")
            linhas.append("[mus]anull[mus_mix]")
        partes.append("[mus_mix]")
    else:
        linhas.append("[voz]anull[voz_mix]")
    if entrada_efeitos is not None:
        linhas.append(f"[{entrada_efeitos}:a]{ESTEREO}[efeitos]")
        partes.append("[efeitos]")
    linhas.append(f"{''.join(partes)}amix=inputs={len(partes)}:duration=first:normalize=0[mix]")
    linhas.append(f"[mix]{VOLUME_REDES + ',' if cfg['melhorar_voz'] else ''}aresample={TAXA}[aout]")
    return linhas


def _whoosh(duracao: float = 0.42) -> np.ndarray:
    """Um "vuuush" sintetizado aqui mesmo (ruído com o agudo subindo e descendo)."""
    n = int(duracao * TAXA)
    t = np.arange(n) / TAXA
    ruido = np.random.default_rng(7).standard_normal(n)
    corte = 250 + 4500 * np.sin(np.pi * t / duracao) ** 2       # o "tom" do vento sobe e desce
    coef = np.exp(-2 * np.pi * corte / TAXA)
    som, acc = np.empty(n), 0.0
    for i in range(n):
        acc = coef[i] * acc + (1 - coef[i]) * ruido[i]
        som[i] = acc
    som *= np.sin(np.pi * np.clip(t / duracao, 0, 1)) ** 1.6       # entra e sai suave
    return som / np.abs(som).max() * 0.25


def escrever_efeitos(caminho: Path, tempos: list[float], total: float) -> None:
    """Trilha de efeitos (WAV): um whoosh com o meio em cima de cada tempo (vídeo final)."""
    som = (_whoosh() * 32767).astype(np.int16)
    meio, fim_total = len(som) // 2, int(total * TAXA)
    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAXA)
        pos = 0
        for t in sorted(tempos):
            ini = max(pos, int(t * TAXA) - meio)
            if ini >= fim_total:
                break
            while pos < ini:   # silêncio em pedaços (sem criar um arquivo gigante na memória)
                passo = min(ini - pos, TAXA * 10)
                w.writeframes(np.zeros(passo, np.int16).tobytes())
                pos += passo
            fim = min(ini + len(som), fim_total)
            w.writeframes(som[: fim - ini].tobytes())
            pos = fim
        w.writeframes(np.zeros(TAXA // 10, np.int16).tobytes())


def tempos_dos_zooms(mantidos, mov: dict, zoom_em) -> list[float]:
    """Onde o zoom muda no vídeo final: nas emendas (zoom alternado) e no começo de cada zoom."""
    tempos, acumulado = [], 0.0
    for k, (a, b) in enumerate(mantidos):
        if k and abs(zoom_em(a + 1e-3, mov) - zoom_em(mantidos[k - 1][1] - 1e-3, mov)) >= 0.03:
            tempos.append(acumulado)
        for z in mov["zooms"]:
            if z.get("origem") != "punch" and z["ativo"] and a < z["inicio"] < b:
                tempos.append(acumulado + z["inicio"] - a)
        acumulado += b - a
    unicos = []
    for t in sorted(tempos):
        if not unicos or t - unicos[-1] >= 0.4:
            unicos.append(t)
    return unicos
