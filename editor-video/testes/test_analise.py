import numpy as np

from app import analise, legendas
from app.exportar import dimensoes_saida, montar_filtro


def falas(*itens):
    """Monta palavras a partir de (texto, pausa_antes). Cada palavra dura 0.3s."""
    palavras, t = [], 0.5
    for texto, pausa in itens:
        t += pausa
        palavras.append({"i": len(palavras), "texto": texto, "inicio": round(t, 3), "fim": round(t + 0.3, 3), "prob": 0.95})
        t += 0.3
    return palavras


def tipos_ativos(cortes):
    return [(c["tipo"], c["trecho"]) for c in cortes if c["ativo"]]


def test_silencio_detectado_com_margem():
    passo = 0.01
    db = np.full(600, -20.0, dtype=np.float32)   # 6s de fala...
    db[200:350] = -70                             # ...com 1.5s de silêncio no meio
    cfg = {**analise.CONFIG_PADRAO}
    sil = analise.detectar_silencios(db, passo, 6.0, cfg)
    assert len(sil) == 1
    a, b = sil[0]
    assert abs(a - 2.0) < 0.02 and abs(b - 3.5) < 0.02
    cortes = analise.cortes_de_silencio(sil, [], 6.0, cfg)
    assert abs(cortes[0]["inicio"] - 2.12) < 0.02 and abs(cortes[0]["fim"] - 3.38) < 0.02


def test_silencio_curto_nao_corta():
    db = np.full(600, -20.0, dtype=np.float32)
    db[200:230] = -70  # 0.3s: pausa natural
    assert analise.detectar_silencios(db, 0.01, 6.0, analise.CONFIG_PADRAO) == []


def test_estalo_no_meio_do_silencio_nao_divide():
    db = np.full(600, -20.0, dtype=np.float32)
    db[100:300] = -70
    db[200:203] = -20  # clique de 30ms
    assert len(analise.detectar_silencios(db, 0.01, 6.0, analise.CONFIG_PADRAO)) == 1


def test_hesitacoes_e_muletas():
    p = falas(("Hoje", 0), ("éé", 0.1), ("vou", 0.1), ("mostrar,", 0), ("né,", 0), ("hã", 0.4), ("o", 0.4), ("tipo", 0), ("de", 0), ("bolo", 0))
    cortes = analise.detectar_vicios(p)
    ativos = [c["trecho"] for c in cortes if c["ativo"]]
    sugestoes = [c["trecho"] for c in cortes if not c["ativo"]]
    assert ativos == ["éé", "hã"]
    assert sugestoes == ["né,"]  # "tipo de" é uso normal, não muleta


def test_e_isolado_entre_pausas_vira_vicio_mas_e_verbo_nao():
    p = falas(("Isso", 0), ("é", 0.5), ("importante", 0.5), ("É", 0.5), ("fácil", 0))
    cortes = analise.detectar_vicios(p)
    assert [c["trecho"] for c in cortes] == ["é"]


def test_repeticao_e_falso_inicio():
    p = falas(("eu", 0), ("eu", 0.05), ("vou", 0), ("prob", 0.1), ("problema", 0.1), ("não", 0), ("não", 0))
    cortes = analise.detectar_repeticoes(p)
    assert [(c["tipo"], c["trecho"], c["ativo"]) for c in cortes] == [
        ("repeticao", "eu", True),
        ("falso_inicio", "prob", True),
        ("repeticao", "não", False),  # "não não" pode ser ênfase
    ]
    # O corte vai do começo da 1ª ocorrência até o começo da 2ª.
    assert cortes[0]["inicio"] == p[0]["inicio"] and cortes[0]["fim"] == p[1]["inicio"]


