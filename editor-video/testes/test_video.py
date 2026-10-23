"""Miniaturas da linha do tempo e "melhorar imagem" na exportação."""
import shutil
import subprocess

import numpy as np
import pytest

from app import exportar, midia

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa do ffmpeg")


def test_melhorar_imagem_afia_depois_da_escala_e_nunca_mistura_quadros():
    f = exportar.filtro_saida(1080, 1920, 720, 1280, True, "suave")
    assert f[0].startswith("scale=1080:1920") and f[1].startswith(("cas", "unsharp"))
    assert f.index("subtitles=legendas.ass") > 1   # a legenda não é afiada
    forte = exportar.filtro_saida(1080, 1920, 720, 1280, False, "forte")
    assert forte[0].startswith("hqdn3d") and forte[1].startswith("scale=1080:1920")
    # o granulado sai só dentro de cada quadro: misturar quadros borra o movimento e deixa rastro nos cortes
    assert forte[0].split("=")[1].split(":")[2:] == ["0", "0"]
    nada = exportar.filtro_saida(720, 1280, 720, 1280, False, "nao")
    assert not any(e.startswith(("hqdn3d", "unsharp", "cas")) for e in nada)


def test_taxa_de_quadros_da_saida():
    from fractions import Fraction
    assert exportar.taxa_saida(29.97) == Fraction(30000, 1001)
    assert exportar.taxa_saida(23.998) == 24                     # celular com taxa variável
    assert exportar.taxa_saida(59.94) == Fraction(60000, 1001)
    assert exportar.taxa_saida(240) == 60                        # câmera lenta: no máximo 60
    assert exportar.taxa_saida(10) == 10 and exportar.taxa_saida(0) == 30


def _contador(caminho, segundos=6):
    """Vídeo que mostra o número do quadro em 8 faixas pretas/brancas (bits), com som."""
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=black:s=320x240:r=30:d={segundos}",
                    "-f", "lavfi", "-i", f"sine=d={segundos}",
                    "-vf", "geq=lum='if(bitand(N,pow(2,floor(X/40))),235,16)':cb=128:cr=128",
                    "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(caminho)],
                   check=True)


def _numeros(caminho, largura, altura):
    """Número de cada quadro exportado (o vídeo ocupa a largura toda nos dois formatos testados)."""
    cru = subprocess.run(["ffmpeg", "-v", "error", "-i", str(caminho), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, check=True).stdout
    q = np.frombuffer(cru, np.uint8).reshape(-1, altura, largura)
    linha = q[:, altura // 2, :].astype(float)
    centros = [int((b + 0.5) * largura / 8) for b in range(8)]
    return [sum(1 << b for b, x in enumerate(centros) if lin[x - 2: x + 3].mean() > 128) for lin in linha]


def _duracoes(caminho):
    saida = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0",
                            str(caminho)], capture_output=True, text=True, check=True).stdout
    return {linha.split(",")[0]: float(linha.split(",")[1]) for linha in saida.split()}


@pytest.mark.parametrize("enq", [None, {"formato": "9:16", "x": 0.004}])
def test_emendas_sem_quadro_repetido_e_som_junto_com_a_imagem(tmp_path, enq):
    """Era a "travadinha": quadro repetido (ou pulado) em cada corte e o som escorregando."""
    video = tmp_path / "contador.mp4"
    _contador(video)
    meta = midia.sondar(video)
    cortes = [{"id": str(i), "inicio": 0.41 + i * 0.73, "fim": 0.41 + i * 0.73 + 0.217, "ativo": True}
              for i in range(7)]
    r = exportar.exportar(tmp_path, video, meta, [], cortes, {}, {"legenda": "nenhuma", "velocidade": "rapida"},
                          "saida", enq=enq, mov={"auto": False})
    n = _numeros(tmp_path / "saida.mp4", r["largura"], r["altura"])
    passos = [b - a for a, b in zip(n, n[1:])]
    assert 0 not in passos                                  # nenhum quadro repetido
    assert sum(p != 1 for p in passos) == len(cortes)       # só pula onde tem corte
    assert len(n) == round(r["duracao"] * 30)
    d = _duracoes(tmp_path / "saida.mp4")
    assert abs(d["audio"] - d["video"]) < 1 / 30 + 0.001


@pytest.mark.parametrize("enq", [None, {"formato": "9:16"}])
def test_cor_nao_desloca_com_filtro_de_cor_e_sai_etiquetada(tmp_path, enq):
    video = tmp_path / "laranja.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0xE08030:s=640x360:r=25:d=1",
                    "-f", "lavfi", "-i", "sine=d=1", "-vf", "scale=out_color_matrix=bt709,format=yuv420p",
                    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                    "-c:v", "libx264", "-crf", "1", "-c:a", "aac", "-shortest", str(video)], check=True)
    meta = midia.sondar(video)
    r = exportar.exportar(tmp_path, video, meta, [], [], {}, {"legenda": "nenhuma", "velocidade": "rapida"}, "s",
                          filtro={"id": "cinema", "intensidade": 0.0001}, enq=enq, mov={"auto": False})

    def cor_do_meio(arquivo, largura, altura):
        cru = subprocess.run(["ffmpeg", "-v", "error", "-i", str(arquivo), "-frames:v", "1", "-vf",
                              "scale=in_color_matrix=bt709,format=rgb24", "-f", "rawvideo", "-"],
                             capture_output=True, check=True).stdout
        img = np.frombuffer(cru, np.uint8).reshape(altura, largura, 3)
        return img[altura // 2 - 20: altura // 2 + 20, largura // 2 - 20: largura // 2 + 20].reshape(-1, 3).mean(axis=0)
    # filtro quase neutro: a cor tem que sair a mesma (antes deslocava ~35 de 255)
    antes, depois = cor_do_meio(video, 640, 360), cor_do_meio(tmp_path / r["video"], r["largura"], r["altura"])
    assert np.abs(antes - depois).max() < 4
    etiqueta = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                               "stream=color_space,color_primaries,color_transfer", "-of", "csv=p=0",
                               str(tmp_path / r["video"])], capture_output=True, text=True).stdout.strip()
    assert etiqueta == "bt709,bt709,bt709"


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


def test_legenda_desligada_sai_sem_legenda(tmp_path):
    video = tmp_path / "v.mp4"
    _gerar(video, extra=["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    meta = midia.sondar(video)
    pal = [{"i": 0, "texto": "Olá", "inicio": 0.2, "fim": 0.8, "prob": 1},
           {"i": 1, "texto": "mundo", "inicio": 0.9, "fim": 1.5, "prob": 1}]
    opcoes = {"resolucao": "original", "legenda": "gravada", "velocidade": "rapida"}
    ligada = exportar.exportar(tmp_path, video, meta, pal, [], {"ativa": True}, opcoes, "com")
    desligada = exportar.exportar(tmp_path, video, meta, pal, [], {"ativa": False}, opcoes, "sem")
    assert "legenda" in ligada and "legenda" not in desligada
    filtro = (tmp_path / "filtro.txt").read_text()
    assert "subtitles" not in filtro          # nada gravado no vídeo
