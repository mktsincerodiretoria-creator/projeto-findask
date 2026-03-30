import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/accounts
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

// PUT /api/accounts - Editar nickname da conta
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, nickname } = body;

    if (!id || !nickname) {
      return NextResponse.json({ error: "ID e nickname obrigatorios" }, { status: 400 });
    }

    const updated = await prisma.account.update({
      where: { id },
      data: { nickname },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
