"""Detecção automática de silêncios e erros de fala.

Tudo aqui trabalha com dois insumos:
  * ``palavras``: lista de dicts {i, texto, inicio, fim, prob} vinda da transcrição;
  * ``db``: energia do áudio em dB, um valor a cada ``passo`` segundos.

O resultado é uma lista de "cortes" (trechos a remover). Cada corte explica o
motivo, para que a pessoa revise antes de exportar.
"""
from __future__ import annotations

import re
import unicodedata
import uuid

import numpy as np

CONFIG_PADRAO = {
    "cortar_silencios": True,
    "silencio_minimo": 0.4,   # segundos de pausa para virar corte
    "margem": 0.12,           # respiro mantido antes/depois de cada fala
    "sensibilidade": 0.5,     # 0..1: quanto maior, mais coisa conta como silêncio
    "detectar_vicios": True,
    "detectar_repeticoes": True,
    "detectar_regravacoes": True,
    "usar_ia": False,
}

TITULOS = {
    "silencio": "Silêncio",
    "vicio": "Vício de linguagem",
    "repeticao": "Palavra repetida",
    "falso_inicio": "Palavra cortada / falso início",
    "regravacao": "Regravação (frase repetida)",
    "erro_assumido": "Erro assumido na gravação",
    "duvida": "Palavra pouco clara",
    "erro_ia": "Erro identificado pela IA",
    "manual": "Corte manual",
}

# Hesitações que quase nunca são conteúdo.
VICIOS_FORTES = {
    "hã", "ãh", "ahn", "ãhn", "hãn", "ã", "hum", "humm", "hmm", "hm", "uhm",
    "uh", "uhn", "eh", "éh", "ehh", "éé", "ééé", "aham",
}
# Palavras que só são vício quando aparecem soltas entre pausas.
VICIOS_ISOLADOS = {"é", "ah", "eh"}
# Muletas comuns: viram sugestão (desligada por padrão).
MULETAS = {"né", "tipo", "sabe", "entendeu", "tá", "então", "assim", "basicamente"}
# Repetições que muitas vezes são ênfase de propósito.
REPETICAO_ENFATICA = {"não", "sim", "muito", "tá", "vai", "bora", "já", "isso", "nada"}
# Frases que indicam que a pessoa errou e vai recomeçar.
MARCADORES_ERRO = [
    "deixa eu começar de novo", "vou começar de novo", "começar de novo",
    "deixa eu repetir", "vou repetir", "vou de novo", "de novo de novo",
    "desculpa", "desculpe", "perdão", "peraí", "pera aí", "pera", "errei",
    "corta", "calma aí",
]


def _limpo(texto: str) -> str:
    """Minúsculas, sem pontuação (mantém acentos)."""
    return re.sub(r"[^\w]+", "", texto.lower())


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )


def _token(texto: str) -> str:
    return _sem_acento(_limpo(texto))


def _novo_corte(inicio, fim, tipo, motivo, ativo=True, origem="auto", palavras=None, trecho=""):
    return {
        "id": uuid.uuid4().hex[:10],
        "inicio": round(float(inicio), 3),
        "fim": round(float(fim), 3),
        "tipo": tipo,
        "titulo": TITULOS.get(tipo, tipo),
        "motivo": motivo,
        "ativo": bool(ativo),
        "origem": origem,
        "palavras": palavras,
        "trecho": trecho,
    }


def _texto(palavras, a, b):
    """Texto das palavras de índice a até b (exclusivo)."""
    return " ".join(p["texto"].strip() for p in palavras[a:b]).strip()


# ---------------------------------------------------------------- silêncios

def limiar_silencio(db: np.ndarray, sensibilidade: float) -> float:
    piso = float(np.percentile(db, 2))
    fala = float(np.percentile(db, 95))
    faixa = fala - piso
    if faixa < 10:
        # Sem diferença clara entre fala e fundo (quase sem pausas, ou música alta):
        # só conta silêncio absoluto; as pausas longas da transcrição completam o resto.
        return min(piso, -55.0)
    return piso + faixa * (0.15 + 0.3 * float(sensibilidade))


