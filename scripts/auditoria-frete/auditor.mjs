// Auditor de frete do Mercado Livre.
//
// Le os relatorios financeiros (formato MercadoTurbo "CALCULO_RESUMO" ou
// qualquer planilha com as mesmas colunas) e aponta vendas em que o frete
// cobrado do vendedor esta acima do que o proprio ML cobra em vendas
// equivalentes (mesmo anuncio / mesmo SKU / mesma logistica / mesma faixa de preco).
//
// Regras de cobranca usadas como base: docs/frete-mercadolivre-regras.md
// (tabela por faixa de peso x faixa de preco x reputacao; peso cobrado = maior
// entre peso real e cubico A x L x C / 6000).

// Faixas de preco da tabela de custos de envio do ML (vigencia 02/03/2026)
export const FAIXAS_PRECO = [
  { ate: 18.99, nome: "até R$18,99" },
  { ate: 48.99, nome: "R$19 a 48,99" },
  { ate: 78.99, nome: "R$49 a 78,99" },
  { ate: 99.99, nome: "R$79 a 99,99" },
  { ate: 119.99, nome: "R$100 a 119,99" },
  { ate: 149.99, nome: "R$120 a 149,99" },
  { ate: 199.99, nome: "R$150 a 199,99" },
  { ate: Infinity, nome: "R$200 ou mais" },
];

export function faixaPreco(preco) {
  return FAIXAS_PRECO.find((f) => preco <= f.ate).nome;
}

// Diferenca minima para considerar cobranca divergente
const TOLERANCIA_ABS = 0.5;
const TOLERANCIA_PCT = 0.02;

function acimaDaTolerancia(cobrado, esperado) {
  return cobrado - esperado > Math.max(TOLERANCIA_ABS, esperado * TOLERANCIA_PCT);
}

const round2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------
// Leitura das linhas
// ------------------------------------------------------------

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Nome do campo -> possiveis cabecalhos (normalizados, comparacao exata primeiro)
const COLUNAS = {
  idVenda: ["id da venda", "n.o de venda", "numero da venda", "id venda"],
  carrinho: ["id do carrinho"],
  comprador: ["nome do comprador", "comprador"],
  uf: ["estado frete", "estado"],
  anuncio: ["codigo", "# de anuncio", "id do anuncio", "mlb"],
  titulo: ["anuncio", "titulo do anuncio", "titulo"],
  conta: ["conta", "loja"],
  tipo: ["modalidade", "tipo de anuncio"],
  sku: ["sku"],
  data: ["data", "data da venda"],
  logistica: ["frete", "forma de entrega", "logistica"],
  preco: ["valor unit.", "valor unit", "preco unitario"],
  qtd: ["qtd.", "qtd", "quantidade", "unidades"],
  freteComprador: ["frete comprador (-)", "frete comprador"],
  freteVendedor: ["frete vendedor (-)", "frete vendedor", "tarifas de envio", "custo de envio"],
  status: ["status pedido", "status"],
  idFrete: ["id frete", "id do envio", "shipping id"],
};

export function mapearCabecalho(cabecalho) {
  const h = cabecalho.map(norm);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    let idx = -1;
    for (const nome of nomes) {
      idx = h.indexOf(nome);
      if (idx !== -1) break;
    }
    if (idx === -1) {
      for (const nome of nomes) {
        idx = h.findIndex((x) => x.startsWith(nome));
        if (idx !== -1) break;
      }
    }
    mapa[campo] = idx;
  }
  return mapa;
}

function num(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/R\$\s*/i, "").trim();
  if (!s || s === "-") return 0;
  // "1.234,56" -> 1234.56 ; "1234.56" mantem
  const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return parseFloat(t) || 0;
}

