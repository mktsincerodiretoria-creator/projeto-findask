import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/stock/sync - Sincroniza estoque a partir das vendas
// Cria items de estoque para todos os SKUs vendidos e calcula metricas
export async function POST() {
  try {
    // Busca todos os itens de pedidos com SKU dos ultimos 90 dias
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const allOrderItems = await prisma.orderItem.findMany({
      where: {
        sku: { not: null },
        order: { status: { not: "cancelled" } },
      },
      include: {
        order: { select: { orderDate: true, totalAmount: true, account: { select: { platform: true } } } },
      },
    });

    // Agrupa por SKU
    const skuData: Record<string, {
      sku: string;
      title: string;
      totalSold90d: number;
      totalSold30d: number;
      totalRevenue90d: number;
      totalRevenue30d: number;
      avgUnitPrice: number;
      platforms: Set<string>;
      lastSaleDate: Date | null;
      salesByDay: Record<string, number>;
    }> = {};

    for (const item of allOrderItems) {
      if (!item.sku) continue;

      if (!skuData[item.sku]) {
        skuData[item.sku] = {
          sku: item.sku,
          title: item.title || "",
          totalSold90d: 0,
          totalSold30d: 0,
          totalRevenue90d: 0,
          totalRevenue30d: 0,
          avgUnitPrice: 0,
          platforms: new Set(),
          lastSaleDate: null,
          salesByDay: {},
        };
      }

      const d = skuData[item.sku];
      const orderDate = item.order.orderDate;
      const dateKey = orderDate.toISOString().split("T")[0];

      if (orderDate >= ninetyDaysAgo) {
        d.totalSold90d += item.quantity;
        d.totalRevenue90d += item.totalPrice;
      }
      if (orderDate >= thirtyDaysAgo) {
        d.totalSold30d += item.quantity;
        d.totalRevenue30d += item.totalPrice;
        d.salesByDay[dateKey] = (d.salesByDay[dateKey] || 0) + item.quantity;
      }

      d.avgUnitPrice = d.totalRevenue90d / Math.max(d.totalSold90d, 1);
      d.platforms.add(item.order.account.platform);

      if (!d.lastSaleDate || orderDate > d.lastSaleDate) {
        d.lastSaleDate = orderDate;
      }
    }

    // Busca custos cadastrados
    const productCosts = await prisma.productCost.findMany();
    const costMap: Record<string, { cost: number; title: string | null }> = {};
    for (const pc of productCosts) {
      costMap[pc.sku] = { cost: pc.cost, title: pc.title };
    }

    let created = 0;
    let updated = 0;

    for (const [sku, data] of Object.entries(skuData)) {
      const avgDailySales30d = data.totalSold30d / 30;
      const avgDailySales90d = data.totalSold90d / 90;
      // Usa a media mais conservadora (maior) para nao ficar sem estoque
      const avgDailySales = Math.max(avgDailySales30d, avgDailySales90d);

      const cost = costMap[sku]?.cost || 0;
      const title = data.title || costMap[sku]?.title || sku;

      // Verifica se ja existe
      const existing = await prisma.stockItem.findUnique({ where: { sku } });

      if (existing) {
        // Atualiza metricas mas mantem estoque atual, lead time e safety days do usuario
        await prisma.stockItem.update({
          where: { sku },
          data: {
            title: title || existing.title,
            cost: cost > 0 ? cost : existing.cost,
            salePrice: data.avgUnitPrice > 0 ? Math.round(data.avgUnitPrice * 100) / 100 : existing.salePrice,
            avgDailySales: Math.round(avgDailySales * 100) / 100,
            minStock: Math.ceil(avgDailySales * existing.leadTimeDays),
            reorderPoint: Math.ceil(avgDailySales * (existing.leadTimeDays + existing.safetyStockDays)),
          },
        });
        updated++;
      } else {
        // Cria novo item com valores padrao
        const leadTimeDays = 7;
        const safetyStockDays = 30;

        await prisma.stockItem.create({
          data: {
            sku,
            title,
            currentStock: 0, // Usuario precisa informar
            cost: cost > 0 ? cost : 0,
            salePrice: Math.round(data.avgUnitPrice * 100) / 100,
            leadTimeDays,
            safetyStockDays,
            avgDailySales: Math.round(avgDailySales * 100) / 100,
            minStock: Math.ceil(avgDailySales * leadTimeDays),
            reorderPoint: Math.ceil(avgDailySales * (leadTimeDays + safetyStockDays)),
          },
        });
        created++;
      }
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      totalSkus: Object.keys(skuData).length,
      message: `${created} novos SKUs criados, ${updated} atualizados com dados de vendas`,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