def detectar_silencios(db: np.ndarray, passo: float, duracao: float, cfg: dict) -> list[tuple[float, float]]:
    """Trechos em que o áudio fica abaixo do limiar por pelo menos ``silencio_minimo``."""
    if len(db) == 0:
        return []
    limiar = limiar_silencio(db, cfg["sensibilidade"])
    silencioso = db < limiar

    # Estalos curtíssimos no meio de um silêncio não interrompem o silêncio.
    max_estalo = max(1, int(round(0.06 / passo)))
    idx = 0
    n = len(silencioso)
    while idx < n:
        if not silencioso[idx]:
            fim = idx
            while fim < n and not silencioso[fim]:
                fim += 1
            if idx > 0 and fim < n and (fim - idx) <= max_estalo:
                silencioso[idx:fim] = True
            idx = fim
        else:
            idx += 1

    trechos = []
    idx = 0
    while idx < n:
        if silencioso[idx]:
            fim = idx
            while fim < n and silencioso[fim]:
                fim += 1
            a, b = idx * passo, min(fim * passo, duracao)
            if b - a >= cfg["silencio_minimo"]:
                trechos.append((a, b))
            idx = fim
        else:
            idx += 1
    return trechos


def _lacunas_da_transcricao(palavras, duracao, minimo) -> list[tuple[float, float]]:
    """Pausas longas entre palavras (ajuda quando há música de fundo e o áudio nunca 'zera')."""
    lacunas = []
    anterior = 0.0
    for p in palavras:
        if p["inicio"] - anterior >= minimo:
            lacunas.append((anterior, p["inicio"]))
        anterior = max(anterior, p["fim"])
    if palavras and duracao - anterior >= minimo:
        lacunas.append((anterior, duracao))
    return lacunas


def _dentro_de(t, trechos):
    return any(a - 0.05 <= t <= b + 0.05 for a, b in trechos)


def cortes_de_silencio(silencios, palavras, duracao, cfg) -> list[dict]:
    margem = cfg["margem"]
    # Pausas longas que a energia não pegou (fundo musical) entram também.
    extra_min = max(1.0, cfg["silencio_minimo"] * 2)
    for a, b in _lacunas_da_transcricao(palavras, duracao, extra_min):
        meio = (a + b) / 2
        if not _dentro_de(meio, silencios):
            silencios = silencios + [(a, b)]

    cortes = []
    for a, b in sorted(silencios):
        ini = 0.0 if a <= 0.01 else a + margem
        fim = duracao if b >= duracao - 0.01 else b - margem
        if fim - ini < 0.08:
            continue
        cortes.append(_novo_corte(
            ini, fim, "silencio",
            f"Pausa de {b - a:.1f}s sem fala.",
        ))
    return cortes


# ---------------------------------------------------------------- vícios e repetições

def _e_hesitacao(limpo: str) -> bool:
    if limpo in VICIOS_FORTES:
        return True
    sem_h = limpo.replace("h", "")
    # "éé", "ããã", "eee", "mmm": uma única vogal (ou m) esticada.
    return len(sem_h) >= 2 and len(set(sem_h)) == 1 and sem_h[0] in "aãáeéêiouóm"


def _pausa_antes(palavras, i):
    return palavras[i]["inicio"] - palavras[i - 1]["fim"] if i > 0 else 99.0


def _pausa_depois(palavras, i):
    return palavras[i + 1]["inicio"] - palavras[i]["fim"] if i + 1 < len(palavras) else 99.0


def detectar_vicios(palavras) -> list[dict]:
    cortes = []
    for i, p in enumerate(palavras):
        bruto = p["texto"].strip()
        limpo = _limpo(bruto)
        if not limpo:
            continue
        reticencias = "..." in bruto or "…" in bruto
        virgula = bruto.endswith(",") or reticencias
        antes, depois = _pausa_antes(palavras, i), _pausa_depois(palavras, i)

        if _e_hesitacao(limpo):
            cortes.append(_novo_corte(
                p["inicio"], p["fim"], "vicio",
                f'Hesitação "{bruto}" — som de preenchimento sem conteúdo.',
                palavras=[i, i + 1], trecho=bruto,
            ))
        elif limpo in VICIOS_ISOLADOS and (
            (antes >= 0.3 and depois >= 0.3) or (reticencias and depois >= 0.15)
        ):
            cortes.append(_novo_corte(
                p["inicio"], p["fim"], "vicio",
                f'"{bruto}" solto entre pausas — soa como hesitação.',
                palavras=[i, i + 1], trecho=bruto,
            ))
        elif limpo in MULETAS:
            seguinte = _limpo(palavras[i + 1]["texto"]) if i + 1 < len(palavras) else ""
            muleta = (
                (limpo == "né" and (virgula or "?" in bruto or depois >= 0.25 or i + 1 == len(palavras)))
                or (limpo == "tipo" and (virgula or depois >= 0.25 or seguinte == "assim"))
                or (limpo in {"sabe", "entendeu", "tá"} and "?" in bruto)
                or (limpo in {"então", "assim", "basicamente"} and reticencias)
            )
            if muleta:
                cortes.append(_novo_corte(
                    p["inicio"], p["fim"], "vicio",
                    f'Muleta "{bruto}". Deixei como sugestão: ative se quiser remover.',
                    ativo=False, palavras=[i, i + 1], trecho=bruto,
                ))
    return cortes


