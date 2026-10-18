#!/usr/bin/env node
// Uso: node scripts/auditoria-frete/cli.mjs <relatorio1.xlsx|csv> [...] [--saida auditoria.xlsx]
//
// Aceita os relatorios "MercadoTurbo_Financeiro_..._CALCULO_RESUMO" (uma conta
// por arquivo ou varias juntas, pela coluna "Conta").

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { auditar, lerVendas, textosContestacao } from "./auditor.mjs";

const args = process.argv.slice(2);
const iSaida = args.indexOf("--saida");
const saida = iSaida !== -1 ? args.splice(iSaida, 2)[1] : "auditoria-frete.xlsx";
if (!args.length) {
  console.error("Uso: node scripts/auditoria-frete/cli.mjs <relatorio.xlsx|csv> [...] [--saida arquivo.xlsx]");
  process.exit(1);
}

const vendas = [];
for (const arquivo of args) {
  // CSV: le como UTF-8 (o SheetJS assume Latin-1 e estraga os acentos dos cabecalhos)
  const wb = arquivo.toLowerCase().endsWith(".csv")
    ? XLSX.read(fs.readFileSync(arquivo, "utf8").replace(/^﻿/, ""), { type: "string", raw: true })
    : XLSX.readFile(arquivo, { cellDates: true });
  // "MELI CJ MercadoTurbo_Financeiro_..." -> "CJ"
  const rotulo =
    path
      .basename(arquivo)
      .replace(/\.[^.]+$/, "")
      .split(/MercadoTurbo/i)[0]
      .replace(/^MELI[\s_-]*/i, "")
      .replace(/[\s_-]+$/, "") || path.basename(arquivo);
  let lidas = null;
  for (const nome of wb.SheetNames) {
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: "", raw: true });
    try {
      lidas = lerVendas(matriz, rotulo);
      break;
    } catch {
      // aba sem a coluna de frete; tenta a proxima
    }
  }
  if (!lidas) {
    console.error(`! ${arquivo}: nenhuma aba com a coluna "Frete Vendedor"`);
    continue;
  }
  // Arquivo de uma conta so: usa o nome do arquivo (o relatorio traz o codigo da conta)
  const contasArquivo = new Set(lidas.map((v) => v.conta));
  if (contasArquivo.size === 1 && rotulo !== [...contasArquivo][0]) {
    for (const v of lidas) v.conta = `${rotulo} (${v.conta})`;
  }
  console.log(`${path.basename(arquivo)}: ${lidas.length} vendas`);
  vendas.push(...lidas);
}

const r = auditar(vendas);
const contestacoes = textosContestacao(r);
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "");

console.log("\nResumo por conta:");
for (const c of r.resumo) {
  console.log(
    `  ${c.conta}: ${c.vendasComFrete} vendas com frete, ${brl(c.freteTotal)} de frete; ` +
      `${c.alertas} alertas, possivel cobranca a mais ${brl(c.cobradoAMais)}`
  );
}

// ---------- Planilha de saida ----------
const wb = XLSX.utils.book_new();
const aba = (nome, linhas, larguras) => {
  const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ "": "Nenhum item" }]);
  if (larguras) ws["!cols"] = larguras.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, nome);
};

aba(
  "Resumo",
  r.resumo.map((c) => ({
    Conta: c.conta,
    "Vendas no relatorio": c.vendas,
    "Vendas com frete (nao canceladas)": c.vendasComFrete,
    "Frete total cobrado (R$)": c.freteTotal,
    Alertas: c.alertas,
    "Possivel cobranca a mais (R$)": c.cobradoAMais,
    "Anuncios com frete que subiu": c.anunciosComMudanca,
    "SKUs com frete divergente": c.skusDivergentes,
    "Canceladas com frete (conferir estorno)": c.canceladasComFrete,
  })),
  [22, 10, 14, 14, 9, 14, 14, 14, 16]
);

