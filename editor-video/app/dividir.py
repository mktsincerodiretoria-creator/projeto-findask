"""Dividir um vídeo em partes de até 28 MB (para enviar no Claude, WhatsApp, e-mail...).

Na qualidade original nada é recomprimido: cada parte é um pedaço do próprio vídeo, cortado num
quadro-chave (só ali dá para cortar sem recomprimir). Os pontos de corte são escolhidos pelo
TAMANHO, não pelo tempo: dá o mínimo de partes, todas com tamanhos parecidos e nenhuma acima do
limite. Se os quadros-chave forem raros demais (um pedaço entre dois deles já passa do limite), o
vídeo é recomprimido com um quadro-chave por segundo. Opcional: deixar mais leve (720p) antes,
para ter bem menos partes."""
from __future__ import annotations

import bisect
import itertools
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path

from .midia import filtro_hdr, sondar
from .projetos import _insistir

LIMITE = 28_000_000        # bytes por parte (28 MB: abaixo dos 30 MB em qualquer conta)
FOLGA = 0.985              # o índice de cada parte (moov) ocupa um pouco além dos quadros
AUDIO_AAC = 160_000        # bits/s do áudio quando ele precisa virar AAC


class Cancelado(Exception):
    """A pessoa cancelou a divisão."""


def _rodar(cmd, duracao: float, progresso=None, ini: float = 0.0, fim: float = 1.0) -> None:
    """Roda o ffmpeg contando o andamento (se ``progresso`` levantar Cancelado, o ffmpeg para)."""
    with tempfile.TemporaryFile() as erros:   # (num arquivo: o ffmpeg nunca fica esperando)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=erros, text=True, encoding="utf-8",
                                errors="replace")
        try:
            for linha in proc.stdout:
                if progresso and linha.startswith("out_time_us="):
                    try:
                        f = int(linha.split("=", 1)[1]) / 1e6 / max(0.1, duracao)
                    except ValueError:
                        continue
                    progresso(ini + (fim - ini) * min(1.0, max(0.0, f)))
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        if proc.wait() != 0:
            erros.seek(0)
            raise RuntimeError(f"ffmpeg falhou: {erros.read().decode('utf-8', 'replace')[-1200:]}")


def _trilhas(caminho: Path) -> dict:
    """Codec e número das trilhas que vão para as partes (o 1º vídeo e o 1º áudio)."""
    info = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=index,codec_type,codec_name", "-of", "json", str(caminho)],
        capture_output=True, text=True, encoding="utf-8", errors="replace").stdout or "{}")
    trilhas = info.get("streams", [])
    video = next((s for s in trilhas if s.get("codec_type") == "video"), {})
    audio = next((s for s in trilhas if s.get("codec_type") == "audio"), {})
    return {"video": video.get("index"), "codec_video": video.get("codec_name", ""),
            "audio": audio.get("index"), "codec_audio": audio.get("codec_name", "")}


def _tempo(campos: dict, chave: str, outra: str) -> float | None:
    for nome in (chave, outra):
        try:
            return float(campos[nome])
        except (KeyError, ValueError):
            continue
    return None


def _pedacos(caminho: Path, trilhas: dict) -> tuple[list[int], list[float], list[int]]:
    """Os quadros-chave do vídeo (onde dá para cortar sem recomprimir) e quantos bytes vão de cada
    um até o seguinte (vídeo e áudio daquele trecho). Cada quadro-chave vem com o número dele na
    ordem do arquivo (é por esse número que o corte é feito: exato, sem depender do relógio do
    vídeo) e com o momento em que aparece na tela."""
    saida = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "packet=stream_index,pts_time,dts_time,size,flags",
         "-of", "compact=p=0", str(caminho)], capture_output=True, text=True, encoding="utf-8",
        errors="replace").stdout
    copia_audio = trilhas["codec_audio"] == "aac"   # senão o áudio vira AAC e o tamanho dele muda
    pacotes, chaves = [], []   # (ordem de gravação, bytes); quadros-chave: (número, na tela, ordem)
    numero = -1                # quadros de vídeo antes do 1º quadro-chave não vão para as partes
    for linha in saida.splitlines():
        campos = dict(c.split("=", 1) for c in linha.split("|") if "=" in c)
        try:
            trilha, tamanho = int(campos["stream_index"]), int(campos["size"])
        except (KeyError, ValueError):
            continue
        if trilha != trilhas["video"] and (trilha != trilhas["audio"] or not copia_audio):
            continue
        ordem = _tempo(campos, "dts_time", "pts_time")
        chave = trilha == trilhas["video"] and campos.get("flags", "").startswith("K")
        if trilha == trilhas["video"] and (numero >= 0 or chave):
            numero += 1
        if ordem is None:
            continue
        pacotes.append((ordem, tamanho))
        if chave:
            na_tela = _tempo(campos, "pts_time", "dts_time")
            chaves.append((numero, ordem if na_tela is None else na_tela, ordem))
    if not chaves:
        return [], [], []
    # cada pacote vai para a parte em que o ffmpeg o grava: a do último quadro-chave antes dele
    limites = [ordem for _, _, ordem in chaves]
    tamanhos = [0] * len(chaves)
    for ordem, tamanho in pacotes:
        tamanhos[max(0, bisect.bisect_right(limites, ordem) - 1)] += tamanho
    if trilhas["audio"] is not None and not copia_audio:
        fins = limites[1:] + [max(limites[-1], max(ordem for ordem, _ in pacotes))]
        for i, (a, b) in enumerate(zip(limites, fins)):
            tamanhos[i] += int(max(0.0, b - a) * AUDIO_AAC / 8)
    return [n for n, _, _ in chaves], [t for _, t, _ in chaves], tamanhos


