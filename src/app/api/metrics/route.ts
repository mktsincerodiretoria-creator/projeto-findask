import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/metrics?platform=MERCADO_LIVRE&from=2024-01-01&to=2024-12-31
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const platform = searchParams.get("platform");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (platform) {
      where.platform = platform;
    }

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
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