def detectar_repeticoes(palavras) -> list[dict]:
    cortes = []
    for i in range(len(palavras) - 1):
        a, b = palavras[i], palavras[i + 1]
        ta, tb = _limpo(a["texto"]), _limpo(b["texto"])
        if not ta or b["inicio"] - a["fim"] > 1.0:
            continue
        if ta == tb:
            enfase = ta in REPETICAO_ENFATICA
            cortes.append(_novo_corte(
                a["inicio"], b["inicio"], "repeticao",
                f'"{a["texto"].strip()}" dito duas vezes seguidas — mantive só a segunda.'
                + (" Pode ser ênfase de propósito, então deixei desligado." if enfase else ""),
                ativo=not enfase, palavras=[i, i + 1], trecho=a["texto"].strip(),
            ))
        elif (
            (len(ta) >= 2 and len(tb) > len(ta) + 1 and tb.startswith(ta))
            or a["texto"].strip().endswith("-")
        ):
            cortes.append(_novo_corte(
                a["inicio"], b["inicio"], "falso_inicio",
                f'Começou a falar "{a["texto"].strip()}" e emendou "{b["texto"].strip()}" — palavra interrompida.',
                palavras=[i, i + 1], trecho=a["texto"].strip(),
            ))
    return cortes


# ---------------------------------------------------------------- regravações

def _inicio_da_frase(palavras, m, limite_s=15.0):
    """Volta a partir de ``m`` até o começo da frase (pausa longa ou pontuação final)."""
    s = m
    while s > 0:
        if palavras[m]["inicio"] - palavras[s - 1]["inicio"] > limite_s:
            break
        if _pausa_antes(palavras, s) >= 0.45:
            break
        if re.search(r"[.!?]$", palavras[s - 1]["texto"].strip()):
            break
        s -= 1
    return s


def detectar_erros_assumidos(palavras) -> list[dict]:
    """Pessoa fala "desculpa", "pera", "vou de novo"... e recomeça."""
    tokens = [_token(p["texto"]) for p in palavras]
    marcadores = sorted(
        ([_token(w) for w in m.split()] for m in MARCADORES_ERRO), key=len, reverse=True
    )
    cortes = []
    i = 0
    while i < len(tokens):
        casou = None
        for mk in marcadores:
            if tokens[i:i + len(mk)] == mk:
                casou = mk
                break
        if not casou:
            i += 1
            continue
        fim_marcador = i + len(casou)
        s = _inicio_da_frase(palavras, i)
        fim = palavras[fim_marcador]["inicio"] if fim_marcador < len(palavras) else palavras[fim_marcador - 1]["fim"]
        marcador = _texto(palavras, i, fim_marcador)
        errado = _texto(palavras, s, i)
        motivo = f'Você disse "{marcador}" e recomeçou.'
        if errado:
            motivo += f' Removi a tentativa com erro: "{errado}".'
        cortes.append(_novo_corte(
            palavras[s]["inicio"], fim, "erro_assumido", motivo,
            palavras=[s, fim_marcador], trecho=_texto(palavras, s, fim_marcador),
        ))
        i = fim_marcador
    return cortes


def detectar_regravacoes(palavras, janela_s=25.0, max_palavras=40) -> list[dict]:
    """A mesma sequência de palavras reaparece logo depois: ficou só a última tentativa."""
    tokens = [_token(p["texto"]) for p in palavras]
    n = len(tokens)
    cortes = []
    i = 0
    while i < n:
        achou = None
        if tokens[i]:
            for j in range(i + 1, min(n, i + max_palavras)):
                if palavras[j]["inicio"] - palavras[i]["inicio"] > janela_s:
                    break
                k = 0
                while j + k < n and i + k < j and tokens[i + k] and tokens[i + k] == tokens[j + k]:
                    k += 1
                pausa = _pausa_antes(palavras, j)
                if k >= 3 or (k >= 2 and pausa >= 0.5):
                    achou = (j, k, pausa)
                    break
        if not achou:
            i += 1
            continue
        j, k, pausa = achou
        # Palavra repetida isolada ("eu eu") já é tratada em detectar_repeticoes.
        forte = pausa >= 0.3 or k >= 4
        tentativa = _texto(palavras, i, j)
        cortes.append(_novo_corte(
            palavras[i]["inicio"], palavras[j]["inicio"], "regravacao",
            f'Você começou "{tentativa}" e repetiu a frase logo depois. Mantive só a última tentativa.'
            + ("" if forte else " Confira: pode ser repetição de propósito."),
            ativo=forte, palavras=[i, j], trecho=tentativa,
        ))
        i = j
    return cortes


