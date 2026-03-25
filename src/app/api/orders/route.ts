import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/orders - List orders with details
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const platform = searchParams.get("platform");
    const sku = searchParams.get("sku");
    const status = searchParams.get("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (platform) {
      where.account = { platform };
    }

    if (from || to) {
      where.orderDate = {};
      if (from) where.orderDate.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.orderDate.lte = toDate;
      }
    }

    if (status && status !== "Todos") {
      where.status = status;
    }

    if (sku) {
      where.items = { some: { sku: { contains: sku } } };
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: true,
        account: { select: { platform: true, nickname: true } },
      },
      orderBy: { orderDate: "desc" },
      take: 200,
    });

    // Get tax rate from settings
    const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    // Get all product costs
    const productCosts = await prisma.productCost.findMany();
    const costMap: Record<string, number> = {};
    for (const pc of productCosts) {
      costMap[pc.sku] = pc.cost;
    }

    // Enrich orders with calculated fields
    const enrichedOrders = orders.map((order) => {
      let totalProductCost = 0;
      const enrichedItems = order.items.map((item) => {
        const unitCost = item.sku ? (costMap[item.sku] || 0) : 0;
        const itemCost = unitCost * item.quantity;
        totalProductCost += itemCost;
        return {
          ...item,
          unitCost,
          totalCost: itemCost,
          hasCost: unitCost > 0,
        };
      });

      const taxAmount = order.totalAmount * (taxRate / 100);
      const margin = order.totalAmount - totalProductCost - taxAmount - order.platformFee - order.sellerShippingCost - order.discount;
      const marginPercent = order.totalAmount > 0 ? (margin / order.totalAmount) * 100 : 0;

      return {
        ...order,
        items: enrichedItems,
        productCost: totalProductCost,
        calculatedTax: taxAmount,
        taxRate,
        margin,
        marginPercent,
      };
    });

    return NextResponse.json({
      orders: enrichedOrders,
      total: enrichedOrders.length,
      taxRate,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
