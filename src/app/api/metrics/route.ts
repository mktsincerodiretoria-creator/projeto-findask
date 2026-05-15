import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/metrics?platform=MERCADO_LIVRE&from=2024-01-01&to=2024-12-31
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const platform = searchParams.get("platform");
    const accountId = searchParams.get("accountId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // If accountId is provided, compute metrics from orders directly
    if (accountId) {
      return computeMetricsFromOrders(accountId, from, to);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (platform) {
      where.platform = platform;
    }

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.date.lte = toDate;
      }
    }

    const dailyMetrics = await prisma.dailyMetric.findMany({
      where,
      orderBy: { date: "asc" },
    });

    // Calcula totais
    const totals = dailyMetrics.reduce(
      (acc, m) => ({
        revenue: acc.revenue + m.revenue,
        cost: acc.cost + m.cost,
        tax: acc.tax + m.tax,
        platformFee: acc.platformFee + m.platformFee,
        shippingCost: acc.shippingCost + m.shippingCost,
        discount: acc.discount + m.discount,
        margin: acc.margin + m.margin,
        totalOrders: acc.totalOrders + m.totalOrders,
        totalUnits: acc.totalUnits + m.totalUnits,
      }),
      {
        revenue: 0,
        cost: 0,
        tax: 0,
        platformFee: 0,
        shippingCost: 0,
        discount: 0,
        margin: 0,
        totalOrders: 0,
        totalUnits: 0,
      }
    );

    const avgTicket = totals.totalOrders > 0 ? totals.revenue / totals.totalOrders : 0;
    const marginPercent = totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : 0;

    // Metricas por plataforma
    const byPlatform = dailyMetrics.reduce(
      (acc, m) => {
        if (!acc[m.platform]) {
          acc[m.platform] = {
            revenue: 0,
            cost: 0,
            tax: 0,
            platformFee: 0,
            shippingCost: 0,
            discount: 0,
            margin: 0,
            totalOrders: 0,
            totalUnits: 0,
          };
        }
        const p = acc[m.platform];
        p.revenue += m.revenue;
        p.cost += m.cost;
        p.tax += m.tax;
        p.platformFee += m.platformFee;
        p.shippingCost += m.shippingCost;
        p.discount += m.discount;
        p.margin += m.margin;
        p.totalOrders += m.totalOrders;
        p.totalUnits += m.totalUnits;
        return acc;
      },
      {} as Record<string, typeof totals>
    );

    return NextResponse.json({
      totals: { ...totals, avgTicket, marginPercent },
      byPlatform,
      daily: dailyMetrics,
    });
  } catch (error) {
    console.error("Metrics error:", error);
    return NextResponse.json({ error: "Erro ao buscar metricas" }, { status: 500 });
  }
}

async function computeMetricsFromOrders(accountId: string, from: string | null, to: string | null) {
  const cancelledStatuses = ["cancelled", "returned", "refunded", "devolvido", "cancelado", "CANCELLED", "RETURNED", "IN_CANCEL"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { accountId, status: { notIn: cancelledStatuses } };
  if (from || to) {
    where.orderDate = {};
    if (from) where.orderDate.gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.orderDate.lte = d; }
  }

  const [orders, taxSetting, productCosts] = await Promise.all([
    prisma.order.findMany({ where, include: { items: { select: { sku: true, quantity: true } } } }),
    prisma.setting.findUnique({ where: { key: "tax_rate" } }),
    prisma.productCost.findMany({ select: { sku: true, cost: true } }),
  ]);

  const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;
  const costMap: Record<string, number> = {};
  for (const pc of productCosts) costMap[pc.sku] = pc.cost;

  let revenue = 0, cost = 0, tax = 0, platformFee = 0, shippingCost = 0, discount = 0, totalUnits = 0;

  const dailyMap: Record<string, { date: string; platform: string; revenue: number; platformFee: number; shippingCost: number; tax: number; margin: number }> = {};

  for (const order of orders) {
    let orderCost = 0;
    for (const item of order.items) {
      const uc = item.sku ? (costMap[item.sku] || 0) : 0;
      orderCost += uc * item.quantity;
      totalUnits += item.quantity;
    }
    const orderTax = order.totalAmount * (taxRate / 100);
    const orderMargin = order.totalAmount - orderCost - orderTax - order.platformFee - order.sellerShippingCost - order.discount;

    revenue += order.totalAmount;
    cost += orderCost;
    tax += orderTax;
    platformFee += order.platformFee;
    shippingCost += order.sellerShippingCost;
    discount += order.discount;

    const dk = order.orderDate.toISOString().split("T")[0];
    if (!dailyMap[dk]) dailyMap[dk] = { date: dk, platform: "MERCADO_LIVRE", revenue: 0, platformFee: 0, shippingCost: 0, tax: 0, margin: 0 };
    dailyMap[dk].revenue += order.totalAmount;
    dailyMap[dk].platformFee += order.platformFee;
    dailyMap[dk].shippingCost += order.sellerShippingCost;
    dailyMap[dk].tax += orderTax;
    dailyMap[dk].margin += orderMargin;
  }

  const margin = revenue - cost - tax - platformFee - shippingCost - discount;
  const totalOrders = orders.length;
  const avgTicket = totalOrders > 0 ? revenue / totalOrders : 0;
  const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

  return NextResponse.json({
    totals: { revenue, cost, tax, platformFee, shippingCost, discount, margin, totalOrders, totalUnits, avgTicket, marginPercent },
    byPlatform: {},
    daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
  });
}
