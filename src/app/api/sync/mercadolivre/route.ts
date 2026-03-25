import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getOrders,
  refreshAccessToken,
  mlApiCall,
} from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Processa um pedido individualmente - busca detalhes completos
async function processOrder(
  mlOrder: Record<string, unknown>,
  accessToken: string,
  accountId: string
) {
  const orderId = mlOrder.id as string;
  let platformFee = 0;
  let shippingCostSeller = 0;
  let shippingCostBuyer = 0;

  // Busca pedido completo via /orders/{id}
  try {
    const fullOrder = await mlApiCall(`/orders/${orderId}`, accessToken);

    // Extrai marketplace_fee e shipping_cost dos payments
    let paymentShippingCost = 0;
    if (Array.isArray(fullOrder.payments)) {
      for (const payment of fullOrder.payments) {
        if (payment.marketplace_fee != null) {
          platformFee += Math.abs(Number(payment.marketplace_fee));
        }
        // shipping_cost no payment = frete que o COMPRADOR pagou
        if (payment.shipping_cost != null) {
          paymentShippingCost += Math.abs(Number(payment.shipping_cost));
        }
      }
    }

    // Fallback: sale_fee dos items
    if (platformFee === 0 && Array.isArray(fullOrder.order_items)) {
      for (const item of fullOrder.order_items) {
        if (item.sale_fee != null) {
          platformFee += Math.abs(Number(item.sale_fee));
        }
      }
    }

    // shipping.cost do pedido = custo TOTAL do frete (comprador + vendedor)
    const totalShipping = Number(fullOrder.shipping?.cost || 0);

    // Busca frete via shipment (mais preciso)
    const shippingId = fullOrder.shipping?.id;
    let gotShipmentData = false;

    if (shippingId) {
      try {
        const shipment = await mlApiCall(`/shipments/${shippingId}`, accessToken);

        // sender_cost = frete VENDEDOR, receiver_cost = frete COMPRADOR
        if (shipment.sender_cost != null || shipment.receiver_cost != null) {
          shippingCostSeller = Math.abs(Number(shipment.sender_cost || 0));
          shippingCostBuyer = Math.abs(Number(shipment.receiver_cost || 0));
          gotShipmentData = true;
        }

        // Fallback: shipping_option
        if (!gotShipmentData && shipment.shipping_option) {
          const opt = shipment.shipping_option;
          const cost = Number(opt.cost || 0);
          const listCost = Number(opt.list_cost || 0);
          shippingCostBuyer = listCost;
          shippingCostSeller = listCost === 0 && cost > 0 ? cost : Math.max(0, cost - listCost);
          gotShipmentData = true;
        }
      } catch {
        // Shipment nao disponivel
      }
    }

    // Se nao conseguiu do shipment, calcula a partir do total e payment
    if (!gotShipmentData && totalShipping > 0) {
      // paymentShippingCost = o que o comprador pagou de frete
      shippingCostBuyer = paymentShippingCost;
      // O vendedor paga a diferenca entre o total e o que o comprador pagou
      shippingCostSeller = Math.max(0, totalShipping - paymentShippingCost);
    }
  } catch {
    // Fallback total: nao conseguiu nem o pedido completo
    const shipping = mlOrder.shipping as Record<string, unknown> | undefined;
    const totalShipping = Number(shipping?.cost || 0);
    // Sem dados suficientes, assume frete gratis pro comprador
    shippingCostSeller = totalShipping;
    shippingCostBuyer = 0;
  }

  // Dados do pedido do search
  const orderItems = (mlOrder.order_items || []) as Array<Record<string, unknown>>;
  const shipping = mlOrder.shipping as Record<string, unknown> | undefined;
  const buyer = mlOrder.buyer as Record<string, unknown> | undefined;

  // Upsert do pedido
  const savedOrder = await prisma.order.upsert({
    where: {
      accountId_platformOrderId: {
        accountId,
        platformOrderId: String(orderId),
      },
    },
    update: {
      status: mlOrder.status as string,
      totalAmount: Number(mlOrder.total_amount || 0),
      platformFee,
      sellerShippingCost: shippingCostSeller,
      shippingCost: shippingCostBuyer,
      paidDate: mlOrder.date_closed ? new Date(mlOrder.date_closed as string) : null,
    },
    create: {
      accountId,
      platformOrderId: String(orderId),
      status: mlOrder.status as string,
      totalAmount: Number(mlOrder.total_amount || 0),
      currency: (mlOrder.currency_id as string) || "BRL",
      platformFee,
      sellerShippingCost: shippingCostSeller,
      shippingCost: shippingCostBuyer,
      shippingId: shipping?.id ? String(shipping.id) : null,
      packId: mlOrder.pack_id ? String(mlOrder.pack_id) : null,
      buyerNickname: (buyer?.nickname as string) || null,
      orderDate: new Date(mlOrder.date_created as string),
      paidDate: mlOrder.date_closed ? new Date(mlOrder.date_closed as string) : null,
    },
  });

  // Salva itens do pedido
  for (const orderItem of orderItems) {
    const item = orderItem.item as Record<string, unknown>;
    if (!item) continue;

    await prisma.orderItem.upsert({
      where: { id: `${savedOrder.id}-${item.id}` },
      update: {
        quantity: Number(orderItem.quantity),
        unitPrice: Number(orderItem.unit_price),
        totalPrice: Number(orderItem.quantity) * Number(orderItem.unit_price),
      },
      create: {
        id: `${savedOrder.id}-${item.id}`,
        orderId: savedOrder.id,
        platformItemId: String(item.id),
        title: String(item.title || ""),
        quantity: Number(orderItem.quantity),
        unitPrice: Number(orderItem.unit_price),
        totalPrice: Number(orderItem.quantity) * Number(orderItem.unit_price),
        sku: (item.seller_sku as string) || null,
      },
    });
  }

  return { platformFee, shippingCostSeller, shippingCostBuyer };
}

