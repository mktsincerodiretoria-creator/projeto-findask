"""Exportação final: aplica os cortes, grava a legenda e codifica em alta qualidade."""
from __future__ import annotations

import bisect
import subprocess
from fractions import Fraction
from pathlib import Path

import numpy as np

from . import filtros, movimento
from .analise import intervalos_mantidos
from .legendas import gerar_ass, gerar_srt, montar_blocos
from .midia import filtro_hdr, sondar, tem_filtro, versao_ffmpeg

OPCOES_PADRAO = {
    "resolucao": "original",   # original | 720 | 1080 | 1440 | 2160 (lado menor)
    "qualidade": "alta",       # maxima | alta | normal
    "legenda": "gravada",      # gravada | arquivo | nenhuma
    "velocidade": "normal",    # normal | rapida (codifica mais rápido, arquivo maior)
    "melhorar": "nao",         # nao | suave | forte (mais nitidez; forte também tira granulado)
}

# "Melhorar imagem": nitidez na resolução final (o "forte" também tira o granulado antes).
# Só mexe dentro de cada quadro: nada de misturar quadros vizinhos, que borra o movimento e
# deixa rastro logo depois de cada corte.
MELHORIA = {
    "suave": ([], ["cas=0.35"]),
    "forte": (["hqdn3d=1.6:1.2:0:0"], ["cas=0.6", "eq=contrast=1.03:saturation=1.06"]),
}
NITIDEZ_ANTIGA = {"cas=0.35": "unsharp=5:5:0.45:3:3:0", "cas=0.6": "unsharp=5:5:0.85:3:3:0"}

CRF = {"maxima": 14, "alta": 16, "normal": 20}

# Taxas de quadros padrão. O celular grava com taxa variável; a saída usa a padrão mais perto,
# fixa (sem tremida), até 60 por segundo.
TAXAS = (Fraction(24000, 1001), Fraction(24), Fraction(25), Fraction(30000, 1001), Fraction(30),
         Fraction(48), Fraction(50), Fraction(60000, 1001), Fraction(60))

# Tabelas de cor que passam direto para o arquivo final (o resto vira a padrão).
CORES_OK = {
    "primarias": {"bt709", "smpte170m", "bt470bg", "bt2020", "smpte432"},
    "transferencia": {"bt709", "smpte170m", "iec61966-2-1", "arib-std-b67", "smpte2084"},
    "matriz": {"bt709", "smpte170m", "bt470bg", "bt2020nc"},
}
MATRIZ_SCALE = {"bt709": "bt709", "smpte170m": "smpte170m", "bt470bg": "bt470", "bt2020nc": "bt2020"}


def taxa_saida(fps) -> Fraction:
    """Quadros por segundo do vídeo final: o do original (no máximo 60), na taxa padrão mais perto."""
    fps = min(60.0, float(fps or 30.0)) or 30.0
    perto = min(TAXAS, key=lambda t: abs(float(t) - fps))
    return perto if abs(float(perto) - fps) <= 0.02 * fps else Fraction(round(fps * 1000), 1000)


def alinhar_cortes(cortes, taxa) -> list[dict]:
    """Bordas dos cortes no quadro mais próximo: vídeo, áudio e legenda cortam no mesmo ponto
    (nenhum quadro repetido nas emendas e o áudio não escorrega ao longo do vídeo)."""
    q = float(taxa)
    return [{**c, "inicio": round(c["inicio"] * q) / q, "fim": round(c["fim"] * q) / q} for c in cortes]


def cor_saida(meta: dict) -> dict:
    """Etiquetas de cor do arquivo final. Sem elas o celular ou o Instagram podem usar outra
    tabela de cor e a imagem sai lavada ou com a cor deslocada."""
    if filtro_hdr(meta):   # HDR do celular convertido para a cor normal
        return {"primarias": "bt709", "transferencia": "bt709", "matriz": "bt709"}
    padrao = "bt709" if min(meta.get("largura", 0), meta.get("altura", 0)) >= 720 else "smpte170m"
    cor = meta.get("cor") or {}
    return {k: cor.get(k) if cor.get(k) in CORES_OK[k] else padrao for k in CORES_OK}