def _guloso(tamanhos: list[int], capacidade: int) -> list[int]:
    """Enche cada parte até onde cabe; devolve em que pedaço começa cada parte (menos a 1ª)."""
    cortes, soma = [], 0
    for i, t in enumerate(tamanhos):
        if soma and soma + t > capacidade:
            cortes.append(i)
            soma = 0
        soma += t
    return cortes


def _pelo_meio(tamanhos: list[int], partes: int, capacidade: int) -> list[int] | None:
    """Corta o mais perto possível de 1/n, 2/n... do total: partes do mesmo tamanho (± um pedaço).
    None se assim alguma passar da ``capacidade``."""
    acumulado = [0, *itertools.accumulate(tamanhos)]   # bytes antes de cada pedaço
    total, cortes = acumulado[-1], []
    for k in range(1, partes):
        alvo = total * k / partes
        j = bisect.bisect_left(acumulado, alvo)
        if j > 0 and alvo - acumulado[j - 1] <= acumulado[min(j, len(tamanhos))] - alvo:
            j -= 1
        j = min(max(j, (cortes[-1] + 1) if cortes else 1), len(tamanhos) - 1)
        if cortes and j <= cortes[-1]:
            return None
        cortes.append(j)
    limites = [0, *cortes, len(tamanhos)]
    if any(acumulado[b] - acumulado[a] > capacidade for a, b in zip(limites, limites[1:])):
        return None
    return cortes


def escolher_cortes(tamanhos: list[int], capacidade: int) -> list[int] | None:
    """O mínimo de partes de até ``capacidade`` bytes, com tamanhos o mais iguais possível
    (cortando só entre pedaços). None se um pedaço sozinho já não cabe."""
    if not tamanhos or max(tamanhos) > capacidade:
        return None
    partes = len(_guloso(tamanhos, capacidade)) + 1   # enchendo cada parte até a boca: o mínimo de partes
    if partes == 1:
        return []
    cortes = _pelo_meio(tamanhos, partes, capacidade)
    if cortes is not None:
        return cortes
    # pedaços muito desiguais: a menor "capacidade" que ainda dá esse número de partes
    baixo, alto = max(max(tamanhos), math.ceil(sum(tamanhos) / partes)), capacidade
    while baixo < alto:
        meio = (baixo + alto) // 2
        if len(_guloso(tamanhos, meio)) + 1 <= partes:
            alto = meio
        else:
            baixo = meio + 1
    return _guloso(tamanhos, baixo)