function data(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)); // serial Excel
  const m = String(v ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

const id = (v) => String(v ?? "").replace(/^#/, "").trim();

/** Converte matriz [cabecalho, ...linhas] em vendas normalizadas. */
export function lerVendas(matriz, contaPadrao = "") {
  // O cabecalho pode nao estar na primeira linha
  const iCab = matriz.findIndex((l) => l.some((c) => norm(c).startsWith("frete vendedor")));
  if (iCab === -1) throw new Error('coluna "Frete Vendedor" nao encontrada');
  const mapa = mapearCabecalho(matriz[iCab]);
  const get = (linha, campo) => (mapa[campo] === -1 ? "" : linha[mapa[campo]]);

  const vendas = [];
  for (const linha of matriz.slice(iCab + 1)) {
    if (!linha || !linha.some((c) => String(c ?? "").trim())) continue;
    const v = {
      conta: String(get(linha, "conta") || contaPadrao).trim(),
      idVenda: id(get(linha, "idVenda")),
      carrinho: id(get(linha, "carrinho")),
      comprador: String(get(linha, "comprador") ?? "").trim(),
      uf: String(get(linha, "uf") ?? "").trim(),
      anuncio: String(get(linha, "anuncio") ?? "").trim(),
      titulo: String(get(linha, "titulo") ?? "").trim(),
      tipo: String(get(linha, "tipo") ?? "").trim(),
      sku: String(get(linha, "sku") ?? "").trim(),
      data: data(get(linha, "data")),
      logistica: String(get(linha, "logistica") ?? "").trim(),
      preco: num(get(linha, "preco")),
      qtd: num(get(linha, "qtd")) || 1,
      freteComprador: Math.abs(num(get(linha, "freteComprador"))),
      freteVendedor: Math.abs(num(get(linha, "freteVendedor"))),
      status: String(get(linha, "status") ?? "").trim(),
      idFrete: id(get(linha, "idFrete")),
    };
    if (!v.idVenda && !v.anuncio) continue;
    v.cancelada = /cancel/i.test(v.status);
    v.faixa = faixaPreco(v.preco);
    vendas.push(v);
  }
  return vendas;
}

// ------------------------------------------------------------
// Auditoria
// ------------------------------------------------------------

function contagem(valores) {
  const m = new Map();
  for (const x of valores) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

const moda = (valores) => contagem(valores)[0][0];

const descreverValores = (valores) =>
  contagem(valores)
    .map(([v, n]) => `R$${v.toFixed(2)} (${n}x)`)
    .join(" · ");

const dataBR = (d) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "");

/**
 * Detecta mudanca de patamar no frete de um anuncio ao longo do tempo
 * (tipico de re-medicao do pacote pelo ML). Exige >=2 vendas de cada lado
 * e >=80% das vendas de cada lado no mesmo valor.
 */
function detectarMudanca(vendasOrdenadas) {
  const n = vendasOrdenadas.length;
  for (let k = 2; k <= n - 2; k++) {
    const antes = vendasOrdenadas.slice(0, k).map((v) => v.freteVendedor);
    const depois = vendasOrdenadas.slice(k).map((v) => v.freteVendedor);
    const [a, na] = contagem(antes)[0];
    const [b, nb] = contagem(depois)[0];
    if (a === b || na / antes.length < 0.8 || nb / depois.length < 0.8) continue;
    if (Math.abs(b - a) <= Math.max(TOLERANCIA_ABS, a * TOLERANCIA_PCT)) continue;
    // ponto de mudanca = primeira venda do lado "depois" com o novo valor
    const primeira = vendasOrdenadas.slice(k).find((v) => v.freteVendedor === b);
    return { valorAntes: a, valorDepois: b, desde: primeira.data };
  }
  return null;
}

export function auditar(vendas) {
  const comFrete = vendas.filter((v) => v.freteVendedor > 0 && !/combinar/i.test(v.logistica));

  // Agrupa linhas do mesmo envio (carrinho com varios itens divide o frete)
  const envios = new Map();
  for (const v of comFrete) {
    const chave = v.idFrete ? `${v.conta}|${v.idFrete}` : `${v.conta}|venda:${v.idVenda}`;
    if (!envios.has(chave)) envios.set(chave, []);
    envios.get(chave).push(v);
  }
  for (const linhas of envios.values()) {
    const unidades = linhas.reduce((s, v) => s + v.qtd, 0);
    for (const v of linhas) {
      v.envioLinhas = linhas.length;
      v.envioUnidades = unidades;
      v.envioSimples = linhas.length === 1 && v.qtd === 1;
    }
  }

  // Referencia por anuncio: vendas simples (1 unidade, 1 item no envio), nao canceladas
  const base = comFrete.filter((v) => v.envioSimples && !v.cancelada);
  const grupos = new Map();
  for (const v of base) {
    const chave = [v.conta, v.anuncio, v.logistica, v.faixa].join("|");
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(v);
  }

  const anuncios = [];
  const refAnuncio = new Map();
  for (const [chave, lista] of grupos) {
    lista.sort((a, b) => (a.data ?? 0) - (b.data ?? 0));
    const valores = lista.map((v) => v.freteVendedor);
    const mudanca = lista.length >= 4 ? detectarMudanca(lista) : null;
    const info = {
      chave,
      conta: lista[0].conta,
      anuncio: lista[0].anuncio,
      sku: [...new Set(lista.map((v) => v.sku))].join(", "),
      titulo: lista[0].titulo,
      logistica: lista[0].logistica,
      faixa: lista[0].faixa,
      vendas: lista.length,
      moda: moda(valores),
      modaN: contagem(valores)[0][1],
      minimo: Math.min(...valores),
      maximo: Math.max(...valores),
      valores: descreverValores(valores),
      mudanca,
    };
    anuncios.push(info);
    refAnuncio.set(chave, info);
  }

  // Referencia por SKU: menor frete "habitual" (moda) entre anuncios do mesmo SKU
  // com pelo menos 2 vendas. Anuncios diferentes do mesmo produto deveriam ter
  // as mesmas medidas de pacote.
  const porSku = new Map();
  for (const a of anuncios) {
    if (a.modaN < 2) continue; // referencia so vale se o valor se repetiu
    for (const sku of a.sku.split(", ")) {
      if (!sku) continue;
      const chave = [a.conta, sku, a.logistica, a.faixa].join("|");
      if (!porSku.has(chave)) porSku.set(chave, []);
      porSku.get(chave).push(a);
    }
  }
  const divergenciasSku = [];
  const refSku = new Map();
  for (const [chave, lista] of porSku) {
    const menor = lista.reduce((m, a) => (a.moda < m.moda ? a : m));
    refSku.set(chave, menor);
    for (const a of lista) {
      if (a.anuncio !== menor.anuncio && acimaDaTolerancia(a.moda, menor.moda)) {
        divergenciasSku.push({
          conta: a.conta,
          sku: chave.split("|")[1],
          logistica: a.logistica,
          faixa: a.faixa,
          anuncioCaro: a.anuncio,
          freteCaro: a.moda,
          vendasCaro: a.vendas,
          anuncioBarato: menor.anuncio,
          freteBarato: menor.moda,
          vendasBarato: menor.vendas,
          impacto: round2((a.moda - menor.moda) * a.vendas),
        });
      }
    }
  }

  // Mesmo SKU em contas diferentes (informativo: a reputacao de cada conta muda o
  // desconto, mas diferencas grandes costumam ser medidas cadastradas diferentes)
  const entreContas = [];
  const porSkuGlobal = new Map();
  for (const [chave, lista] of porSku) {
    const [conta, sku, logistica, faixa] = chave.split("|");
    const k = [sku, logistica, faixa].join("|");
    if (!porSkuGlobal.has(k)) porSkuGlobal.set(k, new Map());
    const menor = lista.reduce((m, x) => (x.moda < m.moda ? x : m));
    porSkuGlobal.get(k).set(conta, menor);
  }
  for (const [k, contas] of porSkuGlobal) {
    if (contas.size < 2) continue;
    const vals = [...contas.values()];
    const min = Math.min(...vals.map((x) => x.moda));
    const max = Math.max(...vals.map((x) => x.moda));
    if (!acimaDaTolerancia(max, min)) continue;
    const [sku, logistica, faixa] = k.split("|");
    entreContas.push({
      sku,
      logistica,
      faixa,
      diferenca: round2(max - min),
      contas: [...contas.entries()]
        .sort((x, y) => x[1].moda - y[1].moda)
        .map(([c, x]) => `${c}: R$${x.moda.toFixed(2)} (${x.anuncio})`)
        .join(" · "),
    });
  }
  entreContas.sort((x, y) => y.diferenca - x.diferenca);

  // Frete esperado por venda = menor referencia aplicavel
  const alertas = [];
  for (const v of comFrete) {
    const chaveA = [v.conta, v.anuncio, v.logistica, v.faixa].join("|");
    const ra = refAnuncio.get(chaveA);
    const rs = refSku.get([v.conta, v.sku, v.logistica, v.faixa].join("|"));

    const candidatos = [];
    if (ra && ra.modaN >= 2) {
      candidatos.push({
        valor: ra.moda,
        confianca: "ALTA",
        motivo: "Acima do frete habitual deste anúncio",
        evidencia: `Fretes deste anúncio (${v.logistica}, ${v.faixa}): ${ra.valores}`,
      });
      if (ra.mudanca && ra.mudanca.valorDepois > ra.mudanca.valorAntes && v.data >= ra.mudanca.desde) {
        candidatos.push({
          valor: ra.mudanca.valorAntes,
          confianca: "ALTA",
          motivo: "Frete do anúncio subiu de patamar (possível re-medição do pacote pelo ML)",
          evidencia: `Até ${dataBR(ra.mudanca.desde)} o anúncio pagava R$${ra.mudanca.valorAntes.toFixed(2)}; desde então R$${ra.mudanca.valorDepois.toFixed(2)}`,
        });
      }
    }
    if (rs && rs.anuncio !== v.anuncio) {
      candidatos.push({
        valor: rs.moda,
        confianca: "MEDIA",
        motivo: "Mesmo SKU paga menos em outro anúncio (medidas do pacote divergentes)",
        evidencia: `Anúncio ${rs.anuncio} com o SKU ${v.sku} paga R$${rs.moda.toFixed(2)} (${rs.modaN} de ${rs.vendas} vendas)`,
      });
    }
    if (!candidatos.length) continue;

    const unidades = v.envioSimples ? 1 : v.qtd;
    let melhor = candidatos.reduce((m, c) => (c.valor < m.valor ? c : m));
    let esperado = melhor.valor * unidades;
    // Envio com varias unidades: o ML cobra pelo pacote combinado; so alerta se
    // passar do frete de N envios separados
    if (!v.envioSimples) {
      if (v.envioLinhas > 1) continue; // carrinho com itens diferentes: sem referencia confiavel
      melhor = {
        ...melhor,
        motivo: `Envio com ${v.qtd} unidades custou mais que ${v.qtd} envios separados`,
      };
    }
    if (!acimaDaTolerancia(v.freteVendedor, esperado)) continue;

    const diferenca = round2(v.freteVendedor - esperado);
    alertas.push({
      ...v,
      esperado: round2(esperado),
      diferenca,
      motivo: melhor.motivo,
      evidencia: melhor.evidencia,
      confianca: melhor.confianca,
    });
  }

  // Vendas canceladas com frete do vendedor: conferir estorno no extrato
  const canceladas = comFrete.filter((v) => v.cancelada);

  // Frete pesando >= 30% do preco: candidato a revisao de embalagem (peso cubico)
  const freteAlto = anuncios
    .filter((a) => a.moda / precoMedio(base, a) >= 0.3)
    .map((a) => ({ ...a, precoMedio: round2(precoMedio(base, a)), pctPreco: a.moda / precoMedio(base, a) }));

  // Resumo por conta
  const contas = [...new Set(vendas.map((v) => v.conta))].sort();
  const resumo = contas.map((conta) => {
    const vs = comFrete.filter((v) => v.conta === conta && !v.cancelada);
    const al = alertas.filter((a) => a.conta === conta && !a.cancelada);
    return {
      conta,
      vendas: vendas.filter((v) => v.conta === conta).length,
      vendasComFrete: vs.length,
      freteTotal: round2(vs.reduce((s, v) => s + v.freteVendedor, 0)),
      alertas: al.length,
      cobradoAMais: round2(al.reduce((s, a) => s + a.diferenca, 0)),
      anunciosComMudanca: anuncios.filter((a) => a.conta === conta && a.mudanca && a.mudanca.valorDepois > a.mudanca.valorAntes).length,
      skusDivergentes: divergenciasSku.filter((d) => d.conta === conta).length,
      canceladasComFrete: canceladas.filter((v) => v.conta === conta).length,
    };
  });

  alertas.sort((a, b) => b.diferenca - a.diferenca);
  divergenciasSku.sort((a, b) => b.impacto - a.impacto);
  anuncios.sort((a, b) => a.conta.localeCompare(b.conta) || b.vendas - a.vendas);

  return { resumo, alertas, anuncios, divergenciasSku, entreContas, canceladas, freteAlto };
}

function precoMedio(base, a) {
  const vs = base.filter((v) => [v.conta, v.anuncio, v.logistica, v.faixa].join("|") === a.chave);
  return vs.reduce((s, v) => s + v.preco, 0) / vs.length;
}

/** Texto pronto para abrir reclamacao no atendimento do ML, por anuncio. */
export function textosContestacao(resultado) {
  const porAnuncio = new Map();
  for (const a of resultado.alertas) {
    if (a.cancelada) continue;
    const k = `${a.conta}|${a.anuncio}`;
    if (!porAnuncio.has(k)) porAnuncio.set(k, []);
    porAnuncio.get(k).push(a);
  }
  return [...porAnuncio.values()]
    .map((lista) => {
      const a = lista[0];
      const total = round2(lista.reduce((s, x) => s + x.diferenca, 0));
      const vendasTxt = lista
        .map((x) => `- Venda ${x.idVenda} (envio ${x.idFrete || "-"}, ${dataBR(x.data)}): cobrado R$${x.freteVendedor.toFixed(2)}, esperado R$${x.esperado.toFixed(2)}`)
        .join("\n");
      const texto =
        `Olá, solicito a revisão do custo de envio cobrado no anúncio ${a.anuncio} (SKU ${a.sku}, ${a.titulo}).\n` +
        `${a.motivo}. ${a.evidencia}.\n` +
        `Vendas afetadas:\n${vendasTxt}\n` +
        `Diferença total: R$${total.toFixed(2)}.\n` +
        `Peço a conferência do peso e das medidas do pacote (nova medição) e o estorno da diferença. ` +
        `Posso enviar fotos da embalagem com trena e balança.`;
      return { conta: a.conta, anuncio: a.anuncio, sku: a.sku, titulo: a.titulo, vendas: lista.length, total, texto };
    })
    .sort((x, y) => y.total - x.total);
}
