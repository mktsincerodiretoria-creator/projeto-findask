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


# ---------------------------------------------------------------- formato e enquadramento

from app import movimento as mv  # noqa: E402

SEM_MOV = mv.normalizar({"tracking": False, "auto": False})


def _aplicar(M, x, y):
    return (M[0, 0] * x + M[0, 1] * y + M[0, 2], M[1, 0] * x + M[1, 1] * y + M[1, 2])


def test_tamanho_do_quadro_por_formato():
    assert mv.tamanho_quadro(1920, 1080, "original") == (1920, 1080)
    assert mv.tamanho_quadro(1920, 1080, "9:16") == (1080, 1920)
    assert mv.tamanho_quadro(1080, 1920, "1:1", 1080) == (1080, 1080)
    assert mv.tamanho_quadro(1080, 1920, "4:5") == (1080, 1350)
    assert mv.tamanho_quadro(1080, 1920, "16:9", 720) == (1280, 720)
    assert mv.tamanho_quadro(1280, 720, "original", 1080) == (1920, 1080)


def test_video_deitado_no_9x16_aparece_inteiro_e_centralizado():
    enq = mv.normalizar_enquadramento({"formato": "9:16"})
    M = mv.matriz(0, SEM_MOV, None, enq, 1280, 720, 1080, 1920)
    x0, y0 = _aplicar(M, 0, 0)
    x1, y1 = _aplicar(M, 1280, 720)
    assert (x0, x1) == pytest.approx((0, 1080))                    # ocupa a largura toda
    assert y0 == pytest.approx(1920 / 2 - 720 * 1080 / 1280 / 2)  # centralizado, com faixas
    assert y1 == pytest.approx(1920 - y0)


def test_escala_posicao_e_giro():
    enq = mv.normalizar_enquadramento({"formato": "1:1", "escala": 2, "x": 0.1, "y": 0, "rotacao": 90})
    M = mv.matriz(0, SEM_MOV, None, enq, 1000, 1000, 1000, 1000)
    assert _aplicar(M, 500, 500) == pytest.approx((600, 500))      # o centro anda 10% para o lado
    x, y = _aplicar(M, 600, 500)                                    # 100 px à direita, girado 90°
    assert (x, y) == pytest.approx((600, 700))


def test_tracking_segue_o_rosto_so_ate_a_borda():
    trilha = {"t": [0, 10], "x": [0.9, 0.9], "y": [0.5, 0.5], "cobertura": 1}
    # deitado preenchendo o 9:16: sobra imagem dos lados, o quadro anda para o rosto (à direita)
    w, h, W, H = 1920, 1080, 1080, 1920
    escala_preencher = (H / h) / (W / w)
    enq = mv.normalizar_enquadramento({"formato": "9:16", "escala": escala_preencher})

    def centro(forca):   # que ponto do vídeo (x) aparece no meio do quadro
        M = mv.matriz(1, mv.normalizar({"tracking": True, "forca_tracking": forca, "auto": False}),
                      trilha, enq, w, h, W, H)
        return (W / 2 - M[0, 2]) / M[0, 0]
    assert centro(0) == pytest.approx(w / 2)                       # força 0: fica no meio
    assert centro(1) > centro(0.5) > w / 2                          # mais força, mais perto do rosto
    M = mv.matriz(1, mv.normalizar({"tracking": True, "forca_tracking": 1, "auto": False}), trilha, enq, w, h, W, H)
    assert _aplicar(M, w, 0)[0] == pytest.approx(W)                # nunca mostra borda preta


def _gerar(caminho, filtro_cor="", extra=()):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=white:s=640x360:d=2:r=25",
                    "-f", "lavfi", "-i", "sine=d=2", *extra, "-shortest", str(caminho)], check=True)


def test_exportar_no_9x16_tem_faixas_pretas_e_nao_corta(tmp_path):
    video = tmp_path / "v.mp4"
    _gerar(video, extra=["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    meta = midia.sondar(video)
    r = exportar.exportar(tmp_path, video, meta, [], [], {}, {"resolucao": "720", "legenda": "nenhuma",
                          "velocidade": "rapida"}, "saida", enq={"formato": "9:16"}, mov={"auto": False})
    assert (r["largura"], r["altura"]) == (720, 1280)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(tmp_path / "saida.mp4"), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    img = np.frombuffer(raw, np.uint8).reshape(1280, 720)
    faixa = (1280 - 405) // 2
    assert img[: faixa - 4].mean() < 20 and img[-(faixa - 4):].mean() < 20   # faixas pretas
    assert img[faixa + 6: 1280 - faixa - 6].mean() > 230                    # vídeo inteiro no meio


def test_video_hdr_e_detectado_e_convertido(tmp_path):
    if not midia.tem_zscale():
        pytest.skip("ffmpeg sem zscale")
    video = tmp_path / "hdr.mp4"
    _gerar(video, extra=["-vf", "format=yuv420p10le", "-c:v", "libx264", "-profile:v", "high10",
                         "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc"])
    meta = midia.sondar(video)
    assert meta["hdr"] is True
    assert midia.filtro_hdr(meta)
    r = exportar.exportar(tmp_path, video, meta, [], [], {}, {"legenda": "nenhuma", "velocidade": "rapida"}, "s")
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0",
                           str(tmp_path / r["video"])], capture_output=True, text=True).stdout
    assert "yuv420p" in info
