import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrders, refreshAccessToken, mlApiCall } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
//  SYNC MERCADO LIVRE — Arquitetura incremental
//
//  Estrategia:
//  1. Busca data do ultimo sync com sucesso
//  2. Filtra apenas pedidos novos/atualizados desde entao
//  3. Extrai fees do payment (sem chamar /shipments)
//  4. Processa em lotes de 10 paralelos
//  5. Recalcula metricas diarias com custo+imposto reais
// ============================================================

// Extrai dados financeiros do pedido completo (1 API call por pedido)
async function extractOrderFinancials(orderId: string, accessToken: string) {
  let platformFee = 0;
  let shippingCostSeller = 0;
  let shippingCostBuyer = 0;

  try {
    const fullOrder = await mlApiCall(`/orders/${orderId}`, accessToken);

    // 1. Extrai marketplace_fee dos payments
    if (Array.isArray(fullOrder.payments)) {
      let buyerShippingFromPayment = 0;

      for (const payment of fullOrder.payments) {
        if (payment.marketplace_fee != null) {
          platformFee += Math.abs(Number(payment.marketplace_fee));
        }
        const totalPaid = Number(payment.total_paid_amount || 0);
        const transactionAmt = Number(payment.transaction_amount || 0);
        if (totalPaid > transactionAmt) {
          buyerShippingFromPayment += totalPaid - transactionAmt;
        }
      }

      // 2. Fallback: sale_fee dos items
      if (platformFee === 0 && Array.isArray(fullOrder.order_items)) {
        for (const item of fullOrder.order_items) {
          if (item.sale_fee != null) {
            platformFee += Math.abs(Number(item.sale_fee));
          }
        }
      }

      // 3. Frete via shipping.cost (sem chamar /shipments — economia de 1 API call)
      const totalShipping = Number(fullOrder.shipping?.cost || 0);
      if (totalShipping > 0) {
        shippingCostBuyer = buyerShippingFromPayment;
        shippingCostSeller = Math.max(0, totalShipping - buyerShippingFromPayment);
      }
    }
  } catch {
    // Se falhar, continua com zeros — melhor do que travar o sync
  }

  return { platformFee, shippingCostSeller, shippingCostBuyer };
}