def dimensoes_saida(largura: int, altura: int, resolucao: str) -> tuple[int, int]:
    if resolucao == "original":
        alvo_l, alvo_a = largura, altura
    else:
        lado = int(resolucao)
        fator = lado / min(largura, altura)
        alvo_l, alvo_a = largura * fator, altura * fator
    # H.264 exige dimensões pares.
    return int(round(alvo_l / 2) * 2), int(round(alvo_a / 2) * 2)


def filtro_saida(largura, altura, orig_l, orig_a, com_legenda: bool, melhorar: str = "nao") -> list[str]:
    """Melhoria de imagem, escala final, legenda gravada e formato de cor do arquivo."""
    antes, depois = MELHORIA.get(melhorar, ([], []))
    if not tem_filtro("cas"):   # ffmpeg antigo
        depois = [NITIDEZ_ANTIGA.get(e, e) for e in depois]
    etapas = list(antes)
    if (largura, altura) != (orig_l, orig_a):
        etapas.append(f"scale={largura}:{altura}:flags=lanczos+accurate_rnd+full_chroma_int")
    etapas += depois   # nitidez depois da escala (e antes da legenda: o texto não é afetado)
    etapas.append("setsar=1")
    if com_legenda:
        etapas.append("subtitles=legendas.ass")
    etapas.append("format=yuv420p")
    return etapas


def _quadros(trechos, taxa) -> list[tuple[int, int]]:
    """Trechos mantidos em números de quadro [a, b) na taxa de saída."""
    q = float(taxa)
    ks = [(int(round(a * q)), int(round(b * q))) for a, b in trechos]
    return [(a, b) for a, b in ks if b > a]


def _soma(termos: list[str]) -> str:
    """a+b+c+... agrupado em árvore: vídeo longo com milhares de cortes não estoura a pilha do ffmpeg."""
    if len(termos) == 1:
        return termos[0]
    meio = len(termos) // 2
    return f"({_soma(termos[:meio])}+{_soma(termos[meio:])})"


def _escolher_quadros(ks, taxa) -> list[str]:
    """Taxa fixa e só os quadros mantidos, emendados sem buraco: nenhum quadro repete nem pula
    nas emendas (era isso que dava a "travadinha" em cada corte)."""
    escolha = _soma([f"between(n,{a},{b - 1})" for a, b in ks])
    return [f"fps={taxa}:start_time=0", f"select='{escolha}'", "setpts=N/FRAME_RATE/TB"]


def _filtro_audio(ks, taxa) -> list[str]:
    """Os mesmos trechos no áudio (cortado na amostra exata da borda do quadro), com uma
    rampa curtinha em cada emenda para não estalar."""
    q = float(taxa)
    linhas = []
    for k, (a, b) in enumerate(ks):
        ta, tb = a / q, b / q
        dur = tb - ta
        fade = min(0.012, dur / 4)
        linhas.append(
            f"[0:a]atrim=start={ta:.6f}:end={tb:.6f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade:.4f},afade=t=out:st={dur - fade:.6f}:d={fade:.4f}[a{k}]"
        )
    linhas.append(f"{''.join(f'[a{k}]' for k in range(len(ks)))}concat=n={len(ks)}:v=0:a=1[ac]")
    return linhas


