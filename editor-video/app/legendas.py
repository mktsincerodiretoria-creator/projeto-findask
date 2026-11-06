"""Monta as legendas a partir das palavras que sobraram depois dos cortes."""
from __future__ import annotations

import re

from .analise import intervalos_mantidos

ESTILO_PADRAO = {
    "ativa": True,
    "modo": "curta",          # "frase" ou "curta" (no máximo 3 palavras por vez, estilo Reels)
    "maiusculas": True,
    "fonte": "Arial Black",
    "tamanho": 4.5,           # % do lado menor do vídeo
    "linhas": 1,              # máximo de linhas na tela (1 ou 2)
    "largura": 86.0,          # % da largura do vídeo que a legenda pode ocupar
    "negrito": False,
    "cor": "#FFFFFF",
    "cor_contorno": "#000000",
    "contorno": 1.0,          # px num vídeo 1080p
    "fundo": False,
    "cor_fundo": "#000000",
    "posicao": "inferior",    # inferior | meio | superior
    "destaque": False,        # pinta a palavra que está sendo falada
    "cor_destaque": "#FFD400",
    "animacao": "nenhuma",    # nenhuma | pop (a legenda entra crescendo) | palavra (cada palavra "pula" na fala)
    "palavras_chave": False,  # pinta preços, números, Shopee, frete grátis...
    "cor_chave": "#FFD400",
}

# Palavras que chamam atenção em vídeo de quem vende (sem acento, minúsculas). Números e preços
# entram sempre; as palavras do dicionário (⚙ Configurações) também.
PALAVRAS_CHAVE = {
    "shopee", "frete", "gratis", "promocao", "desconto", "cupom", "oferta", "lucro", "lucrar", "lucrando",
    "vendas", "faturamento", "faturar", "dinheiro", "barato", "segredo", "dica", "atencao", "erro", "erros",
    "reais", "mil", "milhao", "milhoes",
}
PARES_CHAVE = {("mercado", "livre"), ("por", "cento")}


def _normal(texto: str) -> str:
    import unicodedata
    sem = "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w$%]", "", sem)


def palavras_chave(textos: list[str], extras: set[str] = frozenset()) -> list[bool]:
    """Quais palavras pintar: números e preços, palavras de venda e as do seu dicionário."""
    normais = [_normal(t) for t in textos]
    marcadas = [bool(re.search(r"\d", n)) or n.startswith("r$") or n in PALAVRAS_CHAVE or n in extras
                for n in normais]
    for i in range(len(normais) - 1):
        if (normais[i], normais[i + 1]) in PARES_CHAVE:
            marcadas[i] = marcadas[i + 1] = True
    return marcadas


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


def caracteres_por_linha(estilo, proporcao: float) -> int:
    """Quantas letras cabem numa linha, pelo tamanho da fonte e a largura permitida.
    ``proporcao`` = largura / altura do vídeo (só a proporção importa)."""
    largura_rel = max(proporcao, 1.0)   # largura do vídeo em "lados menores"
    letra = 0.62 if estilo["maiusculas"] else 0.52  # largura média de uma letra, em relação à fonte
    return max(6, int(float(estilo["largura"]) * largura_rel / (letra * float(estilo["tamanho"]))))


