import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/accounts - Lista todas as contas conectadas
export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        platform: true,
        platformId: true,
        nickname: true,
        email: true,
        isActive: true,
        tokenExpires: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { orders: true, products: true },
        },
        syncLogs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            status: true,
            recordsSync: true,
            startedAt: true,
            finishedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = accounts.map((acc) => ({
      ...acc,
      tokenStatus:
        !acc.tokenExpires
          ? "unknown"
          : acc.tokenExpires > new Date()
          ? "valid"
          : "expired",
      lastSync: acc.syncLogs[0] || null,
      ordersCount: acc._count.orders,
      productsCount: acc._count.products,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error("Accounts error:", error);
    return NextResponse.json({ error: "Erro ao buscar contas" }, { status: 500 });
  }
}