def montar_filtro(trechos, largura, altura, orig_l, orig_a, com_legenda: bool, com_cor: bool = False,
                  quadros_brutos: bool = False, melhorar: str = "nao", hdr: list | None = None,
                  tamanho_bruto: tuple[int, int] | None = None, taxa=Fraction(30), cor: dict | None = None) -> str:
    """Corta e junta os trechos. Com ``quadros_brutos`` a saída são quadros YUV crus (o Python
    aplica formato, zoom e tracking e outro ffmpeg finaliza) e o áudio é feito à parte."""
    ks = _quadros(trechos, taxa)
    video = _escolher_quadros(ks, taxa) + list(hdr or [])   # HDR do celular -> cor normal
    if cor:   # cada quadro sabe a sua tabela de cor (a legenda sai com a cor certa)
        video.append(f"setparams=color_primaries={cor['primarias']}:color_trc={cor['transferencia']}"
                     f":colorspace={cor['matriz']}")
    if com_cor:
        # Filtro de cor antes da escala e da legenda (o texto não pode ficar colorido). A ida para
        # RGB e a volta usam a mesma tabela: só o filtro muda a cor.
        m = MATRIZ_SCALE.get((cor or {}).get("matriz"), "bt709")
        video += [f"scale=in_color_matrix={m}:flags=bicubic+accurate_rnd+full_chroma_int", "format=gbrp",
                  "lut3d=cor.cube:interp=tetrahedral",
                  f"scale=out_color_matrix={m}:flags=bicubic+accurate_rnd+full_chroma_int", "format=yuv420p"]
    if quadros_brutos:
        if tamanho_bruto and tamanho_bruto != (orig_l, orig_a):
            # reduz com boa qualidade antes do enquadramento (que então trabalha perto de 1:1)
            video.append(f"scale={tamanho_bruto[0]}:{tamanho_bruto[1]}:flags=lanczos+accurate_rnd")
        video += ["scale=out_range=tv", "format=yuv420p"]
    else:
        video += filtro_saida(largura, altura, orig_l, orig_a, com_legenda, melhorar)
    linhas = [f"[0:v]{','.join(video)}[vout]"]
    if not quadros_brutos:
        linhas += _filtro_audio(ks, taxa)
    return ";\n".join(linhas)


def _codificacao(opcoes: dict, taxa, cor: dict) -> list[str]:
    rapida = opcoes["velocidade"] == "rapida"
    return [
        # "film" guarda a textura fina (pele, cabelo); aq-mode 3 dá mais bits às partes escuras e
        # lisas, que é onde aparecem os "quadradinhos"
        "-c:v", "libx264", "-preset", "faster" if rapida else "slow", "-tune", "film",
        "-crf", str(CRF.get(opcoes["qualidade"], 16) - (1 if rapida else 0)), "-profile:v", "high",
        "-x264-params", "aq-mode=3", "-r", str(taxa), "-pix_fmt", "yuv420p",
        "-color_primaries", cor["primarias"], "-color_trc", cor["transferencia"], "-colorspace", cor["matriz"],
        "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
        "-movflags", "+faststart",
    ]


