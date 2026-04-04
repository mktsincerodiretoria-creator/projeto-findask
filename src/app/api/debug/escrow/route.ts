import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  refreshShopeeToken,
  getShopeeOrders,
  getShopeeOrderDetails,
  getShopeeOrderIncome,
} from "@/lib/shopee";

export const dynamic = "force-dynamic";

// GET /api/debug/escrow - Mostra dados brutos de escrow para 3 pedidos Shopee
export async function GET() {
  try {
    const account = await prisma.account.findFirst({
      where: { platform: "SHOPEE", isActive: true },
    });
    if (!account) return NextResponse.json({ error: "Sem conta Shopee" });

    let accessToken = account.accessToken;
    const shopId = Number(account.platformId);

    if (!account.tokenExpires || account.tokenExpires < new Date(Date.now() + 5 * 60 * 1000)) {
      if (!account.refreshToken) return NextResponse.json({ error: "Token expirado" });
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

    const timeTo = Math.floor(Date.now() / 1000);
    const timeFrom = timeTo - 15 * 24 * 60 * 60;

    const ordersData = await getShopeeOrders(accessToken, shopId, timeFrom, timeTo, "", 3, "update_time", "COMPLETED");
    const orderSns = (ordersData.response?.order_list || []).map((o: { order_sn: string }) => o.order_sn);

    if (orderSns.length === 0) return NextResponse.json({ message: "Sem pedidos" });

    const detailsData = await getShopeeOrderDetails(accessToken, shopId, orderSns);
    const details = detailsData.response?.order_list || [];

    const results = [];
    for (const order of details) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = order as any;
      let escrowData = null;
      try {
        escrowData = await getShopeeOrderIncome(accessToken, shopId, o.order_sn);
      } catch (e) {
        escrowData = { error: String(e) };
      }

      // Calculate what we would save
      const escrowIncome = escrowData?.response?.order_income;
      let calcSellerShip = 0;
      if (escrowIncome) {
        const actual = Math.abs(Number(escrowIncome.actual_shipping_fee || escrowIncome.final_shipping_fee || 0));
        const buyerPaid = Math.abs(Number(escrowIncome.buyer_paid_shipping_fee || 0));
        const rebate = Math.abs(Number(escrowIncome.shopee_shipping_rebate || 0));
        calcSellerShip = Math.max(0, actual - buyerPaid - rebate);
      }

      results.push({
        order_sn: o.order_sn,
        order_status: o.order_status,
        total_amount: o.total_amount,
        order_income_from_detail: o.order_income || null,
        item_list: o.item_list?.map((i: { item_name: string; model_discounted_price: number; model_original_price: number; model_quantity_purchased: number; quantity: number }) => ({
          name: i.item_name,
          discounted_price: i.model_discounted_price,
          original_price: i.model_original_price,
          qty: i.model_quantity_purchased || i.quantity,
        })),
        escrow_raw: escrowData?.response || escrowData,
        calculated: {
          sellerShippingCost: calcSellerShip,
        },
      });
    }

    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
