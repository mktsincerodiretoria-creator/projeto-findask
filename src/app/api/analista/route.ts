import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/analista - Analista Senior com dados reais do negocio
export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    if (!query) return NextResponse.json({ error: "Pergunta obrigatoria" }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });

    // Busca dados reais do negocio para contexto
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Vendas dos ultimos 30 dias
    const orders = await prisma.order.findMany({
      where: { orderDate: { gte: thirtyDaysAgo }, status: { notIn: ["cancelled", "returned", "refunded", "CANCELLED", "RETURNED"] } },
      include: { items: true, account: { select: { platform: true, nickname: true } } },
    });

    // Custos dos produtos
    const productCosts = await prisma.productCost.findMany();
    const costMap: Record<string, number> = {};
    for (const pc of productCosts) costMap[pc.sku] = pc.cost;

    // Tax rate
    const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    // Estoque
    const stockItems = await prisma.stockItem.findMany({ where: { isActive: true } });

    // Campanhas ADS
    const adMetrics = await prisma.adMetric.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      include: { campaign: { select: { campaignName: true, platform: true } } },
    });

    // Contas conectadas
    const accounts = await prisma.account.findMany({ select: { platform: true, nickname: true, isActive: true } });

    // Calcula metricas por SKU
    const skuMetrics: Record<string, {
      sku: string; title: string; totalSold: number; revenue: number; cost: number;
      platformFee: number; shippingCost: number; margin: number; platforms: Set<string>;
    }> = {};

    for (const order of orders) {
      for (const item of order.items) {
        const sku = item.sku || "SEM_SKU";
        if (!skuMetrics[sku]) {
          skuMetrics[sku] = { sku, title: item.title, totalSold: 0, revenue: 0, cost: 0, platformFee: 0, shippingCost: 0, margin: 0, platforms: new Set() };
        }
        const m = skuMetrics[sku];
        m.totalSold += item.quantity;
        m.revenue += item.totalPrice;
        const unitCost = costMap[sku] || 0;
        m.cost += unitCost * item.quantity;
        m.platformFee += order.platformFee / order.items.length;
        m.shippingCost += order.sellerShippingCost / order.items.length;
        m.platforms.add(order.account.platform);
      }
    }

    // Calcula margem por SKU
    for (const m of Object.values(skuMetrics)) {
      const tax = m.revenue * (taxRate / 100);
      m.margin = m.revenue - m.cost - tax - m.platformFee - m.shippingCost;
    }

    // Totais gerais
    const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalOrders = orders.length;
    const totalPlatformFee = orders.reduce((s, o) => s + o.platformFee, 0);
    const totalShipping = orders.reduce((s, o) => s + o.sellerShippingCost, 0);
    const totalCost = Object.values(skuMetrics).reduce((s, m) => s + m.cost, 0);
    const totalTax = totalRevenue * (taxRate / 100);
    const totalMargin = totalRevenue - totalCost - totalTax - totalPlatformFee - totalShipping;

    // Top e bottom SKUs por margem
    const sortedSkus = Object.values(skuMetrics).sort((a, b) => b.margin - a.margin);
    const topSkus = sortedSkus.slice(0, 10).map(m => ({
      sku: m.sku, title: m.title.slice(0, 50), sold: m.totalSold,
      revenue: m.revenue.toFixed(2), cost: m.cost.toFixed(2), margin: m.margin.toFixed(2),
      marginPct: m.revenue > 0 ? ((m.margin / m.revenue) * 100).toFixed(1) : "0",
    }));
    const bottomSkus = sortedSkus.slice(-5).reverse().map(m => ({
      sku: m.sku, title: m.title.slice(0, 50), sold: m.totalSold,
      revenue: m.revenue.toFixed(2), margin: m.margin.toFixed(2),
      marginPct: m.revenue > 0 ? ((m.margin / m.revenue) * 100).toFixed(1) : "0",
    }));

    // ADS totais
    const adsTotalSpend = adMetrics.reduce((s, m) => s + m.spend, 0);
    const adsTotalRevenue = adMetrics.reduce((s, m) => s + m.revenue, 0);
    const adsTotalClicks = adMetrics.reduce((s, m) => s + m.clicks, 0);
    const adsTotalOrders = adMetrics.reduce((s, m) => s + m.orders, 0);

    // Estoque resumo
    const stockTotal = stockItems.reduce((s, i) => s + i.currentStock, 0);
    const stockCapital = stockItems.reduce((s, i) => s + i.currentStock * i.cost, 0);
    const stockInRupture = stockItems.filter(i => i.currentStock <= 0).length;

    // Plataformas
    const byPlatform: Record<string, { revenue: number; orders: number; margin: number }> = {};
    for (const order of orders) {
      const p = order.account.platform;
      if (!byPlatform[p]) byPlatform[p] = { revenue: 0, orders: 0, margin: 0 };
      byPlatform[p].revenue += order.totalAmount;
      byPlatform[p].orders += 1;
    }

    const businessContext = `
DADOS REAIS DO NEGOCIO (ultimos 30 dias):

RESUMO GERAL:
- Faturamento: R$ ${totalRevenue.toFixed(2)}
- Total de pedidos: ${totalOrders}
- Ticket medio: R$ ${totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0"}
- Custo produtos: R$ ${totalCost.toFixed(2)}
- Impostos (${taxRate}%): R$ ${totalTax.toFixed(2)}
- Tarifas plataforma: R$ ${totalPlatformFee.toFixed(2)}
- Frete vendedor: R$ ${totalShipping.toFixed(2)}
- MARGEM LIQUIDA: R$ ${totalMargin.toFixed(2)} (${totalRevenue > 0 ? ((totalMargin / totalRevenue) * 100).toFixed(1) : "0"}%)

CONTAS CONECTADAS: ${accounts.map(a => `${a.nickname} (${a.platform})`).join(", ")}

POR PLATAFORMA:
${Object.entries(byPlatform).map(([p, d]) => `- ${p}: R$ ${d.revenue.toFixed(2)} (${d.orders} pedidos)`).join("\n")}

TOP 10 PRODUTOS (por margem):
${topSkus.map((s, i) => `${i + 1}. ${s.sku} - ${s.title} | Vendidos: ${s.sold} | Receita: R$ ${s.revenue} | Custo: R$ ${s.cost} | Margem: R$ ${s.margin} (${s.marginPct}%)`).join("\n")}

PIORES PRODUTOS (menor margem):
${bottomSkus.map(s => `- ${s.sku} - ${s.title} | Vendidos: ${s.sold} | Margem: R$ ${s.margin} (${s.marginPct}%)`).join("\n")}

ADS/PUBLICIDADE:
- Investimento total: R$ ${adsTotalSpend.toFixed(2)}
- Receita por ads: R$ ${adsTotalRevenue.toFixed(2)}
- Cliques: ${adsTotalClicks}
- Vendas por ads: ${adsTotalOrders}
- ACOS: ${adsTotalRevenue > 0 ? ((adsTotalSpend / adsTotalRevenue) * 100).toFixed(1) : "0"}%
- TACOS: ${totalRevenue > 0 ? ((adsTotalSpend / totalRevenue) * 100).toFixed(1) : "0"}%

ESTOQUE:
- Total unidades: ${stockTotal}
- Capital parado: R$ ${stockCapital.toFixed(2)}
- Em ruptura: ${stockInRupture} produtos
- Total SKUs: ${stockItems.length}
`;

    const systemPrompt = `Voce e um Analista Estrategico Senior de Marketplace com 15 anos de experiencia pratica em Mercado Livre e Shopee no Brasil. Voce trabalha exclusivamente com REVENDA (nao controla marca/produto).

Voce tem acesso aos DADOS REAIS do negocio do vendedor. Analise SEMPRE com base nesses dados concretos.

## OBJETIVO
Gerar insights estrategicos ACIONAVEIS para aumentar vendas, margem e participacao de mercado. Decisoes rapidas, baseadas em dados praticos, aplicaveis imediatamente.

## COMO RESPONDER
1. DIRETO e PRATICO - o vendedor quer acao, nao teoria
2. Use os NUMEROS REAIS do negocio
3. De RECOMENDACOES ESPECIFICAS (qual SKU, quanto, quando)
4. Priorize o que da mais RESULTADO com menos ESFORCO
5. Aponte PROBLEMAS antes que o vendedor pergunte
6. Formatacao clara com topicos e numeros
7. Portugues brasileiro direto

## ANALISES SEMANAIS (PRIORIDADE MAXIMA)

### 1. Mapeamento de Concorrencia (Benchmarking)
- Quem esta na primeira pagina para cada produto
- Preco minimo viavel sem destruir margem
- Titulos e palavras-chave que estao rankeando
- Volume de vendas e reviews dos lideres

### 2. Analise de Voz do Cliente (Reviews)
- Principais reclamacoes dos concorrentes
- Principais elogios
- Objecoes que precisam ser quebradas
- Oportunidades de diferenciacao
- Sugestoes de melhorias em titulo, imagens e descricao

### 3. Elasticidade de Preco (Pratica)
- Impacto de variacoes de preco na conversao
- Sugerir testes praticos (ex: -R$1, +R$2)
- Faixas onde conversao aumenta vs margem e prejudicada

## ANALISES MENSAIS

### 4. Analise STP Simplificada
- Segmentos de clientes para cada produto
- Possiveis reposicionamentos
- Sugestoes de angulos de venda (titulo, imagem, publico)

### 5. Curva ABC dos SKUs
- A = principais geradores de receita (foco total)
- B = intermediarios (otimizacao)
- C = baixo desempenho (liquidar ou descartar)

### 6. Analise SWOT por Nicho
- Forcas, Fraquezas, Oportunidades, Riscos

## ANALISE ENTRE CONTAS (DIFERENCIAL CRITICO)
O vendedor tem MULTIPLAS CONTAS em ML e Shopee. Voce deve:
1. Identificar produtos que existem na Conta X mas NAO na Conta Y - sugerir replicacao
2. Comparar performance do MESMO produto entre contas - onde esta forte/fraco
3. Descobrir oportunidades ocultas - produtos mal posicionados ou nao explorados

## CONTEXTO ESTRATEGICO
- Mercado de REVENDA - disputa por preco, posicionamento e visibilidade
- Decisoes precisam ser RAPIDAS e APLICAVEIS IMEDIATAMENTE
- Foco em dados praticos, nao teoria

## NAO INCLUIR
- Fluxo de caixa (sera tratado em outra aba)
- Analises macro (TAM, SAM, SOM)
- 5 Forcas de Porter
- PESTEL
- Teoria academica

## FORMATO DAS RESPOSTAS
- Analises objetivas com numeros
- Insights claros e acionaveis
- Sugestoes praticas com SKU especifico
- Linguagem direta sem teoria desnecessaria

${businessContext}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `Claude API error: ${err}` }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    return NextResponse.json({ response: text });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
