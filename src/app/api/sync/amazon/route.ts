import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  refreshAmazonToken,
  getAmazonOrders,
  getAmazonOrderItems,
  getAmazonFinancialEvents,
  AMAZON_BRAZIL_MARKETPLACE,
} from "@/lib/amazon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/sync/amazon
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountId = body.accountId;

    const accounts = accountId
      ? await prisma.account.findMany({ where: { id: accountId, platform: "AMAZON", isActive: true } })
      : await prisma.account.findMany({ where: { platform: "AMAZON", isActive: true } });

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Nenhuma conta Amazon ativa" }, { status: 404 });
    }

    const results = [];

    for (const account of accounts) {
      const syncLog = await prisma.syncLog.create({
        data: { accountId: account.id, syncType: "full", status: "RUNNING" },
      });

      try {
        let accessToken = account.accessToken;

        // Renova token se necessario
        if (account.tokenExpires && account.tokenExpires < new Date()) {
          if (!account.refreshToken) throw new Error("Token expirado sem refresh_token");
          const newToken = await refreshAmazonToken(account.refreshToken);
          accessToken = newToken.access_token;
          await prisma.account.update({
            where: { id: account.id },
            data: {
              accessToken: newToken.access_token,
              tokenExpires: new Date(Date.now() + (newToken.expires_in || 3600) * 1000),
            },
          });
        }

        let totalSynced = 0;
        const createdAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let nextToken: string | undefined;

        do {
          const ordersData = await getAmazonOrders(
            accessToken, AMAZON_BRAZIL_MARKETPLACE, createdAfter, nextToken
          );

          const orders = ordersData.payload?.Orders || [];
          nextToken = ordersData.payload?.NextToken;

          for (const order of orders) {
            const orderId = order.AmazonOrderId;
            const totalAmount = Number(order.OrderTotal?.Amount || 0);

            // Busca itens do pedido
            let items: Array<Record<string, unknown>> = [];
            try {
              const itemsData = await getAmazonOrderItems(accessToken, orderId);
              items = itemsData.payload?.OrderItems || [];
            } catch { /* sem itens */ }

            // Busca dados financeiros
            let platformFee = 0;
            let shippingCostSeller = 0;
            let shippingCostBuyer = 0;

            try {
              const finData = await getAmazonFinancialEvents(accessToken, orderId);
              const shipmentEvents = finData.payload?.FinancialEvents?.ShipmentEventList || [];

              for (const event of shipmentEvents) {
                const itemFees = event.ShipmentItemList || [];
                for (const item of itemFees) {
                  // Taxas da Amazon
                  const fees = item.ItemFeeList || [];
                  for (const fee of fees) {
                    const amount = Math.abs(Number(fee.FeeAmount?.CurrencyAmount || 0));
                    if (fee.FeeType === "Commission" || fee.FeeType === "ReferralFee") {
                      platformFee += amount;
                    } else if (fee.FeeType === "FBAPerUnitFulfillmentFee" || fee.FeeType === "FBAWeightBasedFee") {
                      shippingCostSeller += amount;
                    } else if (fee.FeeType === "ShippingChargeback") {
                      shippingCostSeller += amount;
                    }
                  }
                  // Shipping charges
                  const charges = item.ItemChargeList || [];
                  for (const charge of charges) {
                    if (charge.ChargeType === "ShippingCharge") {
                      shippingCostBuyer += Math.abs(Number(charge.ChargeAmount?.CurrencyAmount || 0));
                    }
                  }
                }
              }
            } catch { /* sem dados financeiros */ }

            // Upsert pedido
            const savedOrder = await prisma.order.upsert({
              where: {
                accountId_platformOrderId: {
                  accountId: account.id,
                  platformOrderId: orderId,
                },
              },
              update: {
                status: order.OrderStatus || "Shipped",
                totalAmount,
                platformFee,
                sellerShippingCost: shippingCostSeller,
                shippingCost: shippingCostBuyer,
              },
              create: {
                accountId: account.id,
                platformOrderId: orderId,
                status: order.OrderStatus || "Shipped",
                totalAmount,
                currency: "BRL",
                platformFee,
                sellerShippingCost: shippingCostSeller,
                shippingCost: shippingCostBuyer,
                buyerNickname: order.BuyerInfo?.BuyerEmail || null,
                orderDate: new Date(order.PurchaseDate || Date.now()),
                paidDate: order.PurchaseDate ? new Date(order.PurchaseDate) : null,
              },
            });

            // Salva itens
            for (const item of items) {
              const itemId = `${savedOrder.id}-${item.OrderItemId || item.ASIN}`;
              /* eslint-disable @typescript-eslint/no-explicit-any */
              const ai = item as any;
              const unitPrice = Number(ai.ItemPrice?.Amount || 0) / Number(ai.QuantityOrdered || 1);
              const qty = Number(ai.QuantityOrdered || 1);

              await prisma.orderItem.upsert({
                where: { id: itemId },
                update: { quantity: qty, unitPrice, totalPrice: unitPrice * qty },
                create: {
                  id: itemId,
                  orderId: savedOrder.id,
                  platformItemId: String(ai.ASIN || ai.OrderItemId || ""),
                  title: String(ai.Title || ""),
                  quantity: qty,
                  unitPrice,
                  totalPrice: unitPrice * qty,
                  sku: String(ai.SellerSKU || ""),
                },
              });
            }

            totalSynced++;
            await new Promise((r) => setTimeout(r, 500));
          }
        } while (nextToken);

        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: { status: "SUCCESS", recordsSync: totalSynced, finishedAt: new Date() },
        });

        results.push({ accountId: account.id, nickname: account.nickname, status: "success", recordsSynced: totalSynced });
      } catch (error) {
        console.error("Amazon sync error:", error);
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
