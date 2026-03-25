import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getOrders,
  getSellerItems,
  getItemDetails,
  refreshAccessToken,
  getOrderBilling,
  mlApiCall,
} from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// POST /api/sync/mercadolivre - Sincroniza dados do ML
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = body.accountId;

    // Busca conta(s) para sincronizar
    const accounts = accountId
      ? await prisma.account.findMany({
          where: { id: accountId, platform: "MERCADO_LIVRE", isActive: true },
        })
      : await prisma.account.findMany({
          where: { platform: "MERCADO_LIVRE", isActive: true },
        });

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Nenhuma conta ML ativa encontrada" }, { status: 404 });
    }

    const results = [];

    for (const account of accounts) {
      // Cria log de sync
      const syncLog = await prisma.syncLog.create({
        data: {
          accountId: account.id,
          syncType: "full",
          status: "RUNNING",
        },
      });

      try {
        // Renova token se necessario
        let accessToken = account.accessToken;
        if (account.tokenExpires && account.tokenExpires < new Date()) {
          if (!account.refreshToken) {
            throw new Error("Token expirado e sem refresh_token");
          }
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

        // === SYNC PEDIDOS ===
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const ordersData = await getOrders(
            accessToken,
            account.platformId,
            offset,
            50
          );

          const orders = ordersData.results || [];

          for (const mlOrder of orders) {
            // === BUSCA DETALHES COMPLETOS DO PEDIDO ===
            let platformFee = 0;
            let shippingCostSeller = 0;
            let shippingCostBuyer = 0;

            // Busca o pedido completo via /orders/{id} (inclui payments com fees)
            try {
              const fullOrder = await mlApiCall(`/orders/${mlOrder.id}`, accessToken);

              // Extrai fees dos payments do pedido completo
              if (fullOrder.payments && Array.isArray(fullOrder.payments)) {
                for (const payment of fullOrder.payments) {
                  if (payment.marketplace_fee !== undefined && payment.marketplace_fee !== null) {
                    platformFee += Math.abs(Number(payment.marketplace_fee));
                  }
                }
              }

              // Extrai sale_fee dos order_items
              if (platformFee === 0 && fullOrder.order_items && Array.isArray(fullOrder.order_items)) {
                for (const item of fullOrder.order_items) {
                  if (item.sale_fee !== undefined && item.sale_fee !== null) {
                    platformFee += Math.abs(Number(item.sale_fee));
                  }
                }
              }

              // Busca frete via shipment
              if (fullOrder.shipping?.id) {
                try {
                  const shipment = await mlApiCall(`/shipments/${fullOrder.shipping.id}`, accessToken);
                  if (shipment.shipping_option) {
                    const opt = shipment.shipping_option;
                    // cost = custo total, buyer_cost = pago pelo comprador
                    const totalShippingCost = opt.cost || 0;
                    const buyerCost = opt.list_cost || opt.buyer_cost || 0;
                    shippingCostBuyer = buyerCost;
                    // Frete vendedor = custo total - o que o comprador pagou
                    shippingCostSeller = Math.max(0, totalShippingCost - buyerCost);
                  }
                  // Se tem receiver_cost (frete gratis pelo vendedor)
                  if (shipment.cost !== undefined) {
                    shippingCostSeller = Math.max(shippingCostSeller, Math.abs(Number(shipment.cost || 0)));
                  }
                } catch {
                  // Shipment nao disponivel
                  shippingCostBuyer = mlOrder.shipping?.cost || 0;
                }
              }
            } catch {
              // Fallback: dados basicos do search
              shippingCostBuyer = mlOrder.shipping?.cost || 0;

              // Tenta billing_info como ultimo recurso
              try {
                const billing = await getOrderBilling(accessToken, mlOrder.id);
                const billingDetails = Array.isArray(billing?.billing_info) ? billing.billing_info : [];
                for (const detail of billingDetails) {
                  if (detail.type === "marketplace_fee" || detail.detail === "marketplace_fee") {
                    platformFee += Math.abs(detail.amount || 0);
                  }
                  if (detail.type === "shipping_fee" || detail.detail === "shipping") {
                    shippingCostSeller += Math.abs(detail.amount || 0);
                  }
                }
              } catch {
                // Sem dados de fees
              }
            }

            // Rate limiting entre chamadas de detalhe
            await new Promise((r) => setTimeout(r, 200));

            // Upsert do pedido
            const savedOrder = await prisma.order.upsert({
              where: {
                accountId_platformOrderId: {
                  accountId: account.id,
                  platformOrderId: String(mlOrder.id),
                },
              },
              update: {
                status: mlOrder.status,
                totalAmount: mlOrder.total_amount || 0,
                platformFee,
                sellerShippingCost: shippingCostSeller,
                shippingCost: shippingCostBuyer,
                paidDate: mlOrder.date_closed ? new Date(mlOrder.date_closed) : null,
              },
              create: {
                accountId: account.id,
                platformOrderId: String(mlOrder.id),
                status: mlOrder.status,
                totalAmount: mlOrder.total_amount || 0,
                currency: mlOrder.currency_id || "BRL",
                platformFee,
                sellerShippingCost: shippingCostSeller,
                shippingCost: shippingCostBuyer,
                shippingId: mlOrder.shipping?.id ? String(mlOrder.shipping.id) : null,
                packId: mlOrder.pack_id ? String(mlOrder.pack_id) : null,
                buyerNickname: mlOrder.buyer?.nickname || null,
                orderDate: new Date(mlOrder.date_created),
                paidDate: mlOrder.date_closed ? new Date(mlOrder.date_closed) : null,
              },
            });

            // Salva itens do pedido
            if (mlOrder.order_items) {
              for (const item of mlOrder.order_items) {
                await prisma.orderItem.upsert({
                  where: {
                    id: `${savedOrder.id}-${item.item.id}`,
                  },
                  update: {
                    quantity: item.quantity,
                    unitPrice: item.unit_price,
                    totalPrice: item.quantity * item.unit_price,
                  },
                  create: {
                    id: `${savedOrder.id}-${item.item.id}`,
                    orderId: savedOrder.id,
                    platformItemId: item.item.id,
                    title: item.item.title,
                    quantity: item.quantity,
                    unitPrice: item.unit_price,
                    totalPrice: item.quantity * item.unit_price,
                    sku: item.item.seller_sku || null,
                  },
                });
              }
            }

            totalSynced++;
          }

          offset += 50;
          hasMore = offset < (ordersData.paging?.total || 0);

          // Rate limiting - espera 500ms entre paginas
          await new Promise((r) => setTimeout(r, 500));
        }

        // === SYNC PRODUTOS ===
        offset = 0;
        hasMore = true;

        while (hasMore) {
          const itemsData = await getSellerItems(
            accessToken,
            account.platformId,
            offset,
            50
          );

          const itemIds = itemsData.results || [];

          for (const itemId of itemIds) {
            try {
              const itemDetail = await getItemDetails(accessToken, itemId);

              await prisma.product.upsert({
                where: {
                  accountId_platformItemId: {
                    accountId: account.id,
                    platformItemId: itemId,
                  },
                },
                update: {
                  title: itemDetail.title,
                  price: itemDetail.price,
                  stock: itemDetail.available_quantity || 0,
                  status: itemDetail.status,
                  thumbnail: itemDetail.thumbnail,
                  permalink: itemDetail.permalink,
                },
                create: {
                  accountId: account.id,
                  platformItemId: itemId,
                  title: itemDetail.title,
                  price: itemDetail.price,
                  currency: itemDetail.currency_id || "BRL",
                  stock: itemDetail.available_quantity || 0,
                  status: itemDetail.status,
                  categoryId: itemDetail.category_id || null,
                  thumbnail: itemDetail.thumbnail || null,
                  permalink: itemDetail.permalink || null,
                  sku: itemDetail.seller_custom_field || null,
                },
              });

              totalSynced++;
            } catch (e) {
              console.error(`Error syncing item ${itemId}:`, e);
            }

            // Rate limiting
            await new Promise((r) => setTimeout(r, 300));
          }

          offset += 50;
          hasMore = offset < (itemsData.paging?.total || 0);
        }

        // === RECALCULA METRICAS DIARIAS ===
        await recalculateDailyMetrics(account.id);

        // Finaliza sync log
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: {
            status: "SUCCESS",
            recordsSync: totalSynced,
            finishedAt: new Date(),
          },
        });

        results.push({
          accountId: account.id,
          nickname: account.nickname,
          status: "success",
          recordsSynced: totalSynced,
        });
      } catch (error) {
        console.error(`Sync error for account ${account.id}:`, error);

        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: {
            status: "FAILED",
            errorMsg: error instanceof Error ? error.message : "Unknown error",
            finishedAt: new Date(),
          },
        });

        results.push({
          accountId: account.id,
          nickname: account.nickname,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Erro na sincronizacao" },
      { status: 500 }
    );
  }
}

