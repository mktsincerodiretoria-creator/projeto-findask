import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/stock - Lista todos os itens de estoque com metricas calculadas
export async function GET() {
  try {
    const stockItems = await prisma.stockItem.findMany({
      where: { isActive: true },
      include: { purchases: { orderBy: { orderDate: "desc" }, take: 3 } },
      orderBy: { updatedAt: "desc" },
    });

    // Busca vendas dos ultimos 30 dias por SKU para calcular media diaria
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orderItems = await prisma.orderItem.findMany({
      where: {
        sku: { not: null },
        order: { orderDate: { gte: thirtyDaysAgo }, status: { not: "cancelled" } },
      },
      select: { sku: true, quantity: true },
    });

    // Agrupa vendas por SKU
    const salesBySku: Record<string, number> = {};
    for (const item of orderItems) {
      if (item.sku) {
        salesBySku[item.sku] = (salesBySku[item.sku] || 0) + item.quantity;
      }
    }

    // Calcula metricas para cada item
    const enriched = stockItems.map((item) => {
      const totalSold30d = salesBySku[item.sku] || 0;
      const avgDailySales = totalSold30d / 30;
      const coverageDays = avgDailySales > 0 ? Math.floor(item.currentStock / avgDailySales) : 999;
      const monthlyTurnover = avgDailySales > 0 ? (avgDailySales * 30) / Math.max(item.currentStock, 1) : 0;

      // Calcula ponto de reposicao: (vendas/dia * lead_time) + (vendas/dia * dias_seguranca)
      const minStock = Math.ceil(avgDailySales * item.leadTimeDays);
      const safetyStock = Math.ceil(avgDailySales * item.safetyStockDays);
      const reorderPoint = minStock + safetyStock;

      // Quantidade sugerida de compra (1 mes de reserva)
      const suggestedPurchase = Math.max(0, reorderPoint - item.currentStock);

      // Status
      let status = "ok";
      if (item.currentStock <= 0) status = "ruptura";
      else if (item.currentStock <= minStock) status = "critico";
      else if (item.currentStock <= reorderPoint) status = "comprar";

      // Margem
      const margin = item.salePrice > 0 ? ((item.salePrice - item.cost) / item.salePrice) * 100 : 0;

      // Capital parado
      const capitalTied = item.currentStock * item.cost;

      return {
        ...item,
        avgDailySales: Math.round(avgDailySales * 100) / 100,
        totalSold30d,
        coverageDays,
        monthlyTurnover: Math.round(monthlyTurnover * 100) / 100,
        minStock,
        safetyStock,
        reorderPoint,
        suggestedPurchase,
        status,
        margin: Math.round(margin * 100) / 100,
        capitalTied,
      };
    });

    // Classificacao ABC
    const sorted = [...enriched].sort((a, b) => (b.totalSold30d * b.salePrice) - (a.totalSold30d * a.salePrice));
    const totalRevenue = sorted.reduce((sum, i) => sum + (i.totalSold30d * i.salePrice), 0);
    let cumulative = 0;
    for (const item of sorted) {
      cumulative += item.totalSold30d * item.salePrice;
      const pct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 100;
      if (pct <= 80) item.abcClass = "A";
      else if (pct <= 95) item.abcClass = "B";
      else item.abcClass = "C";
    }

    // Totais
    const totals = {
      totalSkus: enriched.length,
      totalStock: enriched.reduce((s, i) => s + i.currentStock, 0),
      totalCapital: enriched.reduce((s, i) => s + i.capitalTied, 0),
      inRupture: enriched.filter(i => i.status === "ruptura").length,
      needPurchase: enriched.filter(i => i.status === "comprar" || i.status === "critico").length,
      classA: enriched.filter(i => i.abcClass === "A").length,
      classB: enriched.filter(i => i.abcClass === "B").length,
      classC: enriched.filter(i => i.abcClass === "C").length,
    };

    return NextResponse.json({ items: enriched, totals });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/stock - Criar ou atualizar item de estoque
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Bulk import (array)
    if (Array.isArray(body)) {
      let created = 0, updated = 0;
      for (const item of body) {
        if (!item.sku) continue;
        const existing = await prisma.stockItem.findUnique({ where: { sku: item.sku } });
        if (existing) {
          await prisma.stockItem.update({
            where: { sku: item.sku },
            data: {
              title: item.title || existing.title,
              currentStock: item.currentStock !== undefined ? Number(item.currentStock) : existing.currentStock,
              cost: item.cost !== undefined ? Number(item.cost) : existing.cost,
              salePrice: item.salePrice !== undefined ? Number(item.salePrice) : existing.salePrice,
              leadTimeDays: item.leadTimeDays !== undefined ? Number(item.leadTimeDays) : existing.leadTimeDays,
              safetyStockDays: item.safetyStockDays !== undefined ? Number(item.safetyStockDays) : existing.safetyStockDays,
              supplier: item.supplier || existing.supplier,
              category: item.category || existing.category,
            },
          });
          updated++;
        } else {
          await prisma.stockItem.create({
            data: {
              sku: item.sku, title: item.title || null,
              currentStock: Number(item.currentStock || 0),
              cost: Number(item.cost || 0), salePrice: Number(item.salePrice || 0),
              leadTimeDays: Number(item.leadTimeDays || 7),
              safetyStockDays: Number(item.safetyStockDays || 30),
              supplier: item.supplier || null, category: item.category || null,
            },
          });
          created++;
        }
      }
      return NextResponse.json({ success: true, created, updated });
    }

    // Single item
    if (!body.sku) return NextResponse.json({ error: "SKU obrigatorio" }, { status: 400 });

    const result = await prisma.stockItem.upsert({
      where: { sku: body.sku },
      update: {
        title: body.title, currentStock: Number(body.currentStock || 0),
        cost: Number(body.cost || 0), salePrice: Number(body.salePrice || 0),
        leadTimeDays: Number(body.leadTimeDays || 7),
        safetyStockDays: Number(body.safetyStockDays || 30),
        supplier: body.supplier, category: body.category,
      },
      create: {
        sku: body.sku, title: body.title,
        currentStock: Number(body.currentStock || 0),
        cost: Number(body.cost || 0), salePrice: Number(body.salePrice || 0),
        leadTimeDays: Number(body.leadTimeDays || 7),
        safetyStockDays: Number(body.safetyStockDays || 30),
        supplier: body.supplier, category: body.category,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/stock
export async function DELETE(request: NextRequest) {
  try {
    const { sku } = await request.json();
    await prisma.stockItem.delete({ where: { sku } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
