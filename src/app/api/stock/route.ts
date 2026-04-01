import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/stock - Calcula gestao de compras DIRETO das vendas (sem precisar de estoque manual)
export async function GET() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Busca TODAS as vendas dos ultimos 30 dias (exceto canceladas/devolvidas)
    const orderItems = await prisma.orderItem.findMany({
      where: {
        sku: { not: null },
        order: {
          orderDate: { gte: thirtyDaysAgo },
          status: { notIn: ["cancelled", "returned", "refunded", "CANCELLED", "RETURNED", "IN_CANCEL"] },
        },
      },
      include: {
        order: { select: { orderDate: true, platformFee: true, sellerShippingCost: true, account: { select: { platform: true, nickname: true } } } },
      },
    });

    // Busca custos e tax rate
    const productCosts = await prisma.productCost.findMany();
    const costMap: Record<string, number> = {};
    for (const pc of productCosts) costMap[pc.sku] = pc.cost;

    const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    // Busca estoque cadastrado (se existir)
    const stockItems = await prisma.stockItem.findMany();
    const stockMap: Record<string, { currentStock: number; leadTimeDays: number; safetyStockDays: number; supplier: string | null }> = {};
    for (const si of stockItems) {
      stockMap[si.sku] = { currentStock: si.currentStock, leadTimeDays: si.leadTimeDays, safetyStockDays: si.safetyStockDays, supplier: si.supplier };
    }

    // Agrupa por SKU
    const skuData: Record<string, {
      sku: string; title: string; totalSold: number; totalRevenue: number;
      totalFee: number; totalShipping: number; platforms: Set<string>;
    }> = {};

    for (const item of orderItems) {
      if (!item.sku) continue;
      if (!skuData[item.sku]) {
        skuData[item.sku] = { sku: item.sku, title: item.title, totalSold: 0, totalRevenue: 0, totalFee: 0, totalShipping: 0, platforms: new Set() };
      }
      const s = skuData[item.sku];
      s.totalSold += item.quantity;
      s.totalRevenue += item.totalPrice;
      const n = 1; // simplificado
      s.totalFee += item.order.platformFee / n;
      s.totalShipping += item.order.sellerShippingCost / n;
      s.platforms.add(item.order.account.platform);
    }

    // Calcula metricas para cada SKU
    const items = Object.values(skuData).map(s => {
      const avgDailySales = s.totalSold / 30;
      const unitCost = costMap[s.sku] || 0;
      const salePrice = s.totalSold > 0 ? s.totalRevenue / s.totalSold : 0;
      const stock = stockMap[s.sku]?.currentStock ?? 0;
      const leadTime = stockMap[s.sku]?.leadTimeDays ?? 7;
      const safetyDays = stockMap[s.sku]?.safetyStockDays ?? 30;
      const supplier = stockMap[s.sku]?.supplier || null;

      // Custos por unidade
      const taxPerUnit = salePrice * (taxRate / 100);
      const feePerUnit = s.totalSold > 0 ? s.totalFee / s.totalSold : 0;
      const shippingPerUnit = s.totalSold > 0 ? s.totalShipping / s.totalSold : 0;
      const marginPerUnit = salePrice - unitCost - taxPerUnit - feePerUnit - shippingPerUnit;
      const marginPct = salePrice > 0 ? (marginPerUnit / salePrice) * 100 : 0;

      // Ponto de reposicao e sugestao de compra
      const minStock = Math.ceil(avgDailySales * leadTime);
      const safetyStock = Math.ceil(avgDailySales * safetyDays);
      const reorderPoint = minStock + safetyStock;
      const oneMonthSales = Math.ceil(avgDailySales * 30);

      // Sugestao: sempre 1 mes de vendas quando precisa comprar
      const suggestedPurchase = (stock <= reorderPoint && avgDailySales > 0)
        ? Math.max(oneMonthSales, reorderPoint - stock) : 0;

      // Cobertura em dias
      const coverageDays = avgDailySales > 0 ? Math.floor(stock / avgDailySales) : (stock > 0 ? 999 : 0);

      // Status
      let status = "ok";
      if (stock <= 0 && avgDailySales > 0) status = "ruptura";
      else if (stock <= minStock && avgDailySales > 0) status = "critico";
      else if (stock <= reorderPoint && avgDailySales > 0) status = "comprar";

      // Capital parado
      const capitalTied = stock * unitCost;

      // Custo da compra sugerida
      const purchaseCost = suggestedPurchase * unitCost;

      return {
        sku: s.sku, title: s.title,
        totalSold: s.totalSold, avgDailySales: Math.round(avgDailySales * 100) / 100,
        salePrice: Math.round(salePrice * 100) / 100, unitCost,
        marginPerUnit: Math.round(marginPerUnit * 100) / 100,
        marginPct: Math.round(marginPct * 10) / 10,
        currentStock: stock, leadTimeDays: leadTime, safetyStockDays: safetyDays,
        minStock, reorderPoint, suggestedPurchase, oneMonthSales,
        coverageDays, status, capitalTied, purchaseCost, supplier,
        platforms: Array.from(s.platforms),
        abcClass: "", // sera calculado abaixo
      };
    }).sort((a, b) => (b.totalSold * b.salePrice) - (a.totalSold * a.salePrice));

    // Classificacao ABC
    const totalRev = items.reduce((s, i) => s + (i.totalSold * i.salePrice), 0);
    let cumRev = 0;
    for (const item of items) {
      cumRev += item.totalSold * item.salePrice;
      const pct = totalRev > 0 ? (cumRev / totalRev) * 100 : 100;
      item.abcClass = pct <= 80 ? "A" : pct <= 95 ? "B" : "C";
    }

    // Ordena: ruptura primeiro, depois critico, comprar, ok
    const statusOrder: Record<string, number> = { ruptura: 0, critico: 1, comprar: 2, ok: 3 };
    items.sort((a, b) => (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9));

    // Totais
    const totals = {
      totalSkus: items.length,
      totalStock: items.reduce((s, i) => s + i.currentStock, 0),
      totalCapital: items.reduce((s, i) => s + i.capitalTied, 0),
      totalPurchaseCost: items.reduce((s, i) => s + i.purchaseCost, 0),
      inRupture: items.filter(i => i.status === "ruptura").length,
      needPurchase: items.filter(i => i.status === "comprar" || i.status === "critico").length,
      classA: items.filter(i => i.abcClass === "A").length,
      classB: items.filter(i => i.abcClass === "B").length,
      classC: items.filter(i => i.abcClass === "C").length,
      totalSold30d: items.reduce((s, i) => s + i.totalSold, 0),
      totalSuggested: items.reduce((s, i) => s + i.suggestedPurchase, 0),
    };

    return NextResponse.json({ items, totals });
  } catch (error) {
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
