import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/orders
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const platform = searchParams.get("platform");
    const accountId = searchParams.get("accountId");
    const sku = searchParams.get("sku");
    const status = searchParams.get("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (accountId) {
      where.accountId = accountId;
    } else if (platform) {
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

    const cancelledStatuses = ["cancelled", "returned", "refunded", "devolvido", "cancelado", "CANCELLED", "RETURNED", "IN_CANCEL"];

    if (status && status !== "Todos") {
      where.status = status;
    } else {
      where.status = { notIn: cancelledStatuses };
    }

    if (sku) {
      where.items = { some: { sku: { contains: sku } } };
    }

    // Queries em PARALELO: orders + taxRate + productCosts + returns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnWhere: any = {};
    if (accountId) returnWhere.accountId = accountId;
    else if (platform) returnWhere.account = { platform };
    if (from || to) {
      returnWhere.orderDate = {};
      if (from) returnWhere.orderDate.gte = new Date(from);
      if (to) { const td = new Date(to); td.setHours(23, 59, 59, 999); returnWhere.orderDate.lte = td; }
    }
    returnWhere.status = { in: cancelledStatuses };

    const [orders, taxSetting, productCosts, returnedOrders] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          account: { select: { platform: true } },
          items: {
            select: {
              id: true, platformItemId: true, title: true,
              quantity: true, unitPrice: true, totalPrice: true, sku: true,
            },
          },
        },
        orderBy: { orderDate: "desc" },
        take: 500,
      }),
      prisma.setting.findUnique({ where: { key: "tax_rate" } }),
      prisma.productCost.findMany({ select: { sku: true, cost: true } }),
      prisma.order.findMany({
        where: returnWhere,
        select: {
          platformOrderId: true, status: true, totalAmount: true, orderDate: true,
          items: { select: { title: true, sku: true, quantity: true, unitPrice: true } },
        },
        orderBy: { orderDate: "desc" },
        take: 50,
      }),
    ]);

    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

    const costMap: Record<string, number> = {};
    for (const pc of productCosts) {
      costMap[pc.sku] = pc.cost;
    }

    // Enriquece pedidos com campos calculados
    const enrichedOrders = orders.map((order) => {
      let totalProductCost = 0;
      const enrichedItems = order.items.map((item) => {
        const unitCost = item.sku ? (costMap[item.sku] || 0) : 0;
        const itemCost = unitCost * item.quantity;
        totalProductCost += itemCost;
        return { ...item, unitCost, totalCost: itemCost, hasCost: unitCost > 0 };
      });

      const taxAmount = order.totalAmount * (taxRate / 100);
      const margin = order.totalAmount - totalProductCost - taxAmount - order.platformFee - order.sellerShippingCost - order.discount;
      const marginPercent = order.totalAmount > 0 ? (margin / order.totalAmount) * 100 : 0;

      return {
        id: order.id,
        platformOrderId: order.platformOrderId,
        status: order.status,
        totalAmount: order.totalAmount,
        platformFee: order.platformFee,
        sellerShippingCost: order.sellerShippingCost,
        shippingCost: order.shippingCost,
        discount: order.discount,
        orderDate: order.orderDate,
        buyerNickname: order.buyerNickname,
        account: order.account,
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
      returns: {
        count: returnedOrders.length,
        totalAmount: returnedOrders.reduce((s, o) => s + o.totalAmount, 0),
        orders: returnedOrders,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
