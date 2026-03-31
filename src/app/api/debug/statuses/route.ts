import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/debug/statuses - Mostra todos os status de pedidos no banco
export async function GET() {
  const statuses = await prisma.order.groupBy({
    by: ["status"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return NextResponse.json(statuses);
}
