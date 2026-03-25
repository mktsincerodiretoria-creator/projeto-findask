import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/product-costs - List all SKU costs
export async function GET() {
  try {
    const costs = await prisma.productCost.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(costs);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/product-costs - Create or update SKU cost (single or bulk)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle bulk upload (array)
    if (Array.isArray(body)) {
      let created = 0;
      let updated = 0;

      for (const item of body) {
        if (!item.sku || item.cost === undefined) continue;

        const existing = await prisma.productCost.findUnique({
          where: { sku: String(item.sku) },
        });

        if (existing) {
          await prisma.productCost.update({
            where: { sku: String(item.sku) },
            data: {
              cost: Number(item.cost),
              title: item.title || existing.title,
            },
          });
          updated++;
        } else {
          await prisma.productCost.create({
            data: {
              sku: String(item.sku),
              cost: Number(item.cost),
              title: item.title || null,
            },
          });
          created++;
        }
      }

      return NextResponse.json({ success: true, created, updated });
    }

    // Handle single item
    if (!body.sku || body.cost === undefined) {
      return NextResponse.json({ error: "SKU e custo sao obrigatorios" }, { status: 400 });
    }

    const result = await prisma.productCost.upsert({
      where: { sku: String(body.sku) },
      update: {
        cost: Number(body.cost),
        title: body.title || undefined,
      },
      create: {
        sku: String(body.sku),
        cost: Number(body.cost),
        title: body.title || null,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/product-costs - Delete a SKU cost
export async function DELETE(request: NextRequest) {
  try {
    const { sku } = await request.json();
    await prisma.productCost.delete({ where: { sku } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
