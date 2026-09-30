"""Legenda com linhas/largura, filtros de cor e atualização automática."""
import hashlib
import json
import shutil
import subprocess
import threading
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler

import numpy as np
import pytest

from app import atualizacao, filtros, legendas
from testes.test_analise import falas

FRASE = "hoje eu vou mostrar para vocês como fazer um bolo de cenoura muito fofinho e fácil"


# ---------------------------------------------------------------- legenda

def test_uma_linha_nunca_quebra_e_respeita_o_limite():
    p = falas(*[(w, 0) for w in FRASE.split()])
    estilo = {"linhas": 1, "tamanho": 7, "largura": 86}
    limite = legendas.caracteres_por_linha({**legendas.ESTILO_PADRAO, **estilo}, 9 / 16)
    blocos = legendas.montar_blocos(p, [], 30, estilo, 9 / 16)
    assert all(b["quebra"] is None for b in blocos)
    assert all(len(b["texto"]) <= limite or len(b["palavras"]) == 1 for b in blocos)


def test_duas_linhas_quebra_equilibrada():
    p = falas(*[(w, 0) for w in FRASE.split()])
    blocos = legendas.montar_blocos(p, [], 30, {"linhas": 2, "tamanho": 7, "largura": 86}, 9 / 16)
    longos = [b for b in blocos if b["quebra"] is not None]
    assert longos, "com 2 linhas algum bloco deve quebrar"
    for b in longos:
        l1 = " ".join(w["texto"] for w in b["palavras"][:b["quebra"]])
        l2 = " ".join(w["texto"] for w in b["palavras"][b["quebra"]:])
        assert abs(len(l1) - len(l2)) <= max(len(w["texto"]) for w in b["palavras"]) + 1
    ass = legendas.gerar_ass(blocos, 1080, 1920, {"linhas": 2, "largura": 80})
    assert "\\N" in ass
    assert ",108,108," in ass  # margens laterais = (100-80)/2 % de 1080


def test_letra_maior_cabe_menos_por_linha():
    base = {**legendas.ESTILO_PADRAO}
    pequeno = legendas.caracteres_por_linha({**base, "tamanho": 4}, 9 / 16)
    grande = legendas.caracteres_por_linha({**base, "tamanho": 12}, 9 / 16)
    horizontal = legendas.caracteres_por_linha({**base, "tamanho": 4}, 16 / 9)
    assert grande < pequeno < horizontal


# ---------------------------------------------------------------- filtros

def test_natural_e_identidade_e_intensidade_zero_tambem():
    e = np.linspace(0, 1, filtros.N)
    for nome, intens in (("natural", 1.0), ("cinema", 0.0)):
        l = filtros.lut(nome, intens)
        assert np.abs(l[3, 20, 31] - [e[31], e[20], e[3]]).max() < 1e-9


def test_filtros_sao_suaves_e_diferentes():
    cinza = np.array([[0.5, 0.5, 0.5]])
    pele = np.array([[0.87, 0.67, 0.53]])
    resultados = {}
    for nome, p in filtros.FILTROS.items():
        if nome == "natural":
            continue
        s = filtros.aplicar_ajustes(pele, p)
        # "suave": a pele não muda mais que ~15% em nenhum canal (o Noir tira a cor de propósito)
        if not p.get("mono"):
            assert np.abs(s - pele).max() < 0.15, nome
        resultados[nome] = tuple(np.round(filtros.aplicar_ajustes(np.vstack([cinza, pele]), p).ravel(), 3))
    assert len(set(resultados.values())) == len(resultados)
    noir = filtros.aplicar_ajustes(pele, filtros.FILTROS["noir"])
    assert np.ptp(noir) < 1e-9  # preto e branco


def test_textura_do_navegador_bate_com_o_cube(tmp_path):
    n = filtros.N
    tex = np.frombuffer(filtros.bytes_para_navegador("cinema"), dtype=np.uint8).reshape(n, n * n, 3)
    l = filtros.lut("cinema")
    g, b, r = 7, 19, 25
    assert np.abs(tex[g, b * n + r] / 255 - l[b, g, r]).max() < 0.003
    filtros.escrever_cube(tmp_path / "c.cube", "cinema")
    linhas = (tmp_path / "c.cube").read_text().splitlines()
    assert linhas[1] == f"LUT_3D_SIZE {n}"
    # no .cube, o R varia mais rápido: a linha (b, g, r) é b*n*n + g*n + r
    valores = [float(x) for x in linhas[2 + b * n * n + g * n + r].split()]
    assert np.abs(np.array(valores) - l[b, g, r]).max() < 1e-5


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="precisa de ffmpeg")
def test_ffmpeg_aplica_o_filtro_igual_a_lut(tmp_path):
    """A cor que o ffmpeg exporta é a mesma que a LUT (e a prévia) calcula."""
    filtros.escrever_cube(tmp_path / "cor.cube", "filme_quente")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0xDDAA88:s=16x16",
                    "-frames:v", "1", "-vf", "format=rgb24,lut3d=cor.cube", "-f", "rawvideo", "-pix_fmt", "rgb24",
                    "saida.rgb"], check=True, cwd=tmp_path)
    obtido = np.frombuffer((tmp_path / "saida.rgb").read_bytes()[:3], dtype=np.uint8) / 255
    esperado = filtros.aplicar_ajustes(np.array([[0xDD, 0xAA, 0x88]]) / 255, filtros.FILTROS["filme_quente"])[0]
    assert np.abs(obtido - esperado).max() < 0.02