def detectar_duvidas(palavras, limite=0.3) -> list[dict]:
    cortes = []
    for i, p in enumerate(palavras):
        limpo = _limpo(p["texto"])
        if len(limpo) > 2 and p.get("prob", 1.0) < limite:
            cortes.append(_novo_corte(
                p["inicio"], p["fim"], "duvida",
                f'Não entendi bem "{p["texto"].strip()}" ({p["prob"]:.0%} de certeza). '
                "Ouça: pode ser palavra errada ou mal pronunciada.",
                ativo=False, palavras=[i, i + 1], trecho=p["texto"].strip(),
            ))
    return cortes


# ---------------------------------------------------------------- orquestração

def analisar(palavras, db, passo, duracao, cfg=None) -> list[dict]:
    cfg = {**CONFIG_PADRAO, **(cfg or {})}
    cortes = []
    if cfg["cortar_silencios"]:
        silencios = detectar_silencios(db, passo, duracao, cfg)
        cortes += cortes_de_silencio(silencios, palavras, duracao, cfg)
    if cfg["detectar_vicios"]:
        cortes += detectar_vicios(palavras)
    if cfg["detectar_repeticoes"]:
        cortes += detectar_repeticoes(palavras)
    if cfg["detectar_regravacoes"]:
        cortes += detectar_erros_assumidos(palavras)
        cortes += detectar_regravacoes(palavras)
    cortes += detectar_duvidas(palavras)
    return _remover_duplicados(cortes)


def _sobreposicao(a, b):
    inter = min(a["fim"], b["fim"]) - max(a["inicio"], b["inicio"])
    menor = min(a["fim"] - a["inicio"], b["fim"] - b["inicio"])
    return inter / menor if menor > 0 else 0.0


def _remover_duplicados(cortes):
    """Se dois detectores marcaram o mesmo trecho, fica o que explica mais (não-silêncio primeiro)."""
    prioridade = {"erro_ia": 0, "erro_assumido": 1, "regravacao": 2, "falso_inicio": 3,
                  "repeticao": 4, "vicio": 5, "duvida": 6, "silencio": 7, "manual": -1}
    ordenados = sorted(cortes, key=lambda c: (prioridade.get(c["tipo"], 9), -(c["fim"] - c["inicio"])))
    finais = []
    for c in ordenados:
        if c["tipo"] != "silencio" and any(
            f["tipo"] != "silencio" and _sobreposicao(c, f) > 0.9 for f in finais
        ):
            continue
        finais.append(c)
    return sorted(finais, key=lambda c: c["inicio"])


def mesclar_intervalos(intervalos):
    resultado = []
    for a, b in sorted(intervalos):
        if resultado and a <= resultado[-1][1] + 1e-6:
            resultado[-1][1] = max(resultado[-1][1], b)
        else:
            resultado.append([a, b])
    return [(a, b) for a, b in resultado]


def intervalos_mantidos(cortes, duracao, minimo=0.04):
    """Complemento dos cortes ativos: os trechos que vão para o vídeo final."""
    removidos = mesclar_intervalos(
        (max(0.0, c["inicio"]), min(duracao, c["fim"])) for c in cortes if c.get("ativo")
    )
    mantidos = []
    cursor = 0.0
    for a, b in removidos:
        if a - cursor >= minimo:
            mantidos.append((cursor, a))
        cursor = max(cursor, b)
    if duracao - cursor >= minimo:
        mantidos.append((cursor, duracao))
    return mantidos


def resumo(cortes, duracao):
    mantidos = intervalos_mantidos(cortes, duracao)
    final = sum(b - a for a, b in mantidos)
    por_tipo = {}
    for c in cortes:
        t = por_tipo.setdefault(c["tipo"], {"titulo": TITULOS.get(c["tipo"], c["tipo"]), "total": 0, "ativos": 0})
        t["total"] += 1
        t["ativos"] += int(bool(c.get("ativo")))
    return {
        "duracao_original": round(duracao, 2),
        "duracao_final": round(final, 2),
        "removido": round(duracao - final, 2),
        "por_tipo": por_tipo,
    }
