"""Exportação: acompanhar, cancelar e nunca ficar presa em "Já existe uma exportação em andamento"."""
import importlib
import shutil
import subprocess
import sys
import threading
import time

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa do ffmpeg")


@pytest.fixture()
def app_exportar(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    from app import projetos
    importlib.reload(projetos)
    from app import main
    importlib.reload(main)
    with TestClient(main.app) as c:
        yield main, projetos, c


def _projeto(projetos, segundos):
    from app import midia
    pid, pasta = projetos.criar("teste.mp4", ".mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=s=1280x720:r=30:d={segundos}",
                    "-f", "lavfi", "-i", f"sine=d={segundos}", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(pasta / "original.mp4")], check=True)
    projetos.atualizar(pid, status="pronto", meta=midia.sondar(pasta / "original.mp4"))
    return pid


def _esperar(cond, limite=60):
    fim = time.time() + limite
    while time.time() < fim:
        r = cond()
        if r:
            return r
        time.sleep(0.2)
    raise TimeoutError


def test_cancelar_fecha_o_ffmpeg_e_libera_exportar_de_novo(app_exportar):
    main, projetos, c = app_exportar
    pid = _projeto(projetos, 30)
    tarefa = lambda: c.get(f"/api/projetos/{pid}").json()["tarefa"]   # noqa: E731
    assert c.post(f"/api/projetos/{pid}/exportar", json={"legenda": "nenhuma"}).status_code == 200
    r = c.post(f"/api/projetos/{pid}/exportar", json={"legenda": "nenhuma"})
    assert r.status_code == 409 and "andamento" in r.json()["detail"]   # a janela mostra o andamento desta
    _esperar(lambda: tarefa()["status"] == "rodando")
    t0 = time.time()
    assert c.post(f"/api/projetos/{pid}/exportar/cancelar").status_code == 200
    assert _esperar(lambda: tarefa()["status"] == "cancelada", 15)
    assert time.time() - t0 < 10 and pid not in main.exportacoes
    # nada ficou rodando nem travado: exporta de novo até o fim
    assert c.post(f"/api/projetos/{pid}/exportar", json={"legenda": "nenhuma", "velocidade": "rapida"}).status_code == 200
    assert _esperar(lambda: tarefa()["status"] == "concluida", 180)


def test_marcada_rodando_sem_nada_rodando_nao_trava_o_botao(app_exportar):
    main, projetos, c = app_exportar
    pid = _projeto(projetos, 2)
    projetos.atualizar(pid, tarefa={"tipo": "exportar", "status": "rodando", "progresso": 0.4})
    assert c.get(f"/api/projetos/{pid}").json()["tarefa"]["status"] == "erro"
    assert c.post(f"/api/projetos/{pid}/exportar", json={"legenda": "nenhuma", "velocidade": "rapida"}).status_code == 200


def test_exportacao_parada_e_cancelada_sozinha(app_exportar):
    main, _, _ = app_exportar
    ativa = {"cancelar": threading.Event(), "ultimo": time.monotonic() - main.PARADA_MAX - 1, "rodando": True}
    main.exportacoes["x"] = ativa
    try:
        main._cancelar_paradas()
    finally:
        main.exportacoes.pop("x", None)
    assert ativa["cancelar"].is_set() and "parou de andar" in ativa["motivo"]


def test_ffmpeg_que_escreve_muito_erro_nao_trava():
    from app import exportar
    with exportar._Processos() as procs:
        p = procs.abrir([sys.executable, "-c", "import sys; sys.stderr.write('x' * 3_000_000); sys.exit(3)"],
                        stdout=subprocess.PIPE)
        p.stdout.read()
        with pytest.raises(RuntimeError, match="xxxx"):
            procs.esperar(p, "no teste")


def test_cancelar_fecha_processo_parado():
    from app import exportar
    cancelar = threading.Event()
    t0 = time.time()
    with pytest.raises(exportar.Cancelado):
        with exportar._Processos(cancelar) as procs:
            p = procs.abrir([sys.executable, "-c", "import time; time.sleep(60)"], stdout=subprocess.PIPE)
            threading.Timer(0.5, cancelar.set).start()
            p.stdout.read()
            procs.esperar(p, "no teste")
    assert time.time() - t0 < 10