// Processa e salva um pedido no banco
async function syncOrder(
  mlOrder: Record<string, unknown>,
  accessToken: string,
  accountId: string
) {
  const orderId = String(mlOrder.id);
  const orderItems = (mlOrder.order_items || []) as Array<Record<string, unknown>>;
  const shipping = mlOrder.shipping as Record<string, unknown> | undefined;
  const buyer = mlOrder.buyer as Record<string, unknown> | undefined;

  // Busca detalhes financeiros (1 API call)
  const { platformFee, shippingCostSeller, shippingCostBuyer } =
    await extractOrderFinancials(orderId, accessToken);

  // Upsert do pedido
  const savedOrder = await prisma.order.upsert({
    where: {
      accountId_platformOrderId: { accountId, platformOrderId: orderId },
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
      platformOrderId: orderId,
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

  return savedOrder;
}

// Processa lote de pedidos em paralelo
async function processBatch(
  orders: Record<string, unknown>[],
  accessToken: string,
  accountId: string
): Promise<number> {
  const results = await Promise.allSettled(
    orders.map((order) => syncOrder(order, accessToken, accountId))
  );
  return results.filter((r) => r.status === "fulfilled").length;
}

// POST /api/sync/mercadolivre
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetAccountId = body.accountId;

    const accounts = await prisma.account.findMany({
      where: {
        platform: "MERCADO_LIVRE",
        isActive: true,
        ...(targetAccountId ? { id: targetAccountId } : {}),
      },
    });

    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma conta ML ativa encontrada. Configure em Contas." },
        { status: 404 }
      );
    }

    const results = [];

    for (const account of accounts) {
      const syncLog = await prisma.syncLog.create({
        data: { accountId: account.id, syncType: "incremental", status: "RUNNING" },
      });

      try {
        // 1. Renova token antes de sincronizar
        let accessToken = account.accessToken;
        if (account.refreshToken) {
          try {
            const newToken = await refreshAccessToken(account.refreshToken);
            accessToken = newToken.access_token as string;
            await prisma.account.update({
              where: { id: account.id },
              data: {
                accessToken: newToken.access_token as string,
                refreshToken: (newToken.refresh_token as string) || account.refreshToken,
                tokenExpires: new Date(
                  Date.now() + ((newToken.expires_in as number) || 21600) * 1000
                ),
              },
            });
          } catch (refreshError) {
            console.warn(`Token refresh failed for ${account.id}:`, refreshError);
          }
        }

        // 2. Determina data de inicio — ultimo sync com sucesso ou 90 dias atras
        const lastSuccessSync = await prisma.syncLog.findFirst({
          where: { accountId: account.id, status: "SUCCESS" },
          orderBy: { startedAt: "desc" },
        });

        const syncFromDate = lastSuccessSync?.startedAt
          ? new Date(lastSuccessSync.startedAt.getTime() - 2 * 24 * 60 * 60 * 1000) // 2 dias antes do ultimo sync (overlap de seguranca)
          : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Primeira vez: 90 dias

        const dateFrom = syncFromDate.toISOString();

        // 3. Busca e processa pedidos em lotes (com cutoff de tempo para nao estourar Vercel 60s)
        let totalSynced = 0;
        let offset = 0;
        let hasMore = true;
        let timedOut = false;
        const BATCH_SIZE = 5;
        const MAX_ORDERS = 200;
        const startTime = Date.now();
        const TIME_LIMIT_MS = 45000; // 45s — margem de 15s para recalcular metricas e responder

        while (hasMore && totalSynced < MAX_ORDERS) {
          if (Date.now() - startTime > TIME_LIMIT_MS) {
            timedOut = true;
            break;
          }

          const ordersData = await getOrders(
            accessToken,
            account.platformId,
            offset,
            50,
            dateFrom
          );
          const orders = (ordersData.results || []) as Record<string, unknown>[];

          if (orders.length === 0) break;

          // Processa em lotes paralelos de 5
          for (let i = 0; i < orders.length; i += BATCH_SIZE) {
            if (Date.now() - startTime > TIME_LIMIT_MS) {
              timedOut = true;
              break;
            }
            const batch = orders.slice(i, i + BATCH_SIZE);
            totalSynced += await processBatch(batch, accessToken, account.id);
          }

          if (timedOut) break;
          offset += 50;
          hasMore = offset < (ordersData.paging?.total || 0);
        }

        // 4. Recalcula metricas diarias
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
          partial: timedOut,
        });
      } catch (error) {
        console.error(`Sync error for ${account.id}:`, error);
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Recalcula metricas diarias com custo de produto e imposto reais
async function recalculateDailyMetrics(accountId: string) {
  // Apenas ultimos 120 dias (nao recalcula historico inteiro)
  const sinceDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

  // Queries em paralelo
  const [orders, taxSetting, productCosts] = await Promise.all([
    prisma.order.findMany({
      where: {
        accountId,
        orderDate: { gte: sinceDate },
        status: {
          notIn: [
            "cancelled", "returned", "refunded",
            "devolvido", "cancelado",
            "CANCELLED", "RETURNED", "IN_CANCEL",
          ],
        },
      },
      include: { items: { select: { sku: true, quantity: true } } },
    }),
    prisma.setting.findUnique({ where: { key: "tax_rate" } }),
    prisma.productCost.findMany({ select: { sku: true, cost: true } }),
  ]);

  const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

  const costMap: Record<string, number> = {};
  for (const pc of productCosts) {
    costMap[pc.sku] = pc.cost;
  }

  // Agrega por data
  const metricsByDate: Record<
    string,
    {
      revenue: number; cost: number; platformFee: number;
      shippingCost: number; tax: number; discount: number;
      totalOrders: number; totalUnits: number;
    }
  > = {};

  for (const order of orders) {
    const dateKey = order.orderDate.toISOString().split("T")[0];
    if (!metricsByDate[dateKey]) {
      metricsByDate[dateKey] = {
        revenue: 0, cost: 0, platformFee: 0,
        shippingCost: 0, tax: 0, discount: 0,
        totalOrders: 0, totalUnits: 0,
      };
    }
    const m = metricsByDate[dateKey];
    m.revenue += order.totalAmount;
    m.platformFee += order.platformFee;
    m.shippingCost += order.sellerShippingCost;
    m.tax += order.totalAmount * (taxRate / 100);
    m.discount += order.discount;
    m.totalOrders += 1;

    for (const item of order.items) {
      const unitCost = item.sku ? (costMap[item.sku] || 0) : 0;
      m.cost += unitCost * item.quantity;
      m.totalUnits += item.quantity;
    }
  }

  // Upsert em lotes paralelos de 10
  const entries = Object.entries(metricsByDate);
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10);
    await Promise.all(
      batch.map(([dateKey, m]) => {
        const margin = m.revenue - m.cost - m.platformFee - m.shippingCost - m.tax - m.discount;
        const avgTicket = m.totalOrders > 0 ? m.revenue / m.totalOrders : 0;
        return prisma.dailyMetric.upsert({
          where: {
            platform_date: { platform: "MERCADO_LIVRE", date: new Date(dateKey) },
          },
          update: {
            revenue: m.revenue, cost: m.cost, platformFee: m.platformFee,
            shippingCost: m.shippingCost, tax: m.tax, discount: m.discount,
            margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket,
          },
          create: {
            platform: "MERCADO_LIVRE", date: new Date(dateKey),
            revenue: m.revenue, cost: m.cost, platformFee: m.platformFee,
            shippingCost: m.shippingCost, tax: m.tax, discount: m.discount,
            margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket,
          },
        });
      })
    );
  }
}
