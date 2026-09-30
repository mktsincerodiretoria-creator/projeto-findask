"""Monta as legendas a partir das palavras que sobraram depois dos cortes."""
from __future__ import annotations

import re

from .analise import intervalos_mantidos

ESTILO_PADRAO = {
    "ativa": True,
    "modo": "frase",          # "frase" (até 2 linhas) ou "curta" (2-3 palavras, estilo Reels)
    "maiusculas": False,
    "fonte": "Arial",
    "tamanho": 6.0,           # % do lado menor do vídeo
    "negrito": True,
    "cor": "#FFFFFF",
    "cor_contorno": "#000000",
    "contorno": 4.0,          # px num vídeo 1080p
    "fundo": False,
    "cor_fundo": "#000000",
    "posicao": "inferior",    # inferior | meio | superior
    "destaque": False,        # pinta a palavra que está sendo falada
    "cor_destaque": "#FFD400",
}


class Relogio:
    """Converte um tempo do vídeo original para o tempo do vídeo já cortado."""

    def __init__(self, mantidos):
        self.mantidos = mantidos
        self.acumulado = []
        total = 0.0
        for a, b in mantidos:
            self.acumulado.append(total)
            total += b - a
        self.total = total

    def contem(self, t):
        return any(a <= t <= b for a, b in self.mantidos)

    def __call__(self, t):
        for (a, b), acc in zip(self.mantidos, self.acumulado):
            if t < a:
                return acc
            if t <= b:
                return acc + (t - a)
        return self.total


def _palavras_visiveis(palavras, relogio):
    return [p for p in palavras if relogio.contem((p["inicio"] + p["fim"]) / 2)]


def _limpar(texto):
    return texto.replace("...", "").replace("…", "").strip()


def montar_blocos(palavras, cortes, duracao, estilo=None):
    """Agrupa palavras em legendas. Cada bloco tem tempos no vídeo original
    (para a prévia) e no vídeo final (para exportar)."""
    estilo = {**ESTILO_PADRAO, **(estilo or {})}
    relogio = Relogio(intervalos_mantidos(cortes, duracao))
    curta = estilo["modo"] == "curta"
    max_chars = 16 if curta else 64
    max_palavras = 3 if curta else 99
    max_dur = 1.6 if curta else 4.5

    blocos, atual = [], []

    def fechar():
        if atual:
            blocos.append(list(atual))
            atual.clear()

    for p in _palavras_visiveis(palavras, relogio):
        texto = _limpar(p["texto"])
        if not texto:
            continue
        item = {**p, "texto": texto, "ini_final": relogio(p["inicio"]), "fim_final": relogio(p["fim"])}
        if atual:
            anterior = atual[-1]
            chars = sum(len(x["texto"]) + 1 for x in atual) + len(texto)
            if (
                chars > max_chars
                or len(atual) >= max_palavras
                or item["ini_final"] - anterior["fim_final"] > 0.7
                or item["fim_final"] - atual[0]["ini_final"] > max_dur
                or re.search(r"[.!?]$", anterior["texto"])
            ):
                fechar()
        atual.append(item)
    fechar()

    resultado = []
    for idx, bloco in enumerate(blocos):
        ini = bloco[0]["ini_final"]
        fim = bloco[-1]["fim_final"]
        prox = blocos[idx + 1][0]["ini_final"] if idx + 1 < len(blocos) else relogio.total
        # Deixa a legenda um pouco mais na tela, sem encostar na próxima.
        fim = min(max(fim + 0.25, ini + 0.6), max(fim, prox - 0.05))
        textos = [w["texto"] for w in bloco]
        if estilo["maiusculas"]:
            textos = [t.upper() for t in textos]
        resultado.append({
            "inicio": round(ini, 3),
            "fim": round(fim, 3),
            "inicio_orig": bloco[0]["inicio"],
            "fim_orig": bloco[-1]["fim"],
            "texto": " ".join(textos),
            "palavras": [
                {"texto": t, "inicio": round(w["ini_final"], 3), "inicio_orig": w["inicio"]}
                for t, w in zip(textos, bloco)
            ],
        })
    return resultado