def test_windows_bloqueando_o_arquivo_por_um_instante_nao_da_erro(tmp_path, monkeypatch):
    """O antivírus do Windows abre o projeto.json logo depois de cada gravação: insiste."""
    monkeypatch.setenv("EDITOR_DADOS", str(tmp_path / "dados"))
    from app import projetos
    importlib.reload(projetos)
    pid, _ = projetos.criar("v.mp4", ".mp4")
    original = type(projetos.pasta(pid)).replace
    falhas = {"n": 0}

    def replace_bloqueado(self, alvo):
        if falhas["n"] < 3:
            falhas["n"] += 1
            raise PermissionError(13, "Acesso negado (arquivo aberto por outro programa)")
        return original(self, alvo)
    monkeypatch.setattr(type(projetos.pasta(pid)), "replace", replace_bloqueado)
    projetos.atualizar(pid, status="pronto")
    assert falhas["n"] == 3 and projetos.carregar(pid)["status"] == "pronto"


def test_andamento_ao_vivo_sem_gravar_o_projeto_a_cada_passo(app_exportar, monkeypatch):
    main, projetos, c = app_exportar
    pid = _projeto(projetos, 30)
    gravacoes = []
    salvar = projetos.salvar
    monkeypatch.setattr(projetos, "salvar", lambda p, d: (gravacoes.append(p), salvar(p, d)))
    assert c.post(f"/api/projetos/{pid}/exportar", json={"legenda": "nenhuma", "velocidade": "rapida"}).status_code == 200
    t = _esperar(lambda: (lambda x: x if x["status"] == "rodando" and x["progresso"] > 0 else None)(
        c.get(f"/api/projetos/{pid}").json()["tarefa"]))
    assert t["decorrido"] >= 0 and t["parada"] >= 0 and t["limite"] == main.PARADA_MAX
    item = next(i for i in c.get("/api/projetos").json() if i["id"] == pid)
    assert item["exportacao"]["status"] == "rodando"          # a lista mostra "Exportando 45%"
    _esperar(lambda: c.get(f"/api/projetos/{pid}").json()["tarefa"]["status"] == "concluida", 180)
    assert len(gravacoes) <= 3   # começo e fim (antes: várias vezes por segundo, o que dava erro no Windows)
    assert "exportacao" not in next(i for i in c.get("/api/projetos").json() if i["id"] == pid)


def test_musica_de_fundo_pela_api(app_exportar, tmp_path):
    main, projetos, c = app_exportar
    pid = _projeto(projetos, 2)
    wav = tmp_path / "trilha.wav"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=200:d=1", str(wav)], check=True)
    with open(wav, "rb") as f:
        r = c.post(f"/api/projetos/{pid}/musica", files={"arquivo": ("minha trilha.wav", f, "audio/wav")})
    assert r.status_code == 200 and r.json()["musica"] == "musica.wav" and r.json()["musica_nome"] == "minha trilha.wav"
    ouvir = c.get(f"/api/projetos/{pid}/musica")
    assert ouvir.status_code == 200 and ouvir.headers["content-type"].startswith("audio/wav")
    # a edição muda volume e chaves, mas nunca aponta a música para outro arquivo
    c.put(f"/api/projetos/{pid}/edicao", json={"audio": {"volume_musica": 0.4, "musica": "../../projeto.json"}})
    a = c.get(f"/api/projetos/{pid}").json()["audio"]
    assert a["musica"] == "musica.wav" and a["volume_musica"] == 0.4
    with open(wav, "rb") as f:
        assert c.post(f"/api/projetos/{pid}/musica", files={"arquivo": ("x.exe", f, "application/x")}).status_code == 400
    assert c.delete(f"/api/projetos/{pid}/musica").json()["musica"] is None
    assert c.get(f"/api/projetos/{pid}/musica").status_code == 404
    assert not list(projetos.pasta(pid).glob("musica.*"))
