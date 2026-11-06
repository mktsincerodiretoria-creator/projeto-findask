"""Áudio da exportação: voz no volume das redes, música que abaixa na fala e o whoosh nos zooms."""
import re
import shutil
import subprocess

import numpy as np
import pytest

from app import audio, exportar, midia

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa do ffmpeg")


def _video(caminho, audio_lavfi, segundos=6):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=gray:s=320x240:r=25:d={segundos}",
                    "-f", "lavfi", "-i", audio_lavfi, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-b:a", "192k", "-shortest", str(caminho)], check=True)


def _som(caminho):
    cru = subprocess.run(["ffmpeg", "-v", "error", "-i", str(caminho), "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(cru, np.float32)


def _nivel(sinal, f_min, f_max):
    """Nível (dB) da faixa de frequência [f_min, f_max] Hz no trecho."""
    espectro = np.abs(np.fft.rfft(sinal * np.hanning(len(sinal)))) ** 2
    freqs = np.fft.rfftfreq(len(sinal), 1 / 48000)
    return 10 * np.log10(espectro[(freqs >= f_min) & (freqs <= f_max)].sum() + 1e-12)


def test_melhorar_voz_deixa_no_volume_das_redes(tmp_path):
    video = tmp_path / "baixinho.mp4"
    _video(video, "sine=frequency=220:sample_rate=48000,volume=0.03")   # voz bem baixinha (-33 dBFS)
    r = exportar.exportar(tmp_path, video, midia.sondar(video), [], [], {}, {"legenda": "nenhuma", "velocidade": "rapida"},
                          "s", audio={"melhorar_voz": True})
    medida = subprocess.run(["ffmpeg", "-i", str(tmp_path / r["video"]), "-af", "ebur128", "-f", "null", "-"],
                            capture_output=True, text=True).stderr
    integrado = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", medida)[-1])
    assert -16.5 < integrado < -11.5


def test_musica_abaixa_quando_voce_fala(tmp_path):
    video = tmp_path / "fala.mp4"
    # "voz" (1 kHz) nos 3 primeiros segundos, silêncio nos 3 últimos
    _video(video, "aevalsrc='0.3*sin(2*PI*1000*t)*lt(t,3)':s=48000:d=6")
    musica = tmp_path / "musica.wav"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=200:sample_rate=48000:d=2",
                    str(musica)], check=True)   # 2 s: tem que repetir até o fim do vídeo
    cfg = {"melhorar_voz": False, "musica": "musica.wav", "volume_musica": 0.5, "abaixar_na_fala": True}
    r = exportar.exportar(tmp_path, video, midia.sondar(video), [], [], {}, {"legenda": "nenhuma", "velocidade": "rapida"},
                          "s", audio=cfg)
    som = _som(tmp_path / r["video"])
    falando, calado = som[int(1.0 * 48000):int(2.5 * 48000)], som[int(3.8 * 48000):int(4.6 * 48000)]
    tamanho = min(len(falando), len(calado))
    # (a música tem 2 s: tocar alto depois de 3,8 s também mostra que ela repete até o fim)
    assert _nivel(calado[:tamanho], 150, 250) - _nivel(falando[:tamanho], 150, 250) > 8   # abaixou na fala
    sem = exportar.exportar(tmp_path, video, midia.sondar(video), [], [], {}, {"legenda": "nenhuma", "velocidade": "rapida"},
                            "s2", audio={**cfg, "abaixar_na_fala": False})
    som2 = _som(tmp_path / sem["video"])
    f2, c2 = som2[int(1.0 * 48000):int(2.5 * 48000)], som2[int(3.8 * 48000):int(4.6 * 48000)]
    t2 = min(len(f2), len(c2))
    assert abs(_nivel(c2[:t2], 150, 250) - _nivel(f2[:t2], 150, 250)) < 3   # desligado: volume igual


def test_whoosh_quando_o_zoom_muda_no_corte(tmp_path):
    video = tmp_path / "zoom.mp4"
    _video(video, "sine=frequency=300:sample_rate=48000,volume=0.2", segundos=5)
    cortes = [{"id": "c", "inicio": 2.0, "fim": 2.5, "ativo": True}]
    r = exportar.exportar(tmp_path, video, midia.sondar(video), [], cortes, {},
                          {"legenda": "nenhuma", "velocidade": "rapida"}, "s",
                          mov={"auto": False, "tracking": False, "punch": True, "forca_punch": 0.15},
                          audio={"melhorar_voz": False, "efeito_zoom": True})
    som = _som(tmp_path / r["video"])
    junta, longe = som[int(1.85 * 48000):int(2.15 * 48000)], som[int(0.6 * 48000):int(0.9 * 48000)]
    assert _nivel(junta, 1500, 8000) - _nivel(longe, 1500, 8000) > 20   # o "vuuush" fica bem em cima do corte
    assert not (tmp_path / "efeitos.wav").exists()


def test_audio_normalizar_nao_aceita_caminho_de_fora():
    assert audio.normalizar({"musica": "../../senhas.txt"})["musica"] is None
    assert audio.normalizar({"musica": "musica.mp3"})["musica"] == "musica.mp3"
    assert audio.normalizar({})["melhorar_voz"] is True
