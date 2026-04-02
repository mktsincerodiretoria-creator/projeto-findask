import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  // Conta pedidos por plataforma
  const accounts = await prisma.account.findMany({
    select: { id: true, platform: true, nickname: true, platformId: true, _count: { select: { orders: true } } },
  });

  // Pedidos recentes da Shopee
  const shopeeOrders = await prisma.order.findMany({
    where: { account: { platform: "SHOPEE" } },
    orderBy: { orderDate: "desc" },
    take: 5,
    select: { platformOrderId: true, status: true, totalAmount: true, orderDate: true, accountId: true },
  });

  return NextResponse.json({ accounts, shopeeOrders });
}
