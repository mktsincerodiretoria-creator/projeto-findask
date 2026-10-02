"""Miniaturas da linha do tempo e "melhorar imagem" na exportação."""
import shutil
import subprocess

import numpy as np
import pytest

from app import exportar, midia

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa do ffmpeg")


def test_melhorar_imagem_limpa_antes_e_afia_depois_da_escala():
    f = exportar.filtro_saida(1080, 1920, 720, 1280, True, "suave")
    assert f[0].startswith("hqdn3d") and f[1].startswith("scale=1080:1920")
    assert f[2].startswith("unsharp")
    assert f.index("subtitles=legendas.ass") > f.index(f[2])   # a legenda não é afiada
    assert not any(e.startswith(("hqdn3d", "unsharp")) for e in exportar.filtro_saida(720, 1280, 720, 1280, False, "nao"))


def test_miniaturas_cobrem_o_video_inteiro(tmp_path):
    video = tmp_path / "v.mp4"
    # 6 s: metade preta, metade branca (a última miniatura tem que ser branca).
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=black:s=360x640:d=3:r=30",
                    "-f", "lavfi", "-i", "color=white:s=360x640:d=3:r=30",
                    "-filter_complex", "[0][1]concat=n=2:v=1", str(video)], check=True)
    info = midia.gerar_quadros(video, tmp_path, 6.0, 360, 640)
    assert info["n"] == 12 and info["altura"] == midia.ALTURA_QUADRO
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(tmp_path / "quadros.jpg"), "-f", "rawvideo",
                          "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    img = np.frombuffer(raw, np.uint8).reshape(info["altura"], -1)
    assert img.shape[1] == info["n"] * info["largura"]
    assert img[:, : info["largura"]].mean() < 30 and img[:, -info["largura"]:].mean() > 220
