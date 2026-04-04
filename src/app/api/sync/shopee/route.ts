import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  refreshShopeeToken,
  getShopeeOrders,
  getShopeeOrderDetails,
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

        // Renova token se expirado ou proximo de expirar
        if (!account.tokenExpires || account.tokenExpires < new Date(Date.now() + 5 * 60 * 1000)) {
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

        // ======================================================
        // FASE 1: Coletar todos os order_sn COMPLETED (rapido)
        // ======================================================
        const timeTo = Math.floor(Date.now() / 1000);
        const timeFrom = timeTo - 15 * 24 * 60 * 60;
        const allOrderSns: string[] = [];
        let cursor = "";
        let hasMore = true;

        while (hasMore && allOrderSns.length < 100) {
          const ordersData = await getShopeeOrders(
            accessToken, shopId, timeFrom, timeTo, cursor, 50,
            "update_time", "COMPLETED"
          );
          const orderList = ordersData.response?.order_list || [];
          if (orderList.length === 0) break;

          for (const o of orderList) allOrderSns.push(o.order_sn);
          cursor = ordersData.response?.next_cursor || "";
          hasMore = ordersData.response?.more || false;
        }

        // Deduplicar
        const uniqueSns = [...new Set(allOrderSns)];

        if (uniqueSns.length === 0) {
          await prisma.syncLog.update({
            where: { id: syncLog.id },
            data: { status: "SUCCESS", recordsSync: 0, finishedAt: new Date() },
          });
          results.push({ accountId: account.id, nickname: account.nickname, status: "success", recordsSynced: 0 });
          continue;
        }

        // ======================================================
        // FASE 2: Buscar detalhes em lotes de 50 (1-2 chamadas API)
        // ======================================================
        const allDetails: Record<string, unknown>[] = [];
        for (let i = 0; i < uniqueSns.length; i += 50) {
          const batch = uniqueSns.slice(i, i + 50);
          const detailsData = await getShopeeOrderDetails(accessToken, shopId, batch);
          const details = detailsData.response?.order_list || [];
          allDetails.push(...details);
        }

        // ======================================================
        // FASE 3: Processar e salvar pedidos
        // ======================================================
        let totalSynced = 0;
        let ordersWithIncome = 0;
        let ordersWithoutIncome = 0;

        for (const order of allDetails) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const o = order as any;
          if (o.order_status && o.order_status !== "COMPLETED") continue;

          let platformFee = 0;
          let shippingCostSeller = 0;
          let shippingCostBuyer = 0;

          const income = o.order_income;
          if (income) {
            ordersWithIncome++;
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
            ordersWithoutIncome++;
            shippingCostBuyer = Math.abs(Number(o.estimated_shipping_fee || o.actual_shipping_fee || 0));
            platformFee = 0;
          }

          // Receita = soma dos itens (sem frete comprador)
          let revenueFromItems = 0;
          if (Array.isArray(o.item_list)) {
            for (const item of o.item_list) {
              const price = Number(item.model_discounted_price || item.model_original_price || 0);
              const qty = Number(item.model_quantity_purchased || item.quantity || 1);
              revenueFromItems += price * qty;
            }
          }
          const totalAmount = revenueFromItems > 0 ? revenueFromItems : Number(o.total_amount || 0);

          const savedOrder = await prisma.order.upsert({
            where: {
              accountId_platformOrderId: {
                accountId: account.id,
                platformOrderId: String(o.order_sn),
              },
            },
            update: {
              status: "COMPLETED",
              totalAmount,
              platformFee,
              sellerShippingCost: Math.max(0, shippingCostSeller),
              shippingCost: shippingCostBuyer,
              paidDate: o.pay_time ? new Date(o.pay_time * 1000) : null,
            },
            create: {
              accountId: account.id,
              platformOrderId: String(o.order_sn),
              status: "COMPLETED",
              totalAmount,
              currency: "BRL",
              platformFee,
              sellerShippingCost: Math.max(0, shippingCostSeller),
              shippingCost: shippingCostBuyer,
              buyerNickname: o.buyer_username || null,
              orderDate: new Date((o.create_time || o.pay_time || timeTo) * 1000),
              paidDate: o.pay_time ? new Date(o.pay_time * 1000) : null,
            },
          });

          // Salva itens — deletar antigos e recriar (mais rapido que upsert individual)
          if (Array.isArray(o.item_list)) {
            await prisma.orderItem.deleteMany({ where: { orderId: savedOrder.id } });
            await prisma.orderItem.createMany({
              data: o.item_list.map((item: Record<string, unknown>) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const it = item as any;
                const qty = Number(it.model_quantity_purchased || it.quantity || 1);
                const price = Number(it.model_discounted_price || it.model_original_price || 0);
                return {
                  id: `${savedOrder.id}-${it.item_id}-${it.model_id || 0}`,
                  orderId: savedOrder.id,
                  platformItemId: String(it.item_id),
                  title: it.item_name || "",
                  quantity: qty,
                  unitPrice: price,
                  totalPrice: price * qty,
                  sku: it.item_sku || it.model_sku || null,
                };
              }),
              skipDuplicates: true,
            });
          }

          totalSynced++;
        }

        // ======================================================
        // FASE 4: Recalcular metricas diarias
        // ======================================================
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
          withIncome: ordersWithIncome,
          withoutIncome: ordersWithoutIncome,
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

// Recalcula metricas diarias da Shopee
async function recalculateShopeeMetrics(accountId: string) {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "COMPLETED" },
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

  // Limpar metricas antigas da Shopee e recriar
  await prisma.dailyMetric.deleteMany({ where: { platform: "SHOPEE" } });

  for (const [dateKey, m] of Object.entries(metricsByDate)) {
    const margin = m.revenue - m.cost - m.platformFee - m.shippingCost - m.tax - m.discount;
    const avgTicket = m.totalOrders > 0 ? m.revenue / m.totalOrders : 0;

    await prisma.dailyMetric.create({
      data: {
        platform: "SHOPEE", date: new Date(dateKey),
        revenue: m.revenue, cost: m.cost, platformFee: m.platformFee,
        shippingCost: m.shippingCost, tax: m.tax, discount: m.discount,
        margin, totalOrders: m.totalOrders, totalUnits: m.totalUnits, avgTicket,
      },
    });
  }
}