def _recodificar(origem: Path, destino: Path, duracao: float, leve: bool, progresso, ini, fim) -> None:
    """Vídeo com quadro-chave a cada 1 s (dá para cortar em qualquer lugar). "leve" = 720p."""
    meta = sondar(origem)
    filtros = list(filtro_hdr(meta))   # HDR do iPhone: sem converter, a cor sai lavada
    if leve:
        filtros.append("scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)':flags=lanczos")
    filtros.append("format=yuv420p")
    cor = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"] if filtro_hdr(meta) else []
    _rodar(["ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i", str(origem),
            "-map", "0:v:0", "-map", "0:a:0?", "-vf", ",".join(filtros),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "24" if leve else "20", *cor,
            "-force_key_frames", "expr:gte(t,n_forced*1)", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", str(destino)], duracao, progresso, ini, fim)


def _cortar(origem: Path, pasta: Path, quadros: list[int], trilhas: dict) -> list[Path]:
    """Corta sem recomprimir o vídeo: cada parte nova começa no quadro de número dado (que é um
    quadro-chave)."""
    for velho in pasta.glob("pedaco_*.mp4"):
        _insistir(velho.unlink)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(origem), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy"]
    if trilhas["codec_video"] == "hevc":
        cmd += ["-tag:v", "hvc1"]   # o iPhone/Mac só abre HEVC com essa etiqueta
    cmd += ["-c:a", "copy"] if trilhas["codec_audio"] == "aac" else ["-c:a", "aac", "-b:a", str(AUDIO_AAC)]
    if quadros:
        cmd += ["-f", "segment", "-segment_frames", ",".join(map(str, quadros)), "-reset_timestamps", "1",
                "-segment_format_options", "movflags=+faststart", str(pasta / "pedaco_%04d.mp4")]
    else:
        cmd += ["-movflags", "+faststart", str(pasta / "pedaco_0000.mp4")]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou ao cortar: {proc.stderr[-1200:]}")
    return sorted(pasta.glob("pedaco_*.mp4"))


def _nome_base(nome: str) -> str:
    base = re.sub(r"[^\w\-. ()]+", "_", Path(nome).stem)[:60].strip(" .")
    return base or "video"


def dividir(origem: Path, pasta: Path, nome: str = "video", leve: bool = False, limite: int = LIMITE,
            progresso=None, cancelado=None) -> list[dict]:
    """Corta ``origem`` em partes de até ``limite`` bytes, dentro de ``pasta``.
    Devolve [{arquivo, bytes, inicio, duracao}] na ordem."""
    def avisar(f):
        if cancelado and cancelado():
            raise Cancelado("Divisão cancelada.")
        if progresso:
            progresso(f)

    duracao = sondar(origem)["duracao"]
    fonte, recodificado = origem, False
    if leve:
        fonte = pasta / "leve.mp4"
        _recodificar(origem, fonte, duracao, True, avisar, 0.0, 0.9)
        recodificado = True
    capacidade = int(limite * FOLGA)
    try:
        for _ in range(8):
            avisar(0.92 if recodificado else 0.1)
            trilhas = _trilhas(fonte)
            numeros, quando, tamanhos = _pedacos(fonte, trilhas)
            cortes = escolher_cortes(tamanhos, capacidade)
            ideal = math.ceil(sum(tamanhos) / capacidade) if tamanhos else 1
            # quadros-chave raros demais: sem recomprimir não dá para cortar perto do ponto certo
            raros = cortes is None or len(cortes) + 1 > max(ideal * 1.5, ideal + 2)
            if raros and not recodificado:
                fonte = pasta / "recodificado.mp4"
                _recodificar(origem, fonte, duracao, False, avisar, 0.1, 0.9)
                recodificado = True
                continue
            if cortes is None:
                raise RuntimeError("Não deu para dividir: um único trecho do vídeo já passa de 28 MB.")
            avisar(0.95 if recodificado else 0.5)
            try:
                partes = _cortar(fonte, pasta, [numeros[i] for i in cortes], trilhas)
            except RuntimeError:
                if recodificado:
                    raise
                # formato que não dá para copiar para MP4 (codec antigo): recomprime
                fonte = pasta / "recodificado.mp4"
                _recodificar(origem, fonte, duracao, False, avisar, 0.1, 0.9)
                recodificado = True
                continue
            maior = max(p.stat().st_size for p in partes)
            if maior <= limite:
                break
            # alguma passou (o índice da parte foi maior que o previsto): mira um pouco mais baixo
            capacidade = int(capacidade * min(0.97, limite / maior * 0.99))
        else:
            raise RuntimeError("Não consegui deixar todas as partes abaixo do limite.")
    finally:
        for temporario in ("leve.mp4", "recodificado.mp4"):
            try:
                _insistir(lambda: (pasta / temporario).unlink(missing_ok=True))
            except OSError:
                pass
    # o começo de cada parte: o quadro-chave onde ela foi cortada (se o corte saiu como planejado)
    if len(partes) == len(cortes) + 1:
        inicios = [0.0] + [max(0.0, quando[i] - quando[0]) for i in cortes]
        duracoes = [b - a for a, b in zip(inicios, inicios[1:] + [duracao])]
    else:
        duracoes = [sondar(p)["duracao"] for p in partes]
        inicios = [sum(duracoes[:i]) for i in range(len(partes))]
    total, base = len(partes), _nome_base(nome)
    largura = max(2, len(str(total)))
    resultado = []
    for i, p in enumerate(partes, 1):
        final = pasta / f"{base}_parte_{i:0{largura}d}_de_{total:0{largura}d}.mp4"
        _insistir(lambda: p.replace(final))
        resultado.append({"arquivo": final.name, "bytes": final.stat().st_size,
                          "inicio": round(inicios[i - 1], 2), "duracao": round(max(0.0, duracoes[i - 1]), 2)})
    return resultado
