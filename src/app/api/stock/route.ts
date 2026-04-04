import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/stock - Gestao de Compras baseada exclusivamente em vendas dos ultimos 30 dias
export async function GET() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Busca TODAS as vendas dos ultimos 30 dias via API (exceto canceladas/devolvidas)
    const orderItems = await prisma.orderItem.findMany({
      where: {
        sku: { not: null },
        order: {
          orderDate: { gte: thirtyDaysAgo },
          status: { notIn: ["cancelled", "returned", "refunded", "CANCELLED", "RETURNED", "IN_CANCEL"] },
        },
      },
      include: {
        order: {
          select: {
            id: true,
            orderDate: true,
            totalAmount: true,
            platformFee: true,
            sellerShippingCost: true,
            account: { select: { platform: true, nickname: true } },
            _count: { select: { items: true } },
          },
        },
      },
    });

    // Busca custos da tabela custo/SKU
    const productCosts = await prisma.productCost.findMany();
    const costMap: Record<string, number> = {};
    for (const pc of productCosts) costMap[pc.sku] = pc.cost;

    // Busca tax rate
    const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    // Agrupa vendas por SKU
    const skuData: Record<string, {
      sku: string; title: string; totalSold: number; totalRevenue: number;
      totalFee: number; totalShipping: number; platforms: Set<string>;
    }> = {};

    for (const item of orderItems) {
      if (!item.sku) continue;
      if (!skuData[item.sku]) {
        skuData[item.sku] = {
          sku: item.sku, title: item.title,
          totalSold: 0, totalRevenue: 0, totalFee: 0, totalShipping: 0,
          platforms: new Set(),
        };
      }
      const s = skuData[item.sku];
      s.totalSold += item.quantity;
      s.totalRevenue += item.totalPrice;
      const itemsInOrder = item.order._count.items || 1;
      s.totalFee += item.order.platformFee / itemsInOrder;
      s.totalShipping += item.order.sellerShippingCost / itemsInOrder;
      s.platforms.add(item.order.account.platform);
    }

    // Calcula metricas para cada SKU - baseado EXCLUSIVAMENTE em vendas 30d
    const items = Object.values(skuData).map(s => {
      // Custo do SKU (da tabela custo/SKU)
      const unitCost = costMap[s.sku] || 0;

      // Preco medio de venda
      const salePrice = s.totalSold > 0 ? s.totalRevenue / s.totalSold : 0;

      // === MEDIAS DE DEMANDA ===
      const avgDaily = s.totalSold / 30;
      const avgWeekly = avgDaily * 7;
      const avgBiweekly = avgDaily * 15;
      const avgMonthly = s.totalSold; // total vendido = media mensal

      // === SUGESTAO DE COMPRA = media mensal (30 dias) ===
      const suggestedPurchase = Math.ceil(avgMonthly);

      // === CAPITAL DE COMPRA = Sugestao × Custo SKU ===
      const purchaseCost = suggestedPurchase * unitCost;

      // === MARGEM ESTIMADA = (Preco Venda - Custo) × Sugestao ===
      const marginPerUnit = salePrice - unitCost;
      const marginPct = salePrice > 0 ? (marginPerUnit / salePrice) * 100 : 0;
      const marginEstimated = marginPerUnit * suggestedPurchase;

      // Faturamento 30d (para ABC)
      const revenue30d = s.totalRevenue;

      return {
        sku: s.sku,
        title: s.title,
        totalSold: s.totalSold,
        avgDaily: Math.round(avgDaily * 100) / 100,
        avgWeekly: Math.round(avgWeekly * 100) / 100,
        avgBiweekly: Math.round(avgBiweekly * 100) / 100,
        avgMonthly: Math.round(avgMonthly * 100) / 100,
        suggestedPurchase,
        unitCost,
        purchaseCost: Math.round(purchaseCost * 100) / 100,
        salePrice: Math.round(salePrice * 100) / 100,
        marginPerUnit: Math.round(marginPerUnit * 100) / 100,
        marginPct: Math.round(marginPct * 10) / 10,
        marginEstimated: Math.round(marginEstimated * 100) / 100,
        revenue30d: Math.round(revenue30d * 100) / 100,
        platforms: Array.from(s.platforms),
        abcClass: "",
      };
    }).sort((a, b) => b.revenue30d - a.revenue30d);

    // === CLASSIFICACAO ABC por faturamento 30d ===
    const totalRev = items.reduce((s, i) => s + i.revenue30d, 0);
    let cumRev = 0;
    for (const item of items) {
      cumRev += item.revenue30d;
      const pct = totalRev > 0 ? (cumRev / totalRev) * 100 : 100;
      item.abcClass = pct <= 80 ? "A" : pct <= 95 ? "B" : "C";
    }

    // Ordena por faturamento decrescente (A primeiro)
    items.sort((a, b) => b.revenue30d - a.revenue30d);

    // Totais
    const totals = {
      totalSkus: items.length,
      totalSold30d: items.reduce((s, i) => s + i.totalSold, 0),
      totalSuggested: items.reduce((s, i) => s + i.suggestedPurchase, 0),
      totalPurchaseCost: Math.round(items.reduce((s, i) => s + i.purchaseCost, 0) * 100) / 100,
      totalMarginEstimated: Math.round(items.reduce((s, i) => s + i.marginEstimated, 0) * 100) / 100,
      totalRevenue30d: Math.round(totalRev * 100) / 100,
      classA: items.filter(i => i.abcClass === "A").length,
      classB: items.filter(i => i.abcClass === "B").length,
      classC: items.filter(i => i.abcClass === "C").length,
    };

    return NextResponse.json({ items, totals });
  } catch (error) {
    console.error("Stock API error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/stock - Criar ou atualizar estoque de um SKU
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (Array.isArray(body)) {
      let created = 0, updated = 0;
      for (const item of body) {
        if (!item.sku) continue;
        const existing = await prisma.stockItem.findUnique({ where: { sku: item.sku } });
        if (existing) {
          await prisma.stockItem.update({
            where: { sku: item.sku },
            data: {
              currentStock: item.currentStock !== undefined ? Number(item.currentStock) : existing.currentStock,
              cost: item.cost !== undefined ? Number(item.cost) : existing.cost,
              leadTimeDays: item.leadTimeDays !== undefined ? Number(item.leadTimeDays) : existing.leadTimeDays,
              safetyStockDays: item.safetyStockDays !== undefined ? Number(item.safetyStockDays) : existing.safetyStockDays,
              supplier: item.supplier || existing.supplier,
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
              supplier: item.supplier || null,
            },
          });
          created++;
        }
      }
      return NextResponse.json({ success: true, created, updated });
    }

    if (!body.sku) return NextResponse.json({ error: "SKU obrigatorio" }, { status: 400 });

    await prisma.stockItem.upsert({
      where: { sku: body.sku },
      update: {
        currentStock: Number(body.currentStock || 0),
        cost: Number(body.cost || 0),
        leadTimeDays: Number(body.leadTimeDays || 7),
        safetyStockDays: Number(body.safetyStockDays || 30),
        supplier: body.supplier,
      },
      create: {
        sku: body.sku, title: body.title,
        currentStock: Number(body.currentStock || 0),
        cost: Number(body.cost || 0), salePrice: Number(body.salePrice || 0),
        leadTimeDays: Number(body.leadTimeDays || 7),
        safetyStockDays: Number(body.safetyStockDays || 30),
        supplier: body.supplier,
      },
    });

    return NextResponse.json({ success: true });
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
