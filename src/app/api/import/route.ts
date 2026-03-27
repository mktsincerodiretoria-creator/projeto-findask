import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Limpa valor monetario: "R$ 1.234,56" -> 1234.56
function parseMoney(val: string): number {
  if (!val || val === "-" || val === "") return 0;
  return parseFloat(
    val.replace(/R\$\s*/gi, "").replace(/\./g, "").replace(",", ".").trim()
  ) || 0;
}

// Detecta qual plataforma pelo header do CSV
function detectPlatform(headers: string[]): string {
  const headerStr = headers.join(",").toLowerCase();
  if (headerStr.includes("faturamento ml") || headerStr.includes("tarifa de venda")) return "MERCADO_LIVRE";
  if (headerStr.includes("faturamento shp") || headerStr.includes("shopee") || headerStr.includes("comissão afiliado")) return "SHOPEE";
  if (headerStr.includes("amazon") || headerStr.includes("asin")) return "AMAZON";
  if (headerStr.includes("tiktok") || headerStr.includes("comissão tiktok") || headerStr.includes("tarifa de comissão da plataforma") || headerStr.includes("id do demonstrativo")) return "TIKTOK_SHOP";
  return "UNKNOWN";
}

// Encontra indice da coluna pelo nome (busca parcial, case-insensitive)
function findCol(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

// POST /api/import - Importa planilha de vendas da plataforma
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { csvText, platform: forcePlatform } = body;

    if (!csvText) {
      return NextResponse.json({ error: "CSV vazio" }, { status: 400 });
    }

    const lines = csvText.split("\n").filter((l: string) => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV precisa ter header + dados" }, { status: 400 });
    }

    // Detecta separador
    const separator = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(separator).map((h: string) => h.trim().replace(/"/g, ""));

    // Detecta plataforma
    const platform = forcePlatform || detectPlatform(headers);

    // Mapeia colunas (inclui nomes do ML, Shopee, TikTok, Amazon)
    const colSku = findCol(headers, "id do sku", "sku", "seller_sku");
    const colTitle = findCol(headers, "nome do produto", "anúncio", "anuncio", "título", "titulo", "nome", "title");
    const colDate = findCol(headers, "data de criação do pedido", "data de criacao", "data", "create_time");
    const colQty = findCol(headers, "quantidade", "qtd", "qty");
    const colUnitPrice = findCol(headers, "subtotal do item antes dos descontos", "valor unit", "preço unit", "unit price");
    const colRevenue = findCol(headers, "vendas líquidas dos produtos", "vendas liquidas", "faturamento ml", "faturamento shp", "faturamento", "revenue", "total_amount");
    const colCost = findCol(headers, "custo (-)","custo(-)", "custo", "cost");
    const colTax = findCol(headers, "impostos", "imposto (-)", "imposto(-)", "imposto", "tax");
    const colFee = findCol(headers, "tarifa de comissão da plataforma", "tarifa de venda", "tarifa", "comissão", "comissao", "fee", "commission");
    const colServiceFee = findCol(headers, "taxas de serviço", "taxas de servico", "service fee");
    const colFreteComp = findCol(headers, "taxa de frete paga pelo cliente", "frete comprador", "frete comp", "buyer shipping");
    const colFreteTotal = findCol(headers, "custo do frete", "custo de frete");
    const colFreteVend = findCol(headers, "frete vendedor", "frete vend", "seller shipping");
    const colOrderId = findCol(headers, "id do pedido/ajuste", "id do pedido", "id da venda", "nº pedido", "order_sn", "order id", "n. pedido");
    const colStatus = findCol(headers, "status");
    const colAffiliate = findCol(headers, "comissões de afiliados", "comissão afiliado", "afiliado", "affiliate");
    const colTransactionType = findCol(headers, "tipo de transação", "tipo de transacao", "transaction_type");
    const colSettlement = findCol(headers, "valor total a ser liquidado");

    // Busca ou cria conta para a plataforma
    let account = await prisma.account.findFirst({
      where: { platform: platform as "MERCADO_LIVRE" | "SHOPEE" | "TIKTOK_SHOP" | "AMAZON" },
    });

    if (!account) {
      account = await prisma.account.create({
        data: {
          platform: platform as "MERCADO_LIVRE" | "SHOPEE" | "TIKTOK_SHOP" | "AMAZON",
          platformId: `import_${platform.toLowerCase()}`,
          accessToken: "imported",
          nickname: `${platform} (importado)`,
        },
      });
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(separator).map((c: string) => c.trim().replace(/"/g, ""));

      if (cols.length < 3) { skipped++; continue; }

      // Filtra linhas de reembolso/ajuste (TikTok)
      if (colTransactionType >= 0) {
        const txType = cols[colTransactionType]?.toLowerCase() || "";
        if (txType.includes("reembolso") || txType.includes("refund") || txType.includes("ajuste")) {
          skipped++;
          continue;
        }
      }

      // Extrai dados
      const sku = colSku >= 0 ? cols[colSku]?.replace(/\//g, "").trim() : "";
      const title = colTitle >= 0 ? cols[colTitle] : "";
      const dateStr = colDate >= 0 ? cols[colDate] : "";
      const quantity = colQty >= 0 ? parseInt(cols[colQty]) || 1 : 1;
      const unitPrice = colUnitPrice >= 0 ? parseMoney(cols[colUnitPrice]) : 0;
      let revenue = colRevenue >= 0 ? parseMoney(cols[colRevenue]) : 0;
      // Se revenue e 0 ou negativo, usa unitPrice
      if (revenue <= 0) revenue = unitPrice * quantity;
      const cost = colCost >= 0 ? parseMoney(cols[colCost]) : 0;
      const tax = colTax >= 0 ? Math.abs(parseMoney(cols[colTax])) : 0;
      let fee = colFee >= 0 ? Math.abs(parseMoney(cols[colFee])) : 0;
      // Soma taxas de servico (TikTok tem separado)
      const serviceFee = colServiceFee >= 0 ? Math.abs(parseMoney(cols[colServiceFee])) : 0;
      fee += serviceFee;
      // Frete comprador
      const freteComp = colFreteComp >= 0 ? Math.abs(parseMoney(cols[colFreteComp])) : 0;
      // Frete total e vendedor
      const freteTotal = colFreteTotal >= 0 ? Math.abs(parseMoney(cols[colFreteTotal])) : 0;
      let freteVend = colFreteVend >= 0 ? Math.abs(parseMoney(cols[colFreteVend])) : 0;
      // Se tem frete total mas nao frete vendedor, calcula: vendedor = total - comprador
      if (freteVend === 0 && freteTotal > 0) {
        freteVend = Math.max(0, freteTotal - freteComp);
      }
      const affiliateFee = colAffiliate >= 0 ? Math.abs(parseMoney(cols[colAffiliate])) : 0;
      fee += affiliateFee;
      const orderId = colOrderId >= 0 ? cols[colOrderId]?.trim() : `IMP-${i}-${Date.now()}`;
      const status = colStatus >= 0 ? cols[colStatus] : "paid";

      // Pula se nao tem receita e nao tem preco
      if (revenue <= 0 && unitPrice <= 0) { skipped++; continue; }
      // Pula se orderId e vazio ou "/"
      if (!orderId || orderId === "/" || orderId === "") { skipped++; continue; }

      // Parse date (DD/MM/YYYY, YYYY/MM/DD, ou YYYY-MM-DD)
      let orderDate: Date;
      if (dateStr.includes("/")) {
        const parts = dateStr.split("/");
        // Detecta se e YYYY/MM/DD ou DD/MM/YYYY
        const isYearFirst = parts[0].length === 4;
        const [d, m, y] = isYearFirst ? [parts[2], parts[1], parts[0]] : [parts[0], parts[1], parts[2]];
        orderDate = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00Z`);
      } else if (dateStr) {
        orderDate = new Date(dateStr);
      } else {
        orderDate = new Date();
      }

      if (isNaN(orderDate.getTime())) orderDate = new Date();

      const totalAmount = revenue || unitPrice * quantity;

      // Upsert do pedido
      const existing = await prisma.order.findFirst({
        where: { accountId: account.id, platformOrderId: orderId },
      });

      if (existing) {
        await prisma.order.update({
          where: { id: existing.id },
          data: {
            totalAmount,
            platformFee: fee,
            sellerShippingCost: freteVend,
            shippingCost: freteComp,
            taxAmount: tax,
            productCost: cost,
            status: status.toLowerCase().includes("cancel") ? "cancelled" : "paid",
          },
        });
        updated++;
      } else {
        const savedOrder = await prisma.order.create({
          data: {
            accountId: account.id,
            platformOrderId: orderId,
            status: status.toLowerCase().includes("cancel") ? "cancelled" : "paid",
            totalAmount,
            currency: "BRL",
            platformFee: fee,
            sellerShippingCost: freteVend,
            shippingCost: freteComp,
            taxAmount: tax,
            productCost: cost,
            orderDate,
          },
        });

        // Cria item do pedido
        await prisma.orderItem.create({
          data: {
            id: `${savedOrder.id}-imp-${i}`,
            orderId: savedOrder.id,
            platformItemId: sku || `imp-${i}`,
            title: title || "Produto importado",
            quantity,
            unitPrice,
            totalPrice: totalAmount,
            sku: sku || null,
          },
        });

        imported++;
      }

      // Atualiza custo do produto se tiver SKU e custo
      if (sku && cost > 0 && quantity > 0) {
        const unitCost = cost / quantity;
        await prisma.productCost.upsert({
          where: { sku },
          update: { cost: unitCost, title: title || undefined },
          create: { sku, cost: unitCost, title: title || null },
        });
      }
    }

    return NextResponse.json({
      success: true,
      platform,
      imported,
      updated,
      skipped,
      total: imported + updated,
      headers: headers.slice(0, 15),
      columnsDetected: {
        sku: colSku >= 0, title: colTitle >= 0, date: colDate >= 0,
        qty: colQty >= 0, unitPrice: colUnitPrice >= 0, revenue: colRevenue >= 0,
        cost: colCost >= 0, tax: colTax >= 0, fee: colFee >= 0,
        serviceFee: colServiceFee >= 0,
        freteComp: colFreteComp >= 0, freteVend: colFreteVend >= 0,
        freteTotal: colFreteTotal >= 0,
        orderId: colOrderId >= 0, affiliate: colAffiliate >= 0,
        transactionType: colTransactionType >= 0, settlement: colSettlement >= 0,
      },
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