aba(
  "Alertas",
  r.alertas.map((a) => ({
    Confianca: a.confianca,
    Conta: a.conta,
    Data: dataBR(a.data),
    "ID da venda": a.idVenda,
    "Id Frete": a.idFrete,
    Anuncio: a.anuncio,
    SKU: a.sku,
    Titulo: a.titulo,
    Logistica: a.logistica,
    Tipo: a.tipo,
    "Preco unit.": a.preco,
    Qtd: a.qtd,
    Status: a.status,
    "Frete cobrado (R$)": a.freteVendedor,
    "Frete esperado (R$)": a.esperado,
    "Diferenca (R$)": a.diferenca,
    Motivo: a.motivo,
    Evidencia: a.evidencia,
  })),
  [9, 18, 11, 18, 13, 15, 12, 40, 9, 9, 9, 5, 10, 11, 11, 11, 50, 70]
);

aba(
  "SKU divergente",
  r.divergenciasSku.map((d) => ({
    Conta: d.conta,
    SKU: d.sku,
    Logistica: d.logistica,
    "Faixa de preco": d.faixa,
    "Anuncio mais caro": d.anuncioCaro,
    "Frete (R$)": d.freteCaro,
    Vendas: d.vendasCaro,
    "Anuncio mais barato": d.anuncioBarato,
    "Frete referencia (R$)": d.freteBarato,
    "Vendas ref.": d.vendasBarato,
    "Impacto no periodo (R$)": d.impacto,
  })),
  [18, 12, 9, 16, 16, 10, 7, 16, 12, 8, 14]
);

aba(
  "Entre contas",
  r.entreContas.map((e) => ({
    SKU: e.sku,
    Logistica: e.logistica,
    "Faixa de preco": e.faixa,
    "Diferenca (R$)": e.diferenca,
    "Frete habitual por conta": e.contas,
    Observacao: "A reputacao muda o desconto; diferencas grandes indicam medidas de pacote diferentes entre as contas",
  })),
  [12, 9, 16, 11, 90, 60]
);

aba(
  "Anuncios",
  r.anuncios.map((a) => ({
    Conta: a.conta,
    Anuncio: a.anuncio,
    SKU: a.sku,
    Titulo: a.titulo,
    Logistica: a.logistica,
    "Faixa de preco": a.faixa,
    "Vendas (1 un.)": a.vendas,
    "Frete habitual (R$)": a.moda,
    "Min (R$)": a.minimo,
    "Max (R$)": a.maximo,
    "Valores cobrados": a.valores,
    "Mudanca de patamar": a.mudanca
      ? `R$${a.mudanca.valorAntes.toFixed(2)} -> R$${a.mudanca.valorDepois.toFixed(2)} desde ${dataBR(a.mudanca.desde)}`
      : "",
  })),
  [18, 15, 14, 40, 9, 16, 8, 10, 9, 9, 50, 36]
);

aba(
  "Frete alto",
  r.freteAlto.map((a) => ({
    Conta: a.conta,
    Anuncio: a.anuncio,
    SKU: a.sku,
    Titulo: a.titulo,
    Logistica: a.logistica,
    "Preco medio (R$)": a.precoMedio,
    "Frete habitual (R$)": a.moda,
    "Frete / preco": `${Math.round(a.pctPreco * 100)}%`,
    Sugestao: "Conferir peso e medidas da caixa: o ML cobra pelo maior entre peso real e A x L x C / 6000",
  })),
  [18, 15, 12, 40, 9, 10, 10, 8, 70]
);

aba(
  "Canceladas c frete",
  r.canceladas.map((v) => ({
    Conta: v.conta,
    Data: dataBR(v.data),
    "ID da venda": v.idVenda,
    "Id Frete": v.idFrete,
    Anuncio: v.anuncio,
    SKU: v.sku,
    "Frete vendedor (R$)": v.freteVendedor,
    Acao: "Conferir no extrato do Mercado Pago se o frete foi estornado",
  })),
  [18, 11, 18, 13, 15, 12, 10, 55]
);

aba(
  "Contestacao",
  contestacoes.map((c) => ({
    Conta: c.conta,
    Anuncio: c.anuncio,
    SKU: c.sku,
    Vendas: c.vendas,
    "Total (R$)": c.total,
    "Texto para o atendimento do ML": c.texto,
  })),
  [18, 15, 12, 7, 10, 120]
);

XLSX.writeFile(wb, saida);
console.log(`\nRelatorio salvo em ${saida}`);