def test_regravacao_mantem_ultima_tentativa():
    p = falas(
        ("Olá", 0), ("pessoal.", 0),
        ("Hoje", 0.8), ("eu", 0), ("vou", 0), ("ensinar", 0), ("a", 0), ("fazer", 0), ("um", 0), ("bolo", 0), ("de", 0), ("chuc", 0),
        ("Hoje", 0.7), ("eu", 0), ("vou", 0), ("ensinar", 0), ("a", 0), ("fazer", 0), ("um", 0), ("bolo", 0), ("de", 0), ("cenoura.", 0),
    )
    cortes = analise.detectar_regravacoes(p)
    assert len(cortes) == 1
    c = cortes[0]
    assert c["ativo"] and c["tipo"] == "regravacao"
    assert c["inicio"] == p[2]["inicio"] and c["fim"] == p[12]["inicio"]
    assert "chuc" in c["trecho"]


def test_tres_tentativas_viram_dois_cortes():
    tentativa = [("vamos", 0.8), ("começar", 0), ("agora", 0)]
    p = falas(*tentativa, *tentativa, *tentativa, ("mesmo.", 0))
    cortes = analise.detectar_regravacoes(p)
    assert len(cortes) == 2
    assert cortes[1]["fim"] == p[6]["inicio"]


def test_erro_assumido_com_desculpa():
    p = falas(
        ("Tudo", 0), ("certo.", 0),
        ("O", 0.8), ("preço", 0), ("é", 0), ("cinquenta", 0), ("desculpa", 0.2),
        ("o", 0.3), ("preço", 0), ("é", 0), ("quarenta", 0), ("reais.", 0),
    )
    cortes = analise.detectar_erros_assumidos(p)
    assert len(cortes) == 1
    assert cortes[0]["inicio"] == p[2]["inicio"] and cortes[0]["fim"] == p[7]["inicio"]
    assert "cinquenta" in cortes[0]["motivo"]


def test_intervalos_mantidos_e_resumo():
    cortes = [
        {"inicio": 1, "fim": 2, "ativo": True, "tipo": "silencio"},
        {"inicio": 1.5, "fim": 3, "ativo": True, "tipo": "vicio"},
        {"inicio": 5, "fim": 6, "ativo": False, "tipo": "duvida"},
    ]
    assert analise.intervalos_mantidos(cortes, 10) == [(0.0, 1), (3, 10)]
    r = analise.resumo(cortes, 10)
    assert r["duracao_final"] == 8 and r["por_tipo"]["duvida"]["ativos"] == 0


def test_legendas_usam_tempo_do_video_cortado():
    p = falas(("Olá", 0), ("pessoal.", 0), ("hã", 0.1), ("Tudo", 1.5), ("bem?", 0))
    cortes = [
        {"inicio": p[2]["inicio"], "fim": p[3]["inicio"] - 0.1, "ativo": True, "tipo": "vicio"},
    ]
    blocos = legendas.montar_blocos(p, cortes, 5.0)
    assert [b["texto"] for b in blocos] == ["Olá pessoal.", "Tudo bem?"]
    removido = cortes[0]["fim"] - cortes[0]["inicio"]
    assert abs(blocos[1]["inicio"] - (p[3]["inicio"] - removido)) < 0.01
    srt = legendas.gerar_srt(blocos)
    assert "00:00:00,500 --> " in srt and "Tudo bem?" in srt
    ass = legendas.gerar_ass(blocos, 1080, 1920, {"destaque": True})
    assert "PlayResY: 1920" in ass and "{\\c&H0000D4FF}" in ass


def test_modo_curto_quebra_em_poucas_palavras():
    p = falas(*[(w, 0) for w in "isso aqui é um teste de legenda curta".split()])
    blocos = legendas.montar_blocos(p, [], 5.0, {"modo": "curta", "maiusculas": True})
    assert all(len(b["palavras"]) <= 3 for b in blocos)
    assert blocos[0]["texto"] == blocos[0]["texto"].upper()


def test_dimensoes_saida():
    assert dimensoes_saida(1920, 1080, "original") == (1920, 1080)
    assert dimensoes_saida(1080, 1920, "2160") == (2160, 3840)
    assert dimensoes_saida(1280, 720, "1080") == (1920, 1080)
    filtro = montar_filtro([(0, 1), (2, 3)], 1920, 1080, 1280, 720, True)
    assert "concat=n=2" in filtro and "scale=1920:1080" in filtro and "subtitles=legendas.ass" in filtro
