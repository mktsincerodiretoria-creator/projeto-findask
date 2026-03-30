import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/purchases - Lista compras
export async function GET() {
  try {
    const purchases = await prisma.purchase.findMany({
      include: { stockItem: { select: { sku: true, title: true } } },
      orderBy: { orderDate: "desc" },
      take: 100,
    });
    return NextResponse.json(purchases);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/purchases - Registrar compra
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sku, quantity, unitCost, supplier, notes } = body;

    if (!sku || !quantity) return NextResponse.json({ error: "SKU e quantidade obrigatorios" }, { status: 400 });

    // Busca ou cria item de estoque
    let stockItem = await prisma.stockItem.findUnique({ where: { sku } });
    if (!stockItem) {
      stockItem = await prisma.stockItem.create({
        data: { sku, title: body.title || null, cost: Number(unitCost || 0), currentStock: 0 },
      });
    }

    const purchase = await prisma.purchase.create({
      data: {
        stockItemId: stockItem.id,
        quantity: Number(quantity),
        unitCost: Number(unitCost || stockItem.cost),
        totalCost: Number(quantity) * Number(unitCost || stockItem.cost),
        supplier: supplier || stockItem.supplier,
        notes,
        status: "pending",
      },
    });

    return NextResponse.json(purchase);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/purchases - Atualizar status (recebido)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status } = body;

    const purchase = await prisma.purchase.update({
      where: { id },
      data: {
        status,
        receivedDate: status === "received" ? new Date() : undefined,
      },
      include: { stockItem: true },
    });

    // Se recebido, atualiza estoque
    if (status === "received") {
      await prisma.stockItem.update({
        where: { id: purchase.stockItemId },
        data: { currentStock: { increment: purchase.quantity } },
      });
    }

    return NextResponse.json(purchase);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
