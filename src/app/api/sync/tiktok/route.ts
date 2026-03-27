import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshTikTokToken, getTikTokOrders, getTikTokOrderDetails } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/sync/tiktok
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = body.accountId;

    const accounts = accountId
      ? await prisma.account.findMany({ where: { id: accountId, platform: "TIKTOK_SHOP", isActive: true } })
      : await prisma.account.findMany({ where: { platform: "TIKTOK_SHOP", isActive: true } });

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Nenhuma conta TikTok Shop ativa" }, { status: 404 });
    }

    const results = [];

    for (const account of accounts) {
      const syncLog = await prisma.syncLog.create({
        data: { accountId: account.id, syncType: "full", status: "RUNNING" },
      });

      try {
        let accessToken = account.accessToken;
        const shopCipher = account.platformId;

        // Renova token se necessario
        if (account.tokenExpires && account.tokenExpires < new Date()) {
          if (!account.refreshToken) throw new Error("Token expirado sem refresh_token");
          const newToken = await refreshTikTokToken(account.refreshToken);
          accessToken = newToken.access_token;
          await prisma.account.update({
            where: { id: account.id },
            data: {
              accessToken: newToken.access_token,
              refreshToken: newToken.refresh_token,
              tokenExpires: new Date(Date.now() + (newToken.access_token_expire_in || 86400) * 1000),
            },
          });
        }

        let totalSynced = 0;
        const createTimeTo = Math.floor(Date.now() / 1000);
        const createTimeFrom = createTimeTo - 30 * 24 * 60 * 60; // 30 dias
        let cursor = "";
        let hasMore = true;

        while (hasMore) {
          const ordersData = await getTikTokOrders(
            accessToken, shopCipher, 50, cursor, createTimeFrom, createTimeTo
          );

          const orders = ordersData?.orders || [];
          if (orders.length === 0) break;

          // Busca detalhes em lotes
          const orderIds = orders.map((o: { id: string }) => o.id);

          for (let i = 0; i < orderIds.length; i += 20) {
            const batch = orderIds.slice(i, i + 20);

            try {
              const details = await getTikTokOrderDetails(accessToken, shopCipher, batch);
              const orderList = details?.orders || [];

              for (const order of orderList) {
                const totalAmount = Number(order.payment?.total_amount || order.payment?.product_total_amount || 0) / 100; // TikTok usa centavos
                const platformFee = (
                  Math.abs(Number(order.payment?.platform_commission || 0)) +
                  Math.abs(Number(order.payment?.affiliate_commission || 0)) +
                  Math.abs(Number(order.payment?.transaction_fee || 0))
                ) / 100;
                const shippingCostSeller = Math.abs(Number(order.payment?.shipping_fee || 0)) / 100;
                const shippingCostBuyer = Math.abs(Number(order.payment?.buyer_shipping_fee || 0)) / 100;

                const savedOrder = await prisma.order.upsert({
                  where: {
                    accountId_platformOrderId: {
                      accountId: account.id,
                      platformOrderId: String(order.id),
                    },
                  },
                  update: {
                    status: order.status || "COMPLETED",
                    totalAmount,
                    platformFee,
                    sellerShippingCost: shippingCostSeller,
                    shippingCost: shippingCostBuyer,
                  },
                  create: {
                    accountId: account.id,
                    platformOrderId: String(order.id),
                    status: order.status || "COMPLETED",
                    totalAmount,
                    currency: "BRL",
                    platformFee,
                    sellerShippingCost: shippingCostSeller,
                    shippingCost: shippingCostBuyer,
                    buyerNickname: order.buyer_email || null,
                    orderDate: new Date((order.create_time || createTimeTo) * 1000),
                    paidDate: order.paid_time ? new Date(order.paid_time * 1000) : null,
                  },
                });

                // Salva itens
                if (Array.isArray(order.line_items)) {
                  for (const item of order.line_items) {
                    const itemId = `${savedOrder.id}-${item.id}`;
                    const unitPrice = Number(item.sale_price || 0) / 100;
                    const qty = Number(item.quantity || 1);
                    await prisma.orderItem.upsert({
                      where: { id: itemId },
                      update: { quantity: qty, unitPrice, totalPrice: unitPrice * qty },
                      create: {
                        id: itemId,
                        orderId: savedOrder.id,
                        platformItemId: String(item.product_id || item.id),
                        title: item.product_name || "",
                        quantity: qty,
                        unitPrice,
                        totalPrice: unitPrice * qty,
                        sku: item.seller_sku || item.sku_id || null,
                      },
                    });
                  }
                }

                totalSynced++;
              }
            } catch (e) {
              console.error("TikTok order detail error:", e);
            }

            await new Promise((r) => setTimeout(r, 500));
          }

          cursor = ordersData?.next_cursor || "";
          hasMore = !!ordersData?.next_cursor;
        }

        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: { status: "SUCCESS", recordsSync: totalSynced, finishedAt: new Date() },
        });

        results.push({ accountId: account.id, nickname: account.nickname, status: "success", recordsSynced: totalSynced });
      } catch (error) {
        console.error("TikTok sync error:", error);
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: { status: "FAILED", errorMsg: String(error), finishedAt: new Date() },
        });
        results.push({ accountId: account.id, nickname: account.nickname, status: "failed", error: String(error) });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