def montar_blocos(palavras, cortes, duracao, estilo=None, proporcao: float = 16 / 9):
    """Agrupa palavras em legendas. Cada bloco tem tempos no vídeo original
    (para a prévia) e no vídeo final (para exportar)."""
    estilo = {**ESTILO_PADRAO, **(estilo or {})}
    relogio = Relogio(intervalos_mantidos(cortes, duracao))
    curta = estilo["modo"] == "curta"
    linhas = 1 if int(estilo["linhas"]) <= 1 else 2
    por_linha = caracteres_por_linha(estilo, proporcao)
    max_chars = por_linha * linhas
    max_palavras = 3 if curta else 99
    max_dur = 1.6 if curta else 4.5

    from . import vocabulario
    palavras = vocabulario.corrigir_palavras(palavras)   # "chopi" -> "Shopee" também em projetos antigos

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

    # palavras-chave olhando o texto corrido (assim "mercado | livre" em duas legendas também conta)
    todas = [w for bloco in blocos for w in bloco]
    extras = {_normal(p) for p in vocabulario.palavras_certas()}
    for w, chave in zip(todas, palavras_chave([w["texto"] for w in todas], extras)):
        w["chave"] = chave

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
            "quebra": _quebra(textos, por_linha) if linhas == 2 else None,
            "inicio": round(ini, 3),
            "fim": round(fim, 3),
            "inicio_orig": bloco[0]["inicio"],
            "fim_orig": bloco[-1]["fim"],
            "texto": " ".join(textos),
            "palavras": [
                {"texto": t, "inicio": round(w["ini_final"], 3), "inicio_orig": w["inicio"], "chave": w["chave"]}
                for t, w in zip(textos, bloco)
            ],
        })
    return resultado


def _quebra(textos, por_linha):
    """Índice da palavra que começa a 2ª linha (divisão equilibrada), ou None se cabe em uma."""
    total = len(" ".join(textos))
    if total <= por_linha or len(textos) < 2:
        return None
    melhor, alvo, acc = 1, total / 2, 0
    menor_dif = 1e9
    for i, t in enumerate(textos[:-1]):
        acc += len(t) + 1
        if abs(acc - alvo) < menor_dif:
            menor_dif, melhor = abs(acc - alvo), i + 1
    return melhor


def _quebrar_linhas(bloco):
    return set() if bloco.get("quebra") is None else {bloco["quebra"]}


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
        quebras = _quebrar_linhas(b)
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
    margem_h = round(largura * (100 - float(estilo["largura"])) / 200)
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
    animacao = estilo.get("animacao", "nenhuma")
    cor_chave = _cor_ass(estilo["cor_chave"]) if estilo.get("palavras_chave") else None

    def palavra(t, i, atual, chaves):
        cor = cor_destaque if destaque and i == atual else cor_chave if chaves[i] else None
        if animacao == "palavra" and i == atual:   # a palavra falada "pula" e volta ao tamanho
            t = f"{{\\fscx118\\fscy118\\t(0,140,\\fscx100\\fscy100)}}{t}{{\\fscx100\\fscy100}}"
        return f"{{\\c{cor}}}{t}{{\\c{primaria}}}" if cor else t

    def linha(textos, quebras, chaves, atual=-1, entra=False):
        corpo = "".join(("\\N" if i in quebras else (" " if i else "")) + palavra(t, i, atual, chaves)
                        for i, t in enumerate(textos))
        # "pop": a legenda entra crescendo (só quando aparece, não a cada palavra)
        return ("{\\fscx70\\fscy70\\t(0,110,\\fscx100\\fscy100)}" if entra and animacao == "pop" else "") + corpo

    def evento(ini, fim, texto):
        return f"Dialogue: 0,{_tempo_ass(ini)},{_tempo_ass(fim)},Padrao,,0,0,0,,{texto}"

    eventos = []
    for b in blocos:
        textos = [w["texto"].replace("{", "(").replace("}", ")") for w in b["palavras"]]
        chaves = [bool(w.get("chave")) for w in b["palavras"]]
        quebras = _quebrar_linhas(b)
        if not destaque and animacao != "palavra":
            eventos.append(evento(b["inicio"], b["fim"], linha(textos, quebras, chaves, entra=True)))
            continue
        # Um evento por palavra: a frase inteira na tela, a palavra falada colorida e/ou pulando.
        for i, w in enumerate(b["palavras"]):
            ini = b["inicio"] if i == 0 else w["inicio"]
            fim = b["palavras"][i + 1]["inicio"] if i + 1 < len(b["palavras"]) else b["fim"]
            if fim > ini:
                eventos.append(evento(ini, fim, linha(textos, quebras, chaves, i, entra=i == 0)))
    return cabecalho + "\n".join(eventos) + "\n"
