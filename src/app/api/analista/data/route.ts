import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/analista/data - Retorna dados estruturados para graficos
export async function GET() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    const orders = await prisma.order.findMany({
      where: { orderDate: { gte: thirtyDaysAgo }, status: { notIn: ["cancelled", "returned", "refunded", "CANCELLED", "RETURNED"] } },
      include: { items: true, account: { select: { platform: true, nickname: true, id: true } } },
    });

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

    return NextResponse.json({
      abcData,
      abcSummary,
      platforms: Object.values(platformData),
      accounts: accountList.map(a => ({ ...a, skus: a.skus.size })),
      crossAccount: crossAccount.slice(0, 20),
      daily: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
      totals: { revenue: totalRev, orders: orders.length, taxRate, skus: abcData.length },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
