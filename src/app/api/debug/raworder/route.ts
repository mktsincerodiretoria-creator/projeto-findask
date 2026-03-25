import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mlApiCall, refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/debug/raworder - Busca dados BRUTOS de 3 pedidos da API ML
export async function GET() {
  try {
    // Busca conta e atualiza token
    const account = await prisma.account.findFirst({
      where: { platform: "MERCADO_LIVRE", isActive: true },
    });
    if (!account) return NextResponse.json({ error: "Sem conta ML" });

    let accessToken = account.accessToken;

    // Sempre tenta renovar token
    if (account.refreshToken) {
      try {
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
      } catch (e) {
        return NextResponse.json({ error: "Token refresh failed: " + String(e) });
      }
    }

    // Busca 3 pedidos recentes
    const searchData = await mlApiCall(
      `/orders/search?seller=${account.platformId}&limit=3&sort=date_desc`,
      accessToken
    );

    const results = [];

    for (const order of (searchData.results || [])) {
      const orderResult: Record<string, unknown> = {
        orderId: order.id,
        total_amount: order.total_amount,
        shipping_from_search: order.shipping,
      };

      // Busca detalhes completos do pedido
      try {
        const fullOrder = await mlApiCall(`/orders/${order.id}`, accessToken);
        orderResult.full_order_payments = fullOrder.payments?.map((p: Record<string, unknown>) => ({
          id: p.id,
          status: p.status,
          total_paid_amount: p.total_paid_amount,
          transaction_amount: p.transaction_amount,
          shipping_cost: p.shipping_cost,
          marketplace_fee: p.marketplace_fee,
          taxes_amount: p.taxes_amount,
          overpaid_amount: p.overpaid_amount,
          coupon_amount: p.coupon_amount,
        }));
        orderResult.full_order_shipping = fullOrder.shipping;
        orderResult.full_order_items = fullOrder.order_items?.map((i: Record<string, unknown>) => {
          const item = i.item as Record<string, unknown>;
          return { id: item?.id, title: item?.title, sku: item?.seller_sku, sale_fee: i.sale_fee, unit_price: i.unit_price, quantity: i.quantity };
        });
      } catch (e) {
        orderResult.order_detail_error = String(e);
      }

      // Busca shipment
      const shippingId = order.shipping?.id;
      if (shippingId) {
        try {
          const shipment = await mlApiCall(`/shipments/${shippingId}`, accessToken);
          orderResult.shipment = {
            id: shipment.id,
            status: shipment.status,
            cost: shipment.cost,
            sender_cost: shipment.sender_cost,
            receiver_cost: shipment.receiver_cost,
            shipping_option: shipment.shipping_option ? {
              cost: shipment.shipping_option.cost,
              list_cost: shipment.shipping_option.list_cost,
              buyer_cost: shipment.shipping_option.buyer_cost,
              name: shipment.shipping_option.name,
            } : null,
            base_cost: shipment.base_cost,
          };
        } catch (e) {
          orderResult.shipment_error = String(e);
        }
      }

      results.push(orderResult);
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