def exportar(projeto_dir: Path, original: Path, meta: dict, palavras: list, cortes: list,
             estilo: dict, opcoes: dict, nome_saida: str, progresso=None, filtro: dict | None = None,
             mov: dict | None = None, trilha: dict | None = None, enq: dict | None = None) -> dict:
    opcoes = {**OPCOES_PADRAO, **(opcoes or {})}
    duracao = meta["duracao"]
    if "hdr" not in meta or "cor" not in meta:   # projetos antigos não guardavam isso
        novo = sondar(original)
        meta = {**meta, "hdr": novo.get("hdr", False), "cor": novo.get("cor", {})}
    hdr = filtro_hdr(meta)
    enq = movimento.normalizar_enquadramento(enq)
    taxa = taxa_saida(meta.get("fps"))
    cortes = alinhar_cortes(cortes, taxa)
    trechos = [(a / float(taxa), b / float(taxa)) for a, b in _quadros(intervalos_mantidos(cortes, duracao), taxa)]
    if not trechos:
        raise ValueError("Todos os trechos foram cortados: não sobrou nada para exportar.")
    total = sum(b - a for a, b in trechos)

    lado = None if opcoes["resolucao"] == "original" else int(opcoes["resolucao"])
    largura, altura = movimento.tamanho_quadro(meta["largura"], meta["altura"], enq["formato"], lado)
    blocos = montar_blocos(palavras, cortes, duracao, estilo, largura / altura)
    arquivos = {"video": f"{nome_saida}.mp4"}

    # "Mostrar legenda" desligado na aba Legenda = vídeo sem legenda (e sem .srt)
    legenda_ativa = opcoes["legenda"] != "nenhuma" and estilo.get("ativa", True) is not False and bool(blocos)
    if legenda_ativa:
        (projeto_dir / f"{nome_saida}.srt").write_text(gerar_srt(blocos), encoding="utf-8")
        arquivos["legenda"] = f"{nome_saida}.srt"
    gravar = legenda_ativa and opcoes["legenda"] == "gravada"
    if gravar:
        (projeto_dir / "legendas.ass").write_text(
            gerar_ass(blocos, largura, altura, estilo), encoding="utf-8"
        )

    filtro = filtro or {}
    com_cor = filtro.get("id", "natural") in filtros.FILTROS and filtro.get("id", "natural") != "natural" \
        and float(filtro.get("intensidade", 1.0)) > 0
    if com_cor:
        filtros.escrever_cube(projeto_dir / "cor.cube", filtro["id"], float(filtro.get("intensidade", 1.0)))

    flag_filtro = ["-/filter_complex", "filtro.txt"] if versao_ffmpeg() >= 7 else ["-filter_complex_script", "filtro.txt"]
    cor = cor_saida(meta)
    codificacao = _codificacao(opcoes, taxa, cor)
    resultado = {**arquivos, "duracao": round(total, 2), "largura": largura, "altura": altura, "opcoes": opcoes}

    mov = movimento.normalizar(mov)
    if movimento.tem_efeito(mov) or not movimento.enquadramento_neutro(enq):
        _exportar_com_movimento(projeto_dir, original, meta, trechos, total, largura, altura, gravar, com_cor,
                                mov, trilha, flag_filtro, codificacao, arquivos["video"], progresso,
                                opcoes["melhorar"], enq, hdr, taxa, cor)
        return resultado

    filtro = montar_filtro(trechos, largura, altura, meta["largura"], meta["altura"], gravar, com_cor,
                           melhorar=opcoes["melhorar"], hdr=hdr, taxa=taxa, cor=cor)
    (projeto_dir / "filtro.txt").write_text(filtro, encoding="utf-8")

    cmd = [
        "ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
        "-i", str(original.resolve()),
        *flag_filtro,
        "-map", "[vout]", "-map", "[ac]",
        *codificacao,
        arquivos["video"],
    ]
    proc = subprocess.Popen(cmd, cwd=projeto_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace")
    for linha in proc.stdout:
        if linha.startswith("out_time_us=") and progresso:
            try:
                progresso(min(0.99, int(linha.split("=")[1]) / 1e6 / total))
            except ValueError:
                pass
    erro = proc.stderr.read()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou na exportação: {erro[-1500:]}")

    return resultado


def _tempo_original(trechos):
    """Função que converte tempo do vídeo final -> tempo do vídeo original."""
    inicios, acumulado, total = [], [], 0.0
    for a, b in trechos:
        inicios.append(a)
        acumulado.append(total)
        total += b - a

    def converter(t_final):
        i = max(0, bisect.bisect_right(acumulado, t_final) - 1)
        return inicios[i] + (t_final - acumulado[i])
    return converter


def _matrizes_yuv(m) -> tuple[np.ndarray, np.ndarray]:
    """Matriz do enquadramento para o plano de brilho (Y) e para os de cor (U e V, metade do
    tamanho), na convenção do OpenCV (centro do pixel no número inteiro).
    Quase 1:1 e sem giro vira cópia exata de pixels: nitidez total, nada é reamostrado."""
    a = np.asarray(m, np.float64)[:, :2]
    t = np.asarray(m, np.float64)[:, 2]
    if np.abs(a - np.eye(2)).max() < 0.003:
        a, t = np.eye(2), np.round(t)

    def opencv(fator):
        return np.hstack([a, (t * fator + a @ np.array([0.5, 0.5]) - 0.5)[:, None]])
    return opencv(1.0), opencv(0.5)


def _exportar_com_movimento(projeto_dir, original, meta, trechos, total, largura, altura, gravar, com_cor,
                            mov, trilha, flag_filtro, codificacao, saida, progresso, melhorar="nao",
                            enq=None, hdr=None, taxa=Fraction(30), cor=None):
    """Três etapas em fila: ffmpeg (cortes + cor) -> Python (formato, enquadramento, zoom e
    tracking em cada quadro, com precisão de subpixel) -> ffmpeg (legenda e codificação).
    Os quadros passam em YUV, como estão no vídeo: sem converter para RGB e voltar (a cor não
    desloca) e com interpolação bicúbica (não borra quando o quadro anda frações de pixel)."""
    import cv2

    enq = movimento.normalizar_enquadramento(enq)
    cor = cor or cor_saida(meta)
    W, H = largura, altura
    w0, h0 = meta["largura"], meta["altura"]
    # Se o vídeo vai aparecer menor que o original, o ffmpeg reduz antes (lanczos, sem serrilhado):
    # o enquadramento então só aproxima e trabalha perto de 1:1.
    pf = min(1.0, min(W / w0, H / h0) * enq["escala"])
    w, h = (w0, h0) if pf > 0.98 else (max(2, int(round(w0 * pf / 2) * 2)), max(2, int(round(h0 * pf / 2) * 2)))
    ks = _quadros(trechos, taxa)
    q = float(taxa)
    # 1) Áudio já cortado, num arquivo pronto antes de o vídeo começar.
    (projeto_dir / "filtro_audio.txt").write_text(";\n".join(_filtro_audio(ks, taxa)), encoding="utf-8")
    flag_audio = [flag_filtro[0], "filtro_audio.txt"]
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(original.resolve()), *flag_audio,
         "-map", "[ac]", "-c:a", "pcm_s16le", "-ar", "48000", "audio_final.wav"],
        cwd=projeto_dir, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou no áudio: {proc.stderr[-1500:]}")

    # 2) Quadros crus (cortes + cor) -> Python (zoom/tracking) -> 3) ffmpeg final.
    filtro = montar_filtro(trechos, W, H, w0, h0, gravar, com_cor, quadros_brutos=True,
                           hdr=hdr, tamanho_bruto=(w, h), taxa=taxa, cor=cor)
    (projeto_dir / "filtro.txt").write_text(filtro, encoding="utf-8")
    entrada = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-i", str(original.resolve()), *flag_filtro,
         "-map", "[vout]", "-f", "rawvideo", "-pix_fmt", "yuv420p", "pipe:1"],
        cwd=projeto_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    # os quadros crus não levam a tabela de cor: ela é marcada de novo antes da legenda
    etiqueta = (f"setparams=range=tv:color_primaries={cor['primarias']}:color_trc={cor['transferencia']}"
                f":colorspace={cor['matriz']}")
    saida_proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", f"{W}x{H}",
         "-r", str(taxa), "-i", "pipe:0", "-i", "audio_final.wav",
         "-vf", ",".join([etiqueta] + filtro_saida(W, H, W, H, gravar, melhorar)),
         "-map", "0:v", "-map", "1:a", *codificacao, "-shortest", saida],
        cwd=projeto_dir, stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    para_original = _tempo_original(trechos)
    cw, ch = (w + 1) // 2, (h + 1) // 2
    ty, tc = w * h, cw * ch
    tamanho = ty + 2 * tc
    total_quadros = max(1, sum(b - a for a, b in ks))
    n = 0
    try:
        while True:
            bruto = entrada.stdout.read(tamanho)
            if len(bruto) < tamanho:
                break
            buf = np.frombuffer(bruto, np.uint8)
            my, mc = _matrizes_yuv(movimento.matriz(para_original(n / q), mov, trilha, enq, w, h, W, H))
            for plano, mat, tam, fundo in ((buf[:ty].reshape(h, w), my, (W, H), 16),
                                           (buf[ty:ty + tc].reshape(ch, cw), mc, (W // 2, H // 2), 128),
                                           (buf[ty + tc:].reshape(ch, cw), mc, (W // 2, H // 2), 128)):
                saida_proc.stdin.write(cv2.warpAffine(plano, mat, tam, flags=cv2.INTER_CUBIC,
                                                      borderMode=cv2.BORDER_CONSTANT, borderValue=fundo).tobytes())
            n += 1
            if progresso and n % 15 == 0:
                progresso(min(0.99, n / total_quadros))
    except BrokenPipeError:
        pass
    finally:
        if saida_proc.stdin and not saida_proc.stdin.closed:
            try:
                saida_proc.stdin.close()
            except BrokenPipeError:
                pass
    erro_entrada = entrada.stderr.read().decode("utf-8", "replace")
    erro_saida = saida_proc.stderr.read().decode("utf-8", "replace")
    if entrada.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou ao ler o vídeo: {erro_entrada[-1500:]}")
    if saida_proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou na exportação: {erro_saida[-1500:]}")
    (projeto_dir / "audio_final.wav").unlink(missing_ok=True)