// Recalcula metricas diarias a partir dos pedidos salvos
async function recalculateDailyMetrics(accountId: string) {
  const orders = await prisma.order.findMany({
    where: { accountId, status: { not: "cancelled" } },
    include: { items: true },
  });

  // Agrupa por data
  const metricsByDate: Record<string, {
    revenue: number;
    platformFee: number;
    shippingCost: number;
    tax: number;
    discount: number;
    totalOrders: number;
    totalUnits: number;
  }> = {};

  for (const order of orders) {
    const dateKey = order.orderDate.toISOString().split("T")[0];

    if (!metricsByDate[dateKey]) {
      metricsByDate[dateKey] = {
        revenue: 0,
        platformFee: 0,
        shippingCost: 0,
        tax: 0,
        discount: 0,
        totalOrders: 0,
        totalUnits: 0,
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

  // Salva metricas
  for (const [dateKey, m] of Object.entries(metricsByDate)) {
    const margin = m.revenue - m.platformFee - m.shippingCost - m.tax - m.discount;
    const avgTicket = m.totalOrders > 0 ? m.revenue / m.totalOrders : 0;

    await prisma.dailyMetric.upsert({
      where: {
        platform_date: {
          platform: "MERCADO_LIVRE",
          date: new Date(dateKey),
        },
      },
      update: {
        revenue: m.revenue,
        platformFee: m.platformFee,
        shippingCost: m.shippingCost,
        tax: m.tax,
        discount: m.discount,
        margin,
        totalOrders: m.totalOrders,
        totalUnits: m.totalUnits,
        avgTicket,
      },
      create: {
        platform: "MERCADO_LIVRE",
        date: new Date(dateKey),
        revenue: m.revenue,
        platformFee: m.platformFee,
        shippingCost: m.shippingCost,
        tax: m.tax,
        discount: m.discount,
        margin,
        totalOrders: m.totalOrders,
        totalUnits: m.totalUnits,
        avgTicket,
      },
    });
  }
}
