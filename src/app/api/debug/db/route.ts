import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/debug/db - Verifica o estado do banco de dados
export async function GET() {
  try {
    const accountsCount = await prisma.account.count();
    const ordersCount = await prisma.order.count();
    const productsCount = await prisma.product.count();
    const metricsCount = await prisma.dailyMetric.count();

    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        platform: true,
        platformId: true,
        nickname: true,
        isActive: true,
        tokenExpires: true,
      },
    });

    const syncLogs = await prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        syncType: true,
        status: true,
        recordsSync: true,
        errorMsg: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    const recentOrders = await prisma.order.findMany({
      orderBy: { orderDate: "desc" },
      take: 5,
      select: {
        id: true,
        platformOrderId: true,
        status: true,
        totalAmount: true,
        platformFee: true,
        orderDate: true,
      },
    });

    const metrics = await prisma.dailyMetric.findMany({
      orderBy: { date: "desc" },
      take: 5,
    });

    return NextResponse.json({
      counts: {
        accounts: accountsCount,
        orders: ordersCount,
        products: productsCount,
        dailyMetrics: metricsCount,
      },
      accounts,
      recentSyncLogs: syncLogs,
      recentOrders,
      recentMetrics: metrics,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
