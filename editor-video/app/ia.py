"""Editor inteligente: o Claude lê a transcrição e aponta os erros de gravação.

Opcional. Só roda quando há uma chave da API da Anthropic configurada
(variável ANTHROPIC_API_KEY ou campo "Chave da IA" nas configurações do app).
"""
from __future__ import annotations

from typing import Literal

import anthropic
from pydantic import BaseModel

from .analise import _novo_corte, _sobreposicao, _texto

MODELO = "claude-opus-5-5"

SISTEMA = """Você é um editor de vídeo profissional que revisa gravações de fala em português \
(vídeos para redes sociais, aulas, anúncios). Você recebe a transcrição palavra a palavra, \
cada uma com seu índice e o tempo em segundos, e aponta os trechos que um bom editor cortaria:

- regravacao: a pessoa começou uma frase, se enrolou e falou de novo. Corte a(s) tentativa(s) \
ruins e mantenha a última (ou a melhor) versão.
- falso_inicio: começou uma palavra ou frase e abandonou no meio.
- gaguejo: palavra ou sílaba repetida sem intenção.
- vicio: "é...", "hã", "tipo", "né" usados como muleta, sem conteúdo.
- correcao: falou algo errado e se corrigiu ("custa 50, quer dizer, 40 reais") — corte a parte errada e a expressão de correção.
- fora_do_roteiro: comentários de bastidor que não deveriam ir ao ar ("corta essa", "tá gravando?", "vou de novo").

Regras:
- Aponte só trechos que realmente devem sair. Repetição usada como ênfase ou recurso de estilo NÃO é erro.
- inicio_palavra e fim_palavra são índices inclusivos; o trecho removido vai do início da primeira à última palavra indicada.
- Nunca corte a versão final e correta de uma frase.
- Em "motivo", explique em uma frase curta, para a pessoa que gravou, qual foi o erro e o que ficou no lugar.
- Use confianca "baixa" quando cortar puder mudar o sentido ou você estiver em dúvida."""


class ErroApontado(BaseModel):
    inicio_palavra: int
    fim_palavra: int
    tipo: Literal["regravacao", "falso_inicio", "gaguejo", "vicio", "correcao", "fora_do_roteiro"]
    motivo: str
    confianca: Literal["alta", "media", "baixa"]


class Revisao(BaseModel):
    erros: list[ErroApontado]
    comentario_geral: str


NOMES_TIPO = {
    "regravacao": "Regravação",
    "falso_inicio": "Falso início",
    "gaguejo": "Gaguejo",
    "vicio": "Vício de linguagem",
    "correcao": "Correção de fala",
    "fora_do_roteiro": "Fora do roteiro",
}


def _transcricao_indexada(palavras) -> str:
    """Uma linha por frase (quebra em pausas), cada palavra como índice:texto."""
    linhas, atual = [], []
    for i, p in enumerate(palavras):
        if atual and p["inicio"] - palavras[i - 1]["fim"] >= 0.6:
            linhas.append(atual)
            atual = []
        atual.append(i)
    if atual:
        linhas.append(atual)
    return "\n".join(
        f'[{palavras[l[0]]["inicio"]:.1f}s] ' + " ".join(f'{i}:{palavras[i]["texto"]}' for i in l)
        for l in linhas
    )


def revisar(palavras, chave: str | None = None) -> tuple[list[dict], str]:
    """Pede ao Claude a lista de erros. Devolve (cortes, comentário geral)."""
    if not palavras:
        return [], ""
    cliente = anthropic.Anthropic(api_key=chave) if chave else anthropic.Anthropic()
    resposta = cliente.beta.messages.parse(
        model=MODELO,
        max_tokens=16000,
        system=SISTEMA,
        output_config={"effort": "high"},
        output_format=Revisao,
        # Se o modelo principal recusar, a própria API repete com outro modelo.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{
            "role": "user",
            "content": "Transcrição (índice:palavra):\n\n" + _transcricao_indexada(palavras),
        }],
    )
    if resposta.stop_reason == "refusal" or resposta.parsed_output is None:
        raise RuntimeError("A IA não conseguiu revisar esta transcrição.")

    n = len(palavras)
    cortes = []
    for e in resposta.parsed_output.erros:
        a = max(0, min(e.inicio_palavra, n - 1))
        b = max(a, min(e.fim_palavra, n - 1))
        # Remove até o começo da palavra seguinte, para não deixar um "buraco" de respiração.
        fim = palavras[b + 1]["inicio"] if b + 1 < n else palavras[b]["fim"]
        corte = _novo_corte(
            palavras[a]["inicio"], fim, "erro_ia",
            e.motivo, ativo=e.confianca != "baixa", origem="ia",
            palavras=[a, b + 1], trecho=_texto(palavras, a, b + 1),
        )
        corte["titulo"] = f"{NOMES_TIPO.get(e.tipo, e.tipo)} (IA)"
        cortes.append(corte)
    return cortes, resposta.parsed_output.comentario_geral


def mesclar(cortes_auto, cortes_ia):
    """Junta a revisão da IA com a automática. Onde as duas marcam o mesmo trecho,
    fica o corte da IA, que costuma explicar melhor o erro."""
    finais = [
        c for c in cortes_auto
        if c["tipo"] == "silencio" or not any(_sobreposicao(c, x) > 0.6 for x in cortes_ia)
    ]
    return sorted(finais + cortes_ia, key=lambda c: c["inicio"])