def _quebrar_linhas(textos, max_linha=34):
    """Divide em duas linhas equilibradas quando o texto é longo. Devolve índices de quebra."""
    total = len(" ".join(textos))
    if total <= max_linha or len(textos) < 2:
        return set()
    melhor, alvo, acc = 1, total / 2, 0
    menor_dif = 1e9
    for i, t in enumerate(textos[:-1]):
        acc += len(t) + 1
        if abs(acc - alvo) < menor_dif:
            menor_dif, melhor = abs(acc - alvo), i + 1
    return {melhor}


def _tempo_srt(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def gerar_srt(blocos) -> str:
    partes = []
    for n, b in enumerate(blocos, 1):
        textos = [w["texto"] for w in b["palavras"]]
        quebras = _quebrar_linhas(textos)
        linha = "".join(("\n" if i in quebras else (" " if i else "")) + t for i, t in enumerate(textos))
        partes.append(f"{n}\n{_tempo_srt(b['inicio'])} --> {_tempo_srt(b['fim'])}\n{linha}\n")
    return "\n".join(partes)


def _cor_ass(hexa: str, alfa: int = 0) -> str:
    hexa = hexa.lstrip("#")
    r, g, b = hexa[0:2], hexa[2:4], hexa[4:6]
    return f"&H{alfa:02X}{b}{g}{r}".upper()


def _tempo_ass(t):
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02}:{s:02}.{cs:02}"


def gerar_ass(blocos, largura: int, altura: int, estilo=None) -> str:
    estilo = {**ESTILO_PADRAO, **(estilo or {})}
    menor = min(largura, altura)
    tamanho = max(12, round(menor * float(estilo["tamanho"]) / 100))
    contorno = round(float(estilo["contorno"]) * menor / 1080, 1)
    alinhamento = {"inferior": 2, "meio": 5, "superior": 8}.get(estilo["posicao"], 2)
    margem_v = round(altura * (0.12 if altura > largura else 0.07))
    margem_h = round(largura * 0.06)
    destaque = bool(estilo["destaque"])
    primaria = _cor_ass(estilo["cor"])
    cor_destaque = _cor_ass(estilo["cor_destaque"])
    if estilo["fundo"]:
        borda, cor_borda, cor_fundo = 3, _cor_ass(estilo["cor_fundo"], 0x40), _cor_ass(estilo["cor_fundo"], 0x40)
        contorno = max(contorno, round(menor * 0.012))
    else:
        borda, cor_borda, cor_fundo = 1, _cor_ass(estilo["cor_contorno"]), _cor_ass("#000000", 0x80)
    negrito = -1 if estilo["negrito"] else 0

    cabecalho = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {largura}
PlayResY: {altura}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Padrao,{estilo["fonte"]},{tamanho},{primaria},{primaria},{cor_borda},{cor_fundo},{negrito},0,0,0,100,100,0,0,{borda},{contorno},0,{alinhamento},{margem_h},{margem_h},{margem_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    def linha(textos, quebras, atual=-1):
        return "".join(
            ("\\N" if i in quebras else (" " if i else ""))
            + (f"{{\\c{cor_destaque}}}{t}{{\\c{primaria}}}" if i == atual else t)
            for i, t in enumerate(textos)
        )

    def evento(ini, fim, texto):
        return f"Dialogue: 0,{_tempo_ass(ini)},{_tempo_ass(fim)},Padrao,,0,0,0,,{texto}"

    eventos = []
    for b in blocos:
        textos = [w["texto"].replace("{", "(").replace("}", ")") for w in b["palavras"]]
        quebras = _quebrar_linhas(textos)
        if not destaque:
            eventos.append(evento(b["inicio"], b["fim"], linha(textos, quebras)))
            continue
        # Um evento por palavra: a frase inteira na tela, só a palavra falada colorida.
        for i, w in enumerate(b["palavras"]):
            ini = b["inicio"] if i == 0 else w["inicio"]
            fim = b["palavras"][i + 1]["inicio"] if i + 1 < len(b["palavras"]) else b["fim"]
            if fim > ini:
                eventos.append(evento(ini, fim, linha(textos, quebras, i)))
    return cabecalho + "\n".join(eventos) + "\n"