// Processa lote de pedidos em paralelo
async function processBatch(
  orders: Record<string, unknown>[],
  accessToken: string,
  accountId: string
) {
  const results = await Promise.allSettled(
    orders.map((order) => processOrder(order, accessToken, accountId))
  );
  return results.filter((r) => r.status === "fulfilled").length;
}

// POST /api/sync/mercadolivre
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = body.accountId;

    const accounts = accountId
      ? await prisma.account.findMany({
          where: { id: accountId, platform: "MERCADO_LIVRE", isActive: true },
        })
      : await prisma.account.findMany({
          where: { platform: "MERCADO_LIVRE", isActive: true },
        });

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Nenhuma conta ML ativa" }, { status: 404 });
    }

    const results = [];

    for (const account of accounts) {
      const syncLog = await prisma.syncLog.create({
        data: { accountId: account.id, syncType: "full", status: "RUNNING" },
      });

      try {
        // Renova token se necessario
        let accessToken = account.accessToken;
        if (account.tokenExpires && account.tokenExpires < new Date()) {
          if (!account.refreshToken) throw new Error("Token expirado sem refresh_token");
          const newToken = await refreshAccessToken(account.refreshToken);
          accessToken = newToken.access_token;
          await prisma.account.update({
            where: { id: account.id },
            data: {
              accessToken: newToken.access_token,
              refreshToken: newToken.refresh_token,
              tokenExpires: new Date(Date.now() + newToken.expires_in * 1000),
            },
          });
        }

        let totalSynced = 0;
        let offset = 0;
        let hasMore = true;

        // Busca e processa pedidos em lotes de 5 (paralelo)
        while (hasMore) {
          const ordersData = await getOrders(accessToken, account.platformId, offset, 50);
          const orders = (ordersData.results || []) as Record<string, unknown>[];

          // Processa em lotes de 5 pedidos paralelos
          for (let i = 0; i < orders.length; i += 5) {
            const batch = orders.slice(i, i + 5);
            const synced = await processBatch(batch, accessToken, account.id);
            totalSynced += synced;
          }

          offset += 50;
          hasMore = offset < (ordersData.paging?.total || 0);
        }

        // Recalcula metricas diarias
        await recalculateDailyMetrics(account.id);

        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: { status: "SUCCESS", recordsSync: totalSynced, finishedAt: new Date() },
        });

        results.push({
          accountId: account.id,
          nickname: account.nickname,
          status: "success",
          recordsSynced: totalSynced,
        });
      } catch (error) {
        console.error(`Sync error:`, error);
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: {
            status: "FAILED",
            errorMsg: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          },
        });
        results.push({
          accountId: account.id,
          nickname: account.nickname,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Recalcula metricas diarias
async function recalculateDailyMetrics(accountId: string) {
  const orders = await prisma.order.findMany({
    where: { accountId, status: { not: "cancelled" } },
    include: { items: true },
  });

  const metricsByDate: Record<string, {
    revenue: number; platformFee: number; shippingCost: number;
    tax: number; discount: number; totalOrders: number; totalUnits: number;
  }> = {};

  for (const order of orders) {
    const dateKey = order.orderDate.toISOString().split("T")[0];
    if (!metricsByDate[dateKey]) {
      metricsByDate[dateKey] = {
        revenue: 0, platformFee: 0, shippingCost: 0,
        tax: 0, discount: 0, totalOrders: 0, totalUnits: 0,
      };
    }
    const m = metricsByDate[dateKey];
    m.revenue += order.totalAmount;
    m.platformFee += order.platformFee;
    m.shippingCost += order.sellerShippingCost;
    m.tax += order.taxAmount;
    m.discount += order.discount;
    m.totalOrders += 1;
    m.totalUnits += order.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  for (const [dateKey, m] of Object.entries(metricsByDate)) {
    const margin = m.revenue - m.platformFee - m.shippingCost - m.tax - m.discount;
    const avgTicket = m.totalOrders > 0 ? m.revenue / m.totalOrders : 0;

    await prisma.dailyMetric.upsert({
      where: { platform_date: { platform: "MERCADO_LIVRE", date: new Date(dateKey) } },
      update: { revenue: m.revenue, platformFee: m.platformFee, shippingCost: m.shippingCost, tax: m.tax, discount: m.discount, margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket },
      create: { platform: "MERCADO_LIVRE", date: new Date(dateKey), revenue: m.revenue, platformFee: m.platformFee, shippingCost: m.shippingCost, tax: m.tax, discount: m.discount, margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket },
    });
  }
}
