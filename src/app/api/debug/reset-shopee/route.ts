import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/debug/reset-shopee
// Limpa pedidos Shopee antigos (sincronizados com dados errados)
// para forcar resincronizacao com dados corretos da API
export async function GET() {
  try {
    // Buscar contas Shopee
    const accounts = await prisma.account.findMany({ where: { platform: "SHOPEE" } });
    const accountIds = accounts.map(a => a.id);

    if (accountIds.length === 0) {
      return NextResponse.json({ message: "Nenhuma conta Shopee encontrada" });
    }

    // Deletar itens dos pedidos Shopee
    const deletedItems = await prisma.orderItem.deleteMany({
      where: { order: { accountId: { in: accountIds } } },
    });

    // Deletar pedidos Shopee
    const deletedOrders = await prisma.order.deleteMany({
      where: { accountId: { in: accountIds } },
    });

    // Deletar metricas diarias Shopee
    const deletedMetrics = await prisma.dailyMetric.deleteMany({
      where: { platform: "SHOPEE" },
    });

    return NextResponse.json({
      message: "Dados Shopee limpos. Clique 'Sincronizar Shopee' para recarregar com dados corretos.",
      deleted: {
        items: deletedItems.count,
        orders: deletedOrders.count,
        metrics: deletedMetrics.count,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
