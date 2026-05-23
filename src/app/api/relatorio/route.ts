import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dateFrom = from ? new Date(from) : defaultFrom;
    const dateTo = to ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })() : now;

    const cancelledStatuses = ["cancelled", "returned", "refunded", "devolvido", "cancelado", "CANCELLED", "RETURNED", "IN_CANCEL"];

    const [accounts, orders, taxSetting, productCosts, adMetrics] = await Promise.all([
      prisma.account.findMany({
        select: { id: true, platform: true, nickname: true, platformId: true, isActive: true },
      }),
      prisma.order.findMany({
        where: {
          orderDate: { gte: dateFrom, lte: dateTo },
        },
        include: {
          account: { select: { platform: true, nickname: true, id: true } },
          items: { select: { title: true, sku: true, quantity: true, unitPrice: true, totalPrice: true } },
        },
        orderBy: { orderDate: "desc" },
      }),
      prisma.setting.findUnique({ where: { key: "tax_rate" } }),
      prisma.productCost.findMany(),
      prisma.adDailyTotal.findMany({
        where: { date: { gte: dateFrom, lte: dateTo } },
      }),
    ]);

    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;
    const costMap: Record<string, number> = {};
    for (const pc of productCosts) costMap[pc.sku] = pc.cost;

    const activeOrders = orders.filter(o => !cancelledStatuses.includes(o.status));
    const cancelledOrders = orders.filter(o => cancelledStatuses.includes(o.status));

    // === PER-PLATFORM BREAKDOWN ===
    const platformData: Record<string, {
      revenue: number; cost: number; tax: number; fee: number; frete: number;
      discount: number; margin: number; orders: number; units: number;
      adSpend: number; adRevenue: number;
      missingCostOrders: number; negativeMargOrders: number;
    }> = {};

    for (const order of activeOrders) {
      const plat = order.account.platform;
      if (!platformData[plat]) {
        platformData[plat] = { revenue: 0, cost: 0, tax: 0, fee: 0, frete: 0, discount: 0, margin: 0, orders: 0, units: 0, adSpend: 0, adRevenue: 0, missingCostOrders: 0, negativeMargOrders: 0 };
      }
      const p = platformData[plat];

      let orderCost = 0;
      let hasMissingCost = false;
      for (const item of order.items) {
        const unitCost = item.sku ? (costMap[item.sku] || 0) : 0;
        if (unitCost === 0) hasMissingCost = true;
        orderCost += unitCost * item.quantity;
        p.units += item.quantity;
      }

      const orderTax = order.totalAmount * (taxRate / 100);
      const orderMargin = order.totalAmount - orderCost - orderTax - order.platformFee - order.sellerShippingCost - order.discount;

      p.revenue += order.totalAmount;
      p.cost += orderCost;
      p.tax += orderTax;
      p.fee += order.platformFee;
      p.frete += order.sellerShippingCost;
      p.discount += order.discount;
      p.margin += orderMargin;
      p.orders += 1;
      if (hasMissingCost) p.missingCostOrders++;
      if (orderMargin < 0) p.negativeMargOrders++;
    }

    for (const ad of adMetrics) {
      const plat = ad.platform;
      if (platformData[plat]) {
        platformData[plat].adSpend += ad.spend;
        platformData[plat].adRevenue += ad.revenue;
      }
    }

    // === PER-ACCOUNT BREAKDOWN ===
    const accountData: Record<string, {
      accountId: string; platform: string; nickname: string;
      revenue: number; cost: number; tax: number; fee: number; frete: number;
      discount: number; margin: number; orders: number; units: number;
      missingCostOrders: number; negativeMargOrders: number;
    }> = {};

    for (const order of activeOrders) {
      const accId = order.account.id;
      if (!accountData[accId]) {
        accountData[accId] = {
          accountId: accId, platform: order.account.platform,
          nickname: order.account.nickname || order.account.platform,
          revenue: 0, cost: 0, tax: 0, fee: 0, frete: 0, discount: 0, margin: 0, orders: 0, units: 0,
          missingCostOrders: 0, negativeMargOrders: 0,
        };
      }
      const a = accountData[accId];

      let orderCost = 0;
      let hasMissingCost = false;
      for (const item of order.items) {
        const unitCost = item.sku ? (costMap[item.sku] || 0) : 0;
        if (unitCost === 0) hasMissingCost = true;
        orderCost += unitCost * item.quantity;
        a.units += item.quantity;
      }

      const orderTax = order.totalAmount * (taxRate / 100);
      const orderMargin = order.totalAmount - orderCost - orderTax - order.platformFee - order.sellerShippingCost - order.discount;

      a.revenue += order.totalAmount;
      a.cost += orderCost;
      a.tax += orderTax;
      a.fee += order.platformFee;
      a.frete += order.sellerShippingCost;
      a.discount += order.discount;
      a.margin += orderMargin;
      a.orders += 1;
      if (hasMissingCost) a.missingCostOrders++;
      if (orderMargin < 0) a.negativeMargOrders++;
    }

    // === TOP & BOTTOM SKUs ===
    const skuData: Record<string, {
      sku: string; title: string; revenue: number; cost: number; margin: number;
      units: number; orders: number; hasCost: boolean;
    }> = {};

    for (const order of activeOrders) {
      for (const item of order.items) {
        const key = item.sku || `NO_SKU_${item.title.slice(0, 30)}`;
        if (!skuData[key]) {
          skuData[key] = { sku: item.sku || "", title: item.title, revenue: 0, cost: 0, margin: 0, units: 0, orders: 0, hasCost: false };
        }
        const s = skuData[key];
        const unitCost = item.sku ? (costMap[item.sku] || 0) : 0;
        const itemRevenue = item.totalPrice;
        const itemCost = unitCost * item.quantity;

        s.revenue += itemRevenue;
        s.cost += itemCost;
        s.units += item.quantity;
        s.orders += 1;
        if (unitCost > 0) s.hasCost = true;
      }
    }

    for (const s of Object.values(skuData)) {
      const estimatedFeeRate = 0.15;
      s.margin = s.revenue - s.cost - (s.revenue * taxRate / 100) - (s.revenue * estimatedFeeRate);
    }

    const skuList = Object.values(skuData).sort((a, b) => b.revenue - a.revenue);
    const topSkus = skuList.slice(0, 15);
    const bottomSkus = skuList.filter(s => s.margin < 0).sort((a, b) => a.margin - b.margin).slice(0, 10);
    const missingCostSkus = skuList.filter(s => !s.hasCost);

    // === PROBLEMS IDENTIFICATION ===
    const problems: { severity: string; category: string; description: string; impact: string }[] = [];

    const totalRevenue = activeOrders.reduce((s, o) => s + o.totalAmount, 0);
    const totalMargin = Object.values(platformData).reduce((s, p) => s + p.margin, 0);
    const totalAdSpend = adMetrics.reduce((s, a) => s + a.spend, 0);
    const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

    if (marginPct < 10) {
      problems.push({
        severity: "CRITICO", category: "Margem Baixa",
        description: `Margem liquida geral de ${marginPct.toFixed(1)}% - abaixo do minimo saudavel de 15%`,
        impact: `Faturamento: R$${totalRevenue.toFixed(2)}, Lucro: R$${totalMargin.toFixed(2)}`,
      });
    }

    if (missingCostSkus.length > 0) {
      const pct = ((missingCostSkus.length / skuList.length) * 100).toFixed(0);
      problems.push({
        severity: "ALTO", category: "Custos Ausentes",
        description: `${missingCostSkus.length} SKUs (${pct}%) sem custo cadastrado - margem real desconhecida`,
        impact: `SKUs: ${missingCostSkus.slice(0, 5).map(s => s.sku || s.title.slice(0, 20)).join(", ")}`,
      });
    }

    if (bottomSkus.length > 0) {
      const totalLoss = bottomSkus.reduce((s, sk) => s + sk.margin, 0);
      problems.push({
        severity: "ALTO", category: "SKUs com Prejuizo",
        description: `${bottomSkus.length} SKUs com margem negativa`,
        impact: `Prejuizo total estimado: R$${Math.abs(totalLoss).toFixed(2)}`,
      });
    }

    const cancelRate = orders.length > 0 ? (cancelledOrders.length / orders.length) * 100 : 0;
    if (cancelRate > 5) {
      problems.push({
        severity: "MEDIO", category: "Cancelamentos Altos",
        description: `Taxa de cancelamento/devolucao de ${cancelRate.toFixed(1)}%`,
        impact: `${cancelledOrders.length} pedidos cancelados/devolvidos de ${orders.length} total`,
      });
    }

    if (totalAdSpend > 0 && totalRevenue > 0) {
      const tacos = (totalAdSpend / totalRevenue) * 100;
      if (tacos > 15) {
        problems.push({
          severity: "MEDIO", category: "TACOS Alto",
          description: `Total ACoS (TACOS) de ${tacos.toFixed(1)}% - gastos com ads consumindo margem`,
          impact: `Investimento ADS: R$${totalAdSpend.toFixed(2)} para faturamento de R$${totalRevenue.toFixed(2)}`,
        });
      }
    }

    for (const [plat, data] of Object.entries(platformData)) {
      const platMarginPct = data.revenue > 0 ? (data.margin / data.revenue) * 100 : 0;
      if (platMarginPct < 5 && data.orders > 5) {
        problems.push({
          severity: "ALTO", category: `Margem ${plat}`,
          description: `${plat} com margem de apenas ${platMarginPct.toFixed(1)}%`,
          impact: `${data.orders} pedidos, Receita R$${data.revenue.toFixed(2)}, Margem R$${data.margin.toFixed(2)}`,
        });
      }
    }

    // === RESPONSE ===
    return NextResponse.json({
      periodo: {
        de: dateFrom.toISOString().split("T")[0],
        ate: dateTo.toISOString().split("T")[0],
      },
      resumoGeral: {
        faturamento: totalRevenue,
        custosProdutos: Object.values(platformData).reduce((s, p) => s + p.cost, 0),
        impostos: Object.values(platformData).reduce((s, p) => s + p.tax, 0),
        taxaImpostos: taxRate,
        comissoes: Object.values(platformData).reduce((s, p) => s + p.fee, 0),
        frete: Object.values(platformData).reduce((s, p) => s + p.frete, 0),
        descontos: Object.values(platformData).reduce((s, p) => s + p.discount, 0),
        investimentoAds: totalAdSpend,
        margemLiquida: totalMargin,
        margemPct: marginPct,
        margemAposAds: totalMargin - totalAdSpend,
        totalPedidos: activeOrders.length,
        ticketMedio: activeOrders.length > 0 ? totalRevenue / activeOrders.length : 0,
        cancelamentos: cancelledOrders.length,
        taxaCancelamento: cancelRate,
      },
      porPlataforma: Object.entries(platformData).map(([plat, data]) => ({
        plataforma: plat,
        ...data,
        marginPct: data.revenue > 0 ? (data.margin / data.revenue) * 100 : 0,
        ticketMedio: data.orders > 0 ? data.revenue / data.orders : 0,
        margemAposAds: data.margin - data.adSpend,
      })),
      porConta: Object.values(accountData).map(a => ({
        ...a,
        marginPct: a.revenue > 0 ? (a.margin / a.revenue) * 100 : 0,
        ticketMedio: a.orders > 0 ? a.revenue / a.orders : 0,
      })),
      topSkus,
      skusComPrejuizo: bottomSkus,
      skusSemCusto: missingCostSkus.map(s => ({ sku: s.sku, title: s.title, revenue: s.revenue, units: s.units })),
      problemas: problems,
      contas: accounts.map(a => ({
        id: a.id, platform: a.platform, nickname: a.nickname, platformId: a.platformId, isActive: a.isActive,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