# ---------------------------------------------------------------- atualização

@pytest.fixture()
def servidor_github(tmp_path, monkeypatch):
    """Simula o raw.githubusercontent.com servindo uma versão nova do programa."""
    publicado = tmp_path / "publicado"
    instalado = tmp_path / "instalado"
    (publicado / "app").mkdir(parents=True)
    (instalado / "app").mkdir(parents=True)
    arquivos = {
        "app/main.py": b"print('versao nova')\n",
        "static/app.js": b"// novo\n",
        "iniciar.bat": b"@echo off\r\nrem novo\r\n",
        "app/igual.py": b"x = 1\n",
    }
    for caminho, dados in arquivos.items():
        (publicado / caminho).parent.mkdir(parents=True, exist_ok=True)
        (publicado / caminho).write_bytes(dados)
    (instalado / "app/main.py").write_bytes(b"print('versao velha')\n")
    (instalado / "app/igual.py").write_bytes(b"x = 1\r\n")  # só o fim de linha muda
    (instalado / "iniciar.bat").write_bytes(b"@echo off\r\nrem velho\r\n")
    manifesto = {
        "versao": "9.9.9", "ramo": "outro-ramo", "novidades": ["Coisa nova"],
        "arquivos": {c: atualizacao.hash_conteudo(c, d) for c, d in arquivos.items()},
    }
    (publicado / "versao.json").write_text(json.dumps(manifesto))

    srv = HTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(publicado)))
    srv.RequestHandlerClass.log_message = lambda *a: None
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    pedidos = []

    def url(ramo, caminho):
        pedidos.append((ramo, caminho))
        return f"{base}/{caminho}"

    monkeypatch.setattr(atualizacao, "_url", url)
    monkeypatch.setattr(atualizacao, "RAIZ", instalado)
    config = {}
    monkeypatch.setattr(atualizacao.projetos, "config_app", lambda: dict(config))
    monkeypatch.setattr(atualizacao.projetos, "salvar_config_app", lambda d: config.update(d))
    yield instalado, publicado, pedidos, config
    srv.shutdown()


def test_verifica_e_aplica_so_o_que_mudou(servidor_github):
    instalado, publicado, pedidos, config = servidor_github
    info = atualizacao.verificar()
    assert info["ha_atualizacao"] and info["disponivel"] == "9.9.9"

    r = atualizacao.aplicar()
    assert r["arquivos"] == 2  # main.py e app.js; igual.py (só CRLF) e o .bat ficam
    assert (instalado / "app/main.py").read_bytes() == b"print('versao nova')\n"
    assert (instalado / "static/app.js").exists()
    assert b"velho" in (instalado / "iniciar.bat").read_bytes()
    assert ("claude/video-editing-subtitles-che65w", "app/igual.py") not in pedidos
    assert config["ramo_atualizacao"] == "outro-ramo"


def test_arquivo_corrompido_nao_troca_nada(servidor_github):
    instalado, publicado, _, _ = servidor_github
    (publicado / "static/app.js").write_bytes(b"// adulterado\n")
    with pytest.raises(RuntimeError):
        atualizacao.aplicar()
    # nada foi trocado, nem o main.py que estava certo
    assert (instalado / "app/main.py").read_bytes() == b"print('versao velha')\n"


def test_manifesto_nao_pode_sair_da_pasta(servidor_github):
    _, publicado, _, _ = servidor_github
    m = json.loads((publicado / "versao.json").read_text())
    m["arquivos"] = {"../fora.py": hashlib.sha256(b"x").hexdigest()}
    (publicado / "versao.json").write_text(json.dumps(m))
    with pytest.raises(ValueError):
        atualizacao.aplicar()


def test_sem_internet_nao_e_erro(monkeypatch):
    monkeypatch.setattr(atualizacao, "_url", lambda r, c: "http://127.0.0.1:9/versao.json")
    info = atualizacao.verificar()
    assert info["ha_atualizacao"] is False and "erro" in info
