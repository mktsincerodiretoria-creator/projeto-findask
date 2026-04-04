import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  refreshShopeeToken,
  getShopeeOrders,
  getShopeeOrderDetails,
  // getShopeeOrderIncome, // nao mais necessario - usa order_income do get_order_detail
} from "@/lib/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/sync/shopee
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = body.accountId;

    const accounts = accountId
      ? await prisma.account.findMany({ where: { id: accountId, platform: "SHOPEE", isActive: true } })
      : await prisma.account.findMany({ where: { platform: "SHOPEE", isActive: true } });

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Nenhuma conta Shopee ativa" }, { status: 404 });
    }

    const results = [];

    for (const account of accounts) {
      const syncLog = await prisma.syncLog.create({
        data: { accountId: account.id, syncType: "full", status: "RUNNING" },
      });

      try {
        let accessToken = account.accessToken;
        const shopId = Number(account.platformId);

        // Renova token se expirado ou proximo de expirar (5 min de margem)
        const tokenMargin = 5 * 60 * 1000; // 5 minutos
        if (!account.tokenExpires || account.tokenExpires < new Date(Date.now() + tokenMargin)) {
          if (!account.refreshToken) throw new Error("Token expirado sem refresh_token");
          const newToken = await refreshShopeeToken(account.refreshToken, shopId);
          accessToken = newToken.access_token;
          await prisma.account.update({
            where: { id: account.id },
            data: {
              accessToken: newToken.access_token,
              refreshToken: newToken.refresh_token,
              tokenExpires: new Date(Date.now() + (newToken.expire_in || 14400) * 1000),
            },
          });
        }

        let totalSynced = 0;

        // Busca pedidos dos ultimos 15 dias
        // FIX: usa update_time + COMPLETED para pegar pedidos CONCLUIDOS no periodo
        // (create_time pegava pedidos CRIADOS, incluindo nao-concluidos = contagem inflada)
        const timeTo = Math.floor(Date.now() / 1000);
        const timeFrom = timeTo - 15 * 24 * 60 * 60;
        let cursor = "";
        let hasMore = true;
        const maxOrders = 200;

        while (hasMore && totalSynced < maxOrders) {
          const ordersData = await getShopeeOrders(accessToken, shopId, timeFrom, timeTo, cursor, 20, "update_time", "COMPLETED");
          const orderList = ordersData.response?.order_list || [];

          if (orderList.length === 0) break;

          // Busca detalhes em lotes de 50
          const orderSns = orderList.map((o: { order_sn: string }) => o.order_sn);

          for (let i = 0; i < orderSns.length; i += 50) {
            const batch = orderSns.slice(i, i + 50);
            const detailsData = await getShopeeOrderDetails(accessToken, shopId, batch);
            const orderDetails = detailsData.response?.order_list || [];

            for (const order of orderDetails) {
              // Pular pedidos que nao sao COMPLETED (double-check)
              if (order.order_status && order.order_status !== "COMPLETED") continue;

              let platformFee = 0;
              let shippingCostSeller = 0;
              let shippingCostBuyer = 0;
              // order_income = fonte oficial de dados financeiros da Shopee
              const income = order.order_income;
              if (income) {
                // TODAS as taxas (nao apenas 3)
                platformFee = Math.abs(Number(income.commission_fee || 0))
                  + Math.abs(Number(income.service_fee || 0))
                  + Math.abs(Number(income.seller_transaction_fee || income.transaction_fee || 0))
                  + Math.abs(Number(income.affiliate_commission || 0))
                  + Math.abs(Number(income.credit_card_promotion || 0))
                  + Math.abs(Number(income.final_product_protection || 0))
                  + Math.abs(Number(income.drc_adjustable_refund || 0))
                  + Math.abs(Number(income.escrow_tax || 0));
                shippingCostSeller = Math.abs(Number(income.actual_shipping_fee || income.final_shipping_fee || 0));
                shippingCostBuyer = Math.abs(Number(income.buyer_paid_shipping_fee || 0));
              } else {
                // SEM order_income: estima frete, mas NAO inventa taxa de 12%
                // Melhor ter R$0 de taxa (e alertar) do que um valor falso
                shippingCostBuyer = Math.abs(Number(order.estimated_shipping_fee || order.actual_shipping_fee || 0));
                platformFee = 0; // Sera atualizado quando order_income ficar disponivel
                console.warn(`⚠️ Shopee order ${order.order_sn}: sem order_income — taxas zeradas`);
              }

              // FIX: Receita = soma dos itens (SEM frete comprador)
              // total_amount inclui frete+taxas do comprador = infla faturamento
              let revenueFromItems = 0;
              if (Array.isArray(order.item_list)) {
                for (const item of order.item_list) {
                  const price = Number(item.model_discounted_price || item.model_original_price || 0);
                  const qty = Number(item.model_quantity_purchased || item.quantity || 1);
                  revenueFromItems += price * qty;
                }
              }
              // Usa item prices quando disponivel, senao total_amount como fallback
              const totalAmount = revenueFromItems > 0 ? revenueFromItems : Number(order.total_amount || 0);

              // Upsert do pedido
              const savedOrder = await prisma.order.upsert({
                where: {
                  accountId_platformOrderId: {
                    accountId: account.id,
                    platformOrderId: String(order.order_sn),
                  },
                },
                update: {
                  status: order.order_status || "COMPLETED",
                  totalAmount,
                  platformFee,
                  sellerShippingCost: Math.max(0, shippingCostSeller),
                  shippingCost: shippingCostBuyer,
                  paidDate: order.pay_time ? new Date(order.pay_time * 1000) : null,
                },
                create: {
                  accountId: account.id,
                  platformOrderId: String(order.order_sn),
                  status: order.order_status || "COMPLETED",
                  totalAmount,
                  currency: "BRL",
                  platformFee,
                  sellerShippingCost: Math.max(0, shippingCostSeller),
                  shippingCost: shippingCostBuyer,
                  buyerNickname: order.buyer_username || null,
                  orderDate: new Date((order.create_time || order.pay_time || timeTo) * 1000),
                  paidDate: order.pay_time ? new Date(order.pay_time * 1000) : null,
                },
              });

              // Salva itens
              if (Array.isArray(order.item_list)) {
                for (const item of order.item_list) {
                  const itemId = `${savedOrder.id}-${item.item_id}-${item.model_id || 0}`;
                  await prisma.orderItem.upsert({
                    where: { id: itemId },
                    update: {
                      quantity: Number(item.model_quantity_purchased || item.quantity || 1),
                      unitPrice: Number(item.model_discounted_price || item.model_original_price || 0),
                      totalPrice: Number(item.model_discounted_price || item.model_original_price || 0) * Number(item.model_quantity_purchased || item.quantity || 1),
                    },
                    create: {
                      id: itemId,
                      orderId: savedOrder.id,
                      platformItemId: String(item.item_id),
                      title: item.item_name || "",
                      quantity: Number(item.model_quantity_purchased || item.quantity || 1),
                      unitPrice: Number(item.model_discounted_price || item.model_original_price || 0),
                      totalPrice: Number(item.model_discounted_price || item.model_original_price || 0) * Number(item.model_quantity_purchased || item.quantity || 1),
                      sku: item.item_sku || item.model_sku || null,
                    },
                  });
                }
              }

              totalSynced++;
            }

            // Rate limiting
            await new Promise((r) => setTimeout(r, 100));
          }

          cursor = ordersData.response?.next_cursor || "";
          hasMore = ordersData.response?.more || false;
        }

        // Recalcula metricas diarias da Shopee (igual ao ML)
        await recalculateShopeeMetrics(account.id);

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
        console.error("Shopee sync error:", error);
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: { status: "FAILED", errorMsg: String(error), finishedAt: new Date() },
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

// Recalcula metricas diarias da Shopee (mesmo padrao do ML)
async function recalculateShopeeMetrics(accountId: string) {
  const orders = await prisma.order.findMany({
    where: {
      accountId,
      status: { in: ["COMPLETED"] },
    },
    include: { items: true },
  });

  const taxSetting = await prisma.setting.findUnique({ where: { key: "tax_rate" } });
  const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0;

  const productCosts = await prisma.productCost.findMany();
  const costMap: Record<string, number> = {};
  for (const pc of productCosts) costMap[pc.sku] = pc.cost;

  const metricsByDate: Record<string, {
    revenue: number; cost: number; platformFee: number;
    shippingCost: number; tax: number; discount: number;
    totalOrders: number; totalUnits: number;
  }> = {};

  for (const order of orders) {
    const dateKey = order.orderDate.toISOString().split("T")[0];
    if (!metricsByDate[dateKey]) {
      metricsByDate[dateKey] = { revenue: 0, cost: 0, platformFee: 0, shippingCost: 0, tax: 0, discount: 0, totalOrders: 0, totalUnits: 0 };
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

  for (const [dateKey, m] of Object.entries(metricsByDate)) {
    const margin = m.revenue - m.cost - m.platformFee - m.shippingCost - m.tax - m.discount;
    const avgTicket = m.totalOrders > 0 ? m.revenue / m.totalOrders : 0;

    await prisma.dailyMetric.upsert({
      where: { platform_date: { platform: "SHOPEE", date: new Date(dateKey) } },
      update: {
        revenue: m.revenue, cost: m.cost, platformFee: m.platformFee,
        shippingCost: m.shippingCost, tax: m.tax, discount: m.discount,
        margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket,
      },
      create: {
        platform: "SHOPEE", date: new Date(dateKey),
        revenue: m.revenue, cost: m.cost, platformFee: m.platformFee,
        shippingCost: m.shippingCost, tax: m.tax, discount: m.discount,
        margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket,
      },
    });
  }
}
