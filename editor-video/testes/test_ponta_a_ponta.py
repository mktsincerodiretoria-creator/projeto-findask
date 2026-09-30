"""Fluxo completo pela API: envio -> análise -> ajustes -> exportação em alta resolução.

A transcrição é substituída pelas palavras conhecidas do vídeo sintético
(o Whisper precisa baixar o modelo da internet).
"""
import json
import shutil
import subprocess
import time

import pytest

pytestmark = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("espeak-ng")),
    reason="precisa de ffmpeg e espeak-ng",
)


@pytest.fixture()
def cliente(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    import importlib

    from app import projetos
    importlib.reload(projetos)
    from app import main, transcricao
    importlib.reload(main)

    from testes.video_teste import gerar
    video, palavras = gerar(tmp_path / "entrada")
    monkeypatch.setattr(transcricao, "transcrever", lambda *a, **k: [dict(p) for p in palavras])

    from fastapi.testclient import TestClient
    with TestClient(main.app) as c:
        yield c, video, palavras


def esperar(c, pid, cond, limite=120):
    fim = time.time() + limite
    while time.time() < fim:
        p = c.get(f"/api/projetos/{pid}").json()
        if cond(p):
            return p
        time.sleep(0.3)
    raise TimeoutError(p)


def test_fluxo_completo(cliente):
    c, video, palavras = cliente
    with open(video, "rb") as f:
        r = c.post("/api/projetos", files={"arquivo": ("minha gravação.mp4", f, "video/mp4")},
                   data={"config": json.dumps({"modelo": "tiny"})})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    p = esperar(c, pid, lambda p: p["status"] in ("pronto", "erro"))
    assert p["status"] == "pronto", p.get("erro")
    assert p["meta"]["largura"] == 1280 and p["meta"]["tem_audio"]

    tipos = {c_["tipo"] for c_ in p["cortes"] if c_["ativo"]}
    assert {"silencio", "vicio", "regravacao", "erro_assumido", "repeticao"} <= tipos, tipos

    textos = [x["texto"] for x in palavras]
    # A primeira tentativa ("...bolo de chuc") deve sair; a segunda ("...cenoura") fica.
    reg = next(x for x in p["cortes"] if x["tipo"] == "regravacao")
    assert "chuc" in reg["trecho"]
    legendas = c.get(f"/api/projetos/{pid}/legendas").json()
    texto_final = " ".join(b["texto"] for b in legendas)
    assert "chuc" not in texto_final and "cenoura" in texto_final
    assert "cinquenta" not in texto_final and "quarenta" in texto_final
    assert "hã" not in texto_final
    assert "eu eu" not in texto_final
    assert p["resumo"]["duracao_final"] < p["resumo"]["duracao_original"] - 5

    # Recalcular com pausa mínima maior não pode perder os cortes manuais.
    manual = {"id": "manual0001", "inicio": 0.0, "fim": 0.3, "tipo": "manual", "ativo": True, "origem": "manual"}
    r = c.put(f"/api/projetos/{pid}/edicao", json={
        "cortes": p["cortes"] + [manual], "textos": {"0": "Oi"},
        "estilo_legenda": {"modo": "curta", "destaque": True, "maiusculas": True, "linhas": 1},
        "filtro": {"id": "cinema", "intensidade": 0.8},
    })
    assert r.status_code == 200
    r = c.post(f"/api/projetos/{pid}/recalcular", json={"config": {"silencio_minimo": 1.0}})
    assert any(x["id"] == "manual0001" for x in r.json()["cortes"])
    silencios = [x for x in r.json()["cortes"] if x["tipo"] == "silencio"]
    assert all(x["fim"] - x["inicio"] >= 1.0 - 2 * 0.12 - 0.02 for x in silencios)

    # Exporta em 1080p com legenda gravada.
    r = c.post(f"/api/projetos/{pid}/exportar", json={"resolucao": "1080", "qualidade": "alta",
                                                     "legenda": "gravada", "velocidade": "rapida"})
    assert r.status_code == 200, r.text
    p = esperar(c, pid, lambda p: (p.get("tarefa") or {}).get("status") in ("concluida", "erro"), 300)
    assert p["tarefa"]["status"] == "concluida", p["tarefa"].get("erro")
    exp = p["exportacoes"][-1]
    assert (exp["largura"], exp["altura"]) == (1920, 1080)
    from app import projetos as pj
    assert "lut3d=cor.cube" in (pj.pasta(pid) / "filtro.txt").read_text()

    baixado = c.get(f"/api/projetos/{pid}/arquivos/{exp['video']}")
    assert baixado.status_code == 200 and len(baixado.content) > 10_000
    srt = c.get(f"/api/projetos/{pid}/arquivos/{exp['legenda']}").text
    assert "OI" in srt and "CENOURA" in srt

    from app import projetos
    saida = projetos.pasta(pid) / exp["video"]
    sonda = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(saida)],
        capture_output=True, text=True).stdout)
    dur = float(sonda["format"]["duration"])
    assert abs(dur - exp["duracao"]) < 0.25, (dur, exp["duracao"])
    assert {s["codec_type"] for s in sonda["streams"]} == {"video", "audio"}

    # Arquivos fora da lista de exportações não podem ser baixados.
    assert c.get(f"/api/projetos/{pid}/arquivos/projeto.json").status_code == 404
