"""Zoom in / zoom out e tracking: a curva, os zooms automáticos e a exportação."""
import shutil
import subprocess

import numpy as np
import pytest

from app import exportar, midia, movimento as m
from testes.test_analise import falas


def mov(**kw):
    return m.normalizar({"tracking": True, "auto": True, **kw})


def test_sem_zoom_o_quadro_fica_inteiro():
    assert m.janela(3.0, mov(), None) == (1.0, 0.0, 0.0)
    assert not m.tem_efeito(mov())


def test_zooms_sobrepostos_nao_somam():
    z = mov(zooms=[{"inicio": 0, "fim": 4, "intensidade": 0.1, "estilo": "corte"},
                   {"inicio": 1, "fim": 3, "intensidade": 0.15, "estilo": "corte"}])
    assert m.zoom_em(2, z) == pytest.approx(1.15)
    assert m.zoom_em(0.5, z) == pytest.approx(1.1)


def test_zoom_suave_entra_e_sai_devagar_e_corte_e_seco():
    s = mov(zooms=[{"inicio": 1, "fim": 3, "intensidade": 0.2, "estilo": "suave"}])
    c = mov(zooms=[{"inicio": 1, "fim": 3, "intensidade": 0.2, "estilo": "corte"}])
    assert m.zoom_em(0.99, s) == 1.0
    assert 1.0 < m.zoom_em(1.15, s) < 1.2          # ainda aproximando
    assert m.zoom_em(2.0, s) == pytest.approx(1.2)  # no meio, zoom completo
    assert m.zoom_em(1.01, c) == pytest.approx(1.2)  # corte seco: de uma vez


def test_nunca_exagera_nem_sai_do_quadro():
    z = mov(zoom_base=0.5, intensidade=0.9,
            zooms=[{"inicio": 0, "fim": 5, "intensidade": 0.9}, {"inicio": 0, "fim": 5, "intensidade": 0.9}])
    assert z["zoom_base"] == 0.2 and z["zooms"][0]["intensidade"] == 0.25
    assert m.zoom_em(2.5, z) <= m.ZOOM_MAX
    # rosto colado na borda: o recorte para no limite da imagem
    trilha = {"t": [0, 10], "x": [0.99, 0.99], "y": [0.01, 0.01]}
    zz, x0, y0 = m.janela(2.5, z, trilha)
    w = 1 / zz
    assert 0 <= x0 <= 1 - w + 1e-9 and 0 <= y0 <= 1 - w + 1e-9
    assert x0 == pytest.approx(1 - w)


def test_tracking_segue_o_rosto_so_quando_aproxima():
    trilha = {"t": [0, 4], "x": [0.3, 0.7], "y": [0.5, 0.5]}
    z = mov(zooms=[{"inicio": 0, "fim": 4, "intensidade": 0.25, "estilo": "corte"}])
    _, xa, _ = m.janela(0.5, z, trilha)
    _, xb, _ = m.janela(3.5, z, trilha)
    assert xb > xa                                     # o quadro foi junto com o rosto
    sem = m.normalizar({**z, "tracking": False})
    assert m.janela(0.5, sem, trilha)[1] == pytest.approx((1 - 1 / 1.25) / 2)


def test_suavizar_preenche_falhas_e_descarta_sem_rosto():
    amostras = [[i / 4, 0.4 + i * 0.01, 0.5, 0.2] if i % 3 else [i / 4, None, None, None] for i in range(40)]
    tr = m.suavizar(amostras)
    assert len(tr["t"]) == 40 and tr["cobertura"] == pytest.approx(26 / 40, abs=0.01)
    assert all(np.diff(tr["x"]) >= -1e-6)  # continua indo para a direita, sem tremer
    vazio = m.suavizar([[i / 4, None, None, None] for i in range(20)])
    assert vazio["t"] == []


def _texto_longo():
    frases = ["Olá pessoal tudo bem?", "Hoje vou mostrar uma receita.", "Primeiro separe os ingredientes.",
              "Depois misture tudo com calma.", "Isso é muito importante!", "Agora leve ao forno.",
              "Espere trinta minutos.", "E pronto, ficou lindo!", "Gostou? Deixe seu comentário."] * 3
    itens = []
    for f in frases:
        for k, w in enumerate(f.split()):
            itens.append((w, 0.8 if k == 0 else 0.05))
    return falas(*itens)


def test_zooms_automaticos_respeitam_sensibilidade_e_espacamento():
    p = _texto_longo()
    dur = p[-1]["fim"] + 1
    poucos = m.gerar_zooms(p, [], dur, mov(sensibilidade=0.0))
    muitos = m.gerar_zooms(p, [], dur, mov(sensibilidade=1.0))
    assert 0 < len(poucos) < len(muitos)
    for zs in (poucos, muitos):
        for a, b in zip(zs, zs[1:]):
            assert b["inicio"] - a["fim"] > 1.5           # nunca um em cima do outro
        assert all(1.2 <= z["fim"] - z["inicio"] <= 4.0 for z in zs)
    # começam no início de uma palavra (começo de frase)
    inicios = {w["inicio"] for w in p}
    assert all(z["inicio"] in inicios for z in muitos)


def test_refazer_mantem_os_zooms_que_voce_ajustou():
    p = _texto_longo()
    dur = p[-1]["fim"] + 1
    meu = {"id": "meu", "inicio": 1.0, "fim": 2.5, "intensidade": 0.1, "origem": "manual"}
    novo = m.refazer_automaticos(mov(zooms=[meu]), p, [], dur)
    assert any(z["id"] == "meu" for z in novo["zooms"])
    assert any(z["origem"] == "auto" for z in novo["zooms"])
    # nenhum automático em cima (ou colado) no seu
    assert all(z["inicio"] >= 2.5 + 1.5 or z["fim"] <= 1.0 - 1.5 for z in novo["zooms"] if z["origem"] == "auto")
    desligado = m.refazer_automaticos({**novo, "auto": False}, p, [], dur)
    assert [z["id"] for z in desligado["zooms"]] == ["meu"]


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa de ffmpeg")
def test_exportacao_aplica_o_zoom_no_quadro_certo(tmp_path):
    """Um quadrado branco no centro: com zoom de 25% ele tem que ficar 25% maior na saída."""
    entrada = tmp_path / "quadrado.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=10:d=3",
        "-f", "lavfi", "-i", "sine=d=3", "-vf", "drawbox=x=140:y=100:w=40:h=40:color=white:t=fill",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(entrada)], check=True)
    meta = midia.sondar(entrada)
    z = mov(tracking=False, zooms=[{"inicio": 1.0, "fim": 2.9, "intensidade": 0.25, "estilo": "corte"}])
    exportar.exportar(tmp_path, entrada, meta, [], [], {}, {"legenda": "nenhuma", "velocidade": "rapida"},
                      "saida", mov=z)

    def largura_branca(t):
        cru = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(tmp_path / "saida.mp4"),
                              "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
                             capture_output=True, check=True).stdout
        linha = np.frombuffer(cru, np.uint8).reshape(240, 320)[120]
        return int((linha > 128).sum())

    antes, durante = largura_branca(0.5), largura_branca(2.0)
    assert antes == pytest.approx(40, abs=3)
    assert durante == pytest.approx(50, abs=3)   # 40 px * 1.25
