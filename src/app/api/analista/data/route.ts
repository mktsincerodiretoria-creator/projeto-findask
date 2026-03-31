import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/analista/data?accountId=xxx - Retorna dados para graficos (filtro por conta opcional)
export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get("accountId");
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderWhere: any = { orderDate: { gte: sixtyDaysAgo }, status: { notIn: ["cancelled", "returned", "refunded", "CANCELLED", "RETURNED"] } };
    if (accountId) orderWhere.accountId = accountId;

    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: { items: true, account: { select: { platform: true, nickname: true, id: true } } },
    });

    // Separa ultimos 30d e 30-60d para calcular tendencia
    const orders30d = orders.filter(o => o.orderDate >= thirtyDaysAgo);
    const orders60to30d = orders.filter(o => o.orderDate < thirtyDaysAgo);

    const productCosts = await prisma.productCost.findMany();
    const costMap: Record<string, number> = {};
    for (const pc of productCosts) costMap[pc.sku] = pc.cost;

    // SKU metrics
    const skuData: Record<string, {
      sku: string; title: string; sold: number; revenue: number; cost: number;
      fee: number; shipping: number; margin: number; accounts: Set<string>;
    }> = {};

    for (const order of orders) {
      const n = order.items.length || 1;
      for (const item of order.items) {
        const sku = item.sku || "SEM_SKU";
        if (!skuData[sku]) skuData[sku] = { sku, title: item.title, sold: 0, revenue: 0, cost: 0, fee: 0, shipping: 0, margin: 0, accounts: new Set() };
        const s = skuData[sku];
        s.sold += item.quantity;
        s.revenue += item.totalPrice;
        s.cost += (costMap[sku] || 0) * item.quantity;
        s.fee += order.platformFee / n;
        s.shipping += order.sellerShippingCost / n;
        s.accounts.add(`${order.account.nickname || order.account.id}|${order.account.platform}`);
      }
    }

    // Calculate margins and ABC
    const skuList = Object.values(skuData).map(s => {
      const tax = s.revenue * (taxRate / 100);
      s.margin = s.revenue - s.cost - tax - s.fee - s.shipping;
      return s;
    }).sort((a, b) => b.revenue - a.revenue);

    const totalRev = skuList.reduce((s, i) => s + i.revenue, 0);
    let cumRev = 0;
    const abcData = skuList.map(s => {
      cumRev += s.revenue;
      const pct = totalRev > 0 ? (cumRev / totalRev) * 100 : 100;
      const cls = pct <= 80 ? "A" : pct <= 95 ? "B" : "C";
      const marginPct = s.revenue > 0 ? (s.margin / s.revenue) * 100 : 0;
      return {
        sku: s.sku, title: s.title.slice(0, 40), sold: s.sold,
        revenue: Math.round(s.revenue * 100) / 100,
        cost: Math.round(s.cost * 100) / 100,
        margin: Math.round(s.margin * 100) / 100,
        marginPct: Math.round(marginPct * 10) / 10,
        abc: cls,
        accounts: Array.from(s.accounts).map(a => { const [name, plat] = a.split("|"); return { name, platform: plat }; }),
      };
    });

    // By platform
    const platformData: Record<string, { platform: string; revenue: number; orders: number; margin: number }> = {};
    for (const order of orders) {
      const p = order.account.platform;
      if (!platformData[p]) platformData[p] = { platform: p, revenue: 0, orders: 0, margin: 0 };
      platformData[p].revenue += order.totalAmount;
      platformData[p].orders += 1;
    }

    // By account
    const accountData: Record<string, { name: string; platform: string; revenue: number; orders: number; skus: Set<string> }> = {};
    for (const order of orders) {
      const key = order.account.id;
      if (!accountData[key]) accountData[key] = { name: order.account.nickname || key, platform: order.account.platform, revenue: 0, orders: 0, skus: new Set() };
      accountData[key].revenue += order.totalAmount;
      accountData[key].orders += 1;
      for (const item of order.items) if (item.sku) accountData[key].skus.add(item.sku);
    }

    // Cross-account: find SKUs in one account but not another
    const accountList = Object.values(accountData);
    const crossAccount: Array<{ sku: string; title: string; presentIn: string[]; missingIn: string[] }> = [];
    const allSkus = new Set(abcData.map(s => s.sku));
    for (const sku of Array.from(allSkus)) {
      const present = accountList.filter(a => a.skus.has(sku)).map(a => a.name);
      const missing = accountList.filter(a => !a.skus.has(sku)).map(a => a.name);
      if (missing.length > 0 && present.length > 0) {
        const skuInfo = abcData.find(s => s.sku === sku);
        crossAccount.push({ sku, title: skuInfo?.title || sku, presentIn: present, missingIn: missing });
      }
    }

    // Daily revenue for chart
    const dailyData: Record<string, { date: string; revenue: number; orders: number; margin: number }> = {};
    for (const order of orders) {
      const dk = order.orderDate.toISOString().split("T")[0];
      if (!dailyData[dk]) dailyData[dk] = { date: dk, revenue: 0, orders: 0, margin: 0 };
      dailyData[dk].revenue += order.totalAmount;
      dailyData[dk].orders += 1;
    }

    const abcSummary = {
      A: abcData.filter(s => s.abc === "A").length,
      B: abcData.filter(s => s.abc === "B").length,
      C: abcData.filter(s => s.abc === "C").length,
      revenueA: abcData.filter(s => s.abc === "A").reduce((s, i) => s + i.revenue, 0),
      revenueB: abcData.filter(s => s.abc === "B").reduce((s, i) => s + i.revenue, 0),
      revenueC: abcData.filter(s => s.abc === "C").reduce((s, i) => s + i.revenue, 0),
    };

    // BCG Matrix: crescimento (30d vs 30-60d) vs participacao de mercado (% receita)
    const sku30d: Record<string, number> = {};
    const sku60to30d: Record<string, number> = {};
    for (const o of orders30d) for (const i of o.items) { const sk = i.sku || "SEM_SKU"; sku30d[sk] = (sku30d[sk] || 0) + i.totalPrice; }
    for (const o of orders60to30d) for (const i of o.items) { const sk = i.sku || "SEM_SKU"; sku60to30d[sk] = (sku60to30d[sk] || 0) + i.totalPrice; }

    const totalRev30d = Object.values(sku30d).reduce((s, v) => s + v, 0);
    const bcgData = abcData.map(s => {
      const rev30 = sku30d[s.sku] || 0;
      const rev60to30 = sku60to30d[s.sku] || 0;
      const growth = rev60to30 > 0 ? ((rev30 - rev60to30) / rev60to30) * 100 : (rev30 > 0 ? 100 : 0);
      const share = totalRev30d > 0 ? (rev30 / totalRev30d) * 100 : 0;
      let quadrant = "Abacaxi";
      if (growth > 0 && share > 5) quadrant = "Estrela";
      else if (growth > 0 && share <= 5) quadrant = "Interrogacao";
      else if (growth <= 0 && share > 5) quadrant = "Vaca Leiteira";
      return { sku: s.sku, title: s.title, revenue30d: Math.round(rev30 * 100) / 100, growth: Math.round(growth * 10) / 10, share: Math.round(share * 10) / 10, quadrant, margin: s.margin, marginPct: s.marginPct };
    });

    // Problematicos: SKUs com margem negativa ou queda forte
    const problematic = bcgData.filter(s => s.marginPct < 0 || s.growth < -30).sort((a, b) => a.marginPct - b.marginPct);

    // Tendencias: SKUs em alta vs queda
    const trending = bcgData.filter(s => s.revenue30d > 0).sort((a, b) => b.growth - a.growth);
    const rising = trending.filter(s => s.growth > 10).slice(0, 10);
    const falling = trending.filter(s => s.growth < -10).sort((a, b) => a.growth - b.growth).slice(0, 10);

    // Lista de contas para filtro
    const accountOptions = await prisma.account.findMany({
      where: { isActive: true },
      select: { id: true, nickname: true, platform: true },
    });

    return NextResponse.json({
      abcData,
      abcSummary,
      bcgData,
      problematic,
      rising,
      falling,
      platforms: Object.values(platformData),
      accounts: accountList.map(a => ({ ...a, skus: a.skus.size })),
      accountOptions,
      crossAccount: crossAccount.slice(0, 20),
      daily: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
      totals: { revenue: totalRev, orders: orders.length, taxRate, skus: abcData.length },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
