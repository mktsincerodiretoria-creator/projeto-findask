import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mlApiCall } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/debug/order?id=PLATFORM_ORDER_ID
// Mostra dados brutos da API do ML para comparar com Mercado Turbo
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("id");

  if (!orderId) {
    // Se nao passou ID, pega os ultimos 5 pedidos do banco
    const recentOrders = await prisma.order.findMany({
      orderBy: { orderDate: "desc" },
      take: 5,
      include: { items: true },
    });
    return NextResponse.json({
      message: "Passe ?id=PLATFORM_ORDER_ID para ver dados brutos. Ultimos pedidos:",
      orders: recentOrders.map((o) => ({
        platformOrderId: o.platformOrderId,
        totalAmount: o.totalAmount,
        platformFee: o.platformFee,
        sellerShippingCost: o.sellerShippingCost,
        shippingCost: o.shippingCost,
        status: o.status,
        orderDate: o.orderDate,
        items: o.items.map((i) => ({
          title: i.title,
          sku: i.sku,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      })),
    });
  }

  // Busca a conta ML ativa
  const account = await prisma.account.findFirst({
    where: { platform: "MERCADO_LIVRE", isActive: true },
  });

  if (!account) {
    return NextResponse.json({ error: "Nenhuma conta ML ativa" }, { status: 404 });
  }

  try {
    // Busca dados brutos do ML
    const [orderData, orderInDb] = await Promise.all([
      mlApiCall(`/orders/${orderId}`, account.accessToken),
      prisma.order.findFirst({
        where: { platformOrderId: orderId },
        include: { items: true },
      }),
    ]);

    // Busca shipment se existir
    let shipmentData = null;
    if (orderData.shipping?.id) {
      try {
        shipmentData = await mlApiCall(`/shipments/${orderData.shipping.id}`, account.accessToken);
      } catch (e) {
        shipmentData = { error: String(e) };
      }
    }

    return NextResponse.json({
      // Dados do nosso banco
      db: orderInDb
        ? {
            totalAmount: orderInDb.totalAmount,
            platformFee: orderInDb.platformFee,
            sellerShippingCost: orderInDb.sellerShippingCost,
            shippingCost: orderInDb.shippingCost,
            status: orderInDb.status,
            items: orderInDb.items.map((i) => ({
              title: i.title,
              sku: i.sku,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
            })),
          }
        : null,

      // Dados brutos do ML - ORDER
      ml_order: {
        id: orderData.id,
        status: orderData.status,
        total_amount: orderData.total_amount,
        currency_id: orderData.currency_id,
        payments: orderData.payments?.map((p: Record<string, unknown>) => ({
          id: p.id,
          status: p.status,
          total_paid_amount: p.total_paid_amount,
          marketplace_fee: p.marketplace_fee,
          shipping_cost: p.shipping_cost,
          transaction_amount: p.transaction_amount,
          taxes_amount: p.taxes_amount,
        })),
        order_items: orderData.order_items?.map((i: Record<string, unknown>) => {
          const item = i.item as Record<string, unknown>;
          return {
            item_id: item?.id,
            title: item?.title,
            seller_sku: item?.seller_sku,
            quantity: i.quantity,
            unit_price: i.unit_price,
            sale_fee: i.sale_fee,
            full_unit_price: i.full_unit_price,
            manufacturing_days: i.manufacturing_days,
          };
        }),
        shipping: orderData.shipping,
      },

      // Dados brutos do ML - SHIPMENT
      ml_shipment: shipmentData
        ? {
            id: shipmentData.id,
            status: shipmentData.status,
            cost: shipmentData.cost,
            sender_cost: shipmentData.sender_cost,
            receiver_cost: shipmentData.receiver_cost,
            shipping_option: shipmentData.shipping_option
              ? {
                  cost: shipmentData.shipping_option.cost,
                  list_cost: shipmentData.shipping_option.list_cost,
                  buyer_cost: shipmentData.shipping_option.buyer_cost,
                  name: shipmentData.shipping_option.name,
                  shipping_method_id: shipmentData.shipping_option.shipping_method_id,
                }
              : null,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
