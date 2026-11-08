"""Dividir vídeo em partes de até 28 MB (para subir no Claude, WhatsApp...)."""
import importlib
import json
import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from app.dividir import escolher_cortes

precisa_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa do ffmpeg")


def _partes(tamanhos, cortes):
    limites = [0, *cortes, len(tamanhos)]
    return [sum(tamanhos[a:b]) for a, b in zip(limites, limites[1:])]


def test_escolhe_o_minimo_de_partes_do_mesmo_tamanho():
    tamanhos = [10] * 10   # 10 pedaços de 10 entre quadros-chave; até 35 por parte
    partes = _partes(tamanhos, escolher_cortes(tamanhos, 35))
    assert len(partes) == 4 and sorted(partes) == [20, 20, 30, 30]   # e não 30/30/30/10
    # bitrate variando no meio do vídeo: as partes continuam abaixo do limite e parecidas
    tamanhos = [2] * 30 + [9] * 10 + [2] * 30
    partes = _partes(tamanhos, escolher_cortes(tamanhos, 40))
    assert len(partes) == 6 and max(partes) <= 40 and min(partes) >= 30
    # muitos pedaços pequenos (vídeo com quadro-chave a cada segundo): quase idênticas
    tamanhos = [3, 4, 5] * 200
    partes = _partes(tamanhos, escolher_cortes(tamanhos, 500))
    assert len(partes) == 5 and max(partes) <= 500 and max(partes) - min(partes) <= 10
    # vídeo que já cabe: uma parte só
    assert escolher_cortes([5, 5, 5], 100) == []
    # um pedaço sozinho maior que o limite: sem recomprimir não tem como
    assert escolher_cortes([5, 50, 5], 40) is None


@pytest.fixture()
def cliente(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    from app import projetos
    importlib.reload(projetos)
    from app import main
    importlib.reload(main)
    with TestClient(main.app) as c:
        yield main, projetos, c


def _video(caminho, segundos, taxa="16M"):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=s=1280x720:r=30:d={segundos}",
                    "-f", "lavfi", "-i", f"sine=d={segundos}", "-c:v", "libx264", "-preset", "ultrafast",
                    "-b:v", taxa, "-minrate", taxa, "-maxrate", taxa, "-bufsize", "4M", "-g", "30",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(caminho)], check=True)
    return caminho


def _esperar(c, did, status, limite=120):
    fim = time.time() + limite
    while time.time() < fim:
        info = c.get(f"/api/dividir/{did}").json()
        if info["status"] in status:
            return info
        time.sleep(0.2)
    raise TimeoutError(info)


@precisa_ffmpeg
def test_divide_em_partes_iguais_de_ate_28_mb_e_baixa(cliente, tmp_path):
    main, projetos, c = cliente
    video = _video(tmp_path / "Minha aula.mp4", 32)
    tamanho = video.stat().st_size
    assert tamanho > 56_000_000   # não cabe em 2 partes de 28 MB
    with open(video, "rb") as f:
        r = c.post("/api/dividir", files={"arquivo": ("Minha aula.mp4", f, "video/mp4")}, data={"leve": "0"})
    assert r.status_code == 200
    did = r.json()["id"]
    info = _esperar(c, did, ("pronto", "erro"))
    assert info["status"] == "pronto", info.get("erro")
    partes = info["partes"]
    assert len(partes) == 3   # o mínimo possível
    assert all(p["bytes"] <= 28_000_000 for p in partes)
    assert max(p["bytes"] for p in partes) - min(p["bytes"] for p in partes) < 0.15 * tamanho / 3   # do mesmo tamanho
    assert [p["arquivo"] for p in partes] == [f"Minha aula_parte_0{i}_de_03.mp4" for i in (1, 2, 3)]
    assert abs(sum(p["duracao"] for p in partes) - 32) < 0.2 and partes[1]["inicio"] > 0
    # cada parte baixa inteira e é um vídeo que abre sozinho (vídeo + áudio)
    for p in partes:
        r = c.get(f"/api/dividir/{did}/{p['arquivo']}")
        assert r.status_code == 200 and len(r.content) == p["bytes"]
        assert "attachment" in r.headers["content-disposition"]
    baixado = tmp_path / "parte2.mp4"
    baixado.write_bytes(c.get(f"/api/dividir/{did}/{partes[1]['arquivo']}").content)
    trilhas = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
                                         "-of", "json", str(baixado)], capture_output=True, text=True).stdout)["streams"]
    assert {t["codec_type"] for t in trilhas} == {"video", "audio"}
    assert abs(float(trilhas[0]["duration"]) - partes[1]["duracao"]) < 0.2
    pasta = projetos.RAIZ / "divisoes" / did
    assert not list(pasta.glob("original.*"))   # o vídeo inteiro não fica ocupando o disco
    # só as partes dessa divisão
    assert c.get(f"/api/dividir/{did}/info.json").status_code == 404
    assert c.get(f"/api/dividir/{did}/..%2Finfo.json").status_code == 404
    assert c.get("/api/dividir/naoexiste").status_code == 404
    # apagar (já terminou): some do disco
    assert c.delete(f"/api/dividir/{did}").status_code == 200
    assert not pasta.exists()


@precisa_ffmpeg
def test_versao_leve_e_cancelar(cliente, tmp_path):
    main, projetos, c = cliente
    video = _video(tmp_path / "longo.mp4", 90, "3M")
    with open(video, "rb") as f:
        did = c.post("/api/dividir", files={"arquivo": ("longo.mp4", f, "video/mp4")}, data={"leve": "1"}).json()["id"]
    _esperar(c, did, ("dividindo", "pronto"))
    assert c.delete(f"/api/dividir/{did}").status_code == 200
    info = _esperar(c, did, ("cancelada", "pronto", "erro"), 30)
    assert info["status"] == "cancelada"
    pasta = projetos.RAIZ / "divisoes" / did
    assert [a.name for a in pasta.iterdir()] == ["info.json"]   # o ffmpeg parou e não sobrou nada
    # de novo, até o fim: 720p, uma parte só (o vídeo leve cabe em 28 MB)
    with open(video, "rb") as f:
        did = c.post("/api/dividir", files={"arquivo": ("longo.mp4", f, "video/mp4")}, data={"leve": "1"}).json()["id"]
    info = _esperar(c, did, ("pronto", "erro"))
    assert info["status"] == "pronto", info.get("erro")
    assert len(info["partes"]) == 1 and info["partes"][0]["bytes"] < video.stat().st_size
    altura = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height",
                             "-of", "csv=p=0", str(projetos.RAIZ / "divisoes" / did / info["partes"][0]["arquivo"])],
                            capture_output=True, text=True).stdout.strip()
    assert altura == "720"
