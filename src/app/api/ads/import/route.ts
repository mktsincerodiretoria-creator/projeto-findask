import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseMoney(val: string): number {
  if (!val || val === "-" || val === "") return 0;
  return parseFloat(val.replace(/R\$\s*/gi, "").replace(/\./g, "").replace(",", ".").trim()) || 0;
}

// POST /api/ads/import - Importa CSV de ADS do ML
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { csvText, platform: forcePlatform } = body;

    if (!csvText) return NextResponse.json({ error: "CSV vazio" }, { status: 400 });

    const lines = csvText.split("\n").filter((l: string) => l.trim());

    // Encontra a linha do header real (com "Desde", "Campanha", etc)
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes("campanha") && (line.includes("impressões") || line.includes("impressoes") || line.includes("cliques"))) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      return NextResponse.json({ error: "Header nao encontrado. O CSV precisa ter colunas: Campanha, Impressoes, Cliques, etc." }, { status: 400 });
    }

    const separator = lines[headerIdx].includes("\t") ? "\t" : lines[headerIdx].includes(";") ? ";" : ",";
    const headers = lines[headerIdx].split(separator).map((h: string) => h.trim().replace(/"/g, "").replace(/\n/g, " "));

    // Mapeia colunas
    const find = (...names: string[]) => {
      for (const name of names) {
        const idx = headers.findIndex((h: string) => h.toLowerCase().includes(name.toLowerCase()));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const colCampaign = find("campanha", "campaign");
    const colTitle = find("título do anúncio", "titulo do anuncio", "título", "title");
    const colCode = find("código do anúncio", "codigo do anuncio", "código", "code", "mlb");
    const colStatus = find("status");
    const colImpressions = find("impressões", "impressoes", "impressions");
    const colClicks = find("cliques", "clicks");
    const colRevenue = find("receita");
    const colSpend = find("investimento");
    const colDirectSales = find("vendas diretas", "direct sales");
    const colIndirectSales = find("vendas indiretas", "indirect sales");
    const colTotalSales = find("vendas por publicidade", "total sales");
    const colSince = find("desde", "since", "from");

    const platform = forcePlatform || "MERCADO_LIVRE";

    // Busca ou cria conta
    let account = await prisma.account.findFirst({
      where: { platform: platform as "MERCADO_LIVRE" | "SHOPEE" | "TIKTOK_SHOP" | "AMAZON" },
    });

    if (!account) {
      account = await prisma.account.create({
        data: {
          platform: platform as "MERCADO_LIVRE" | "SHOPEE" | "TIKTOK_SHOP" | "AMAZON",
          platformId: `ads_import_${platform.toLowerCase()}`,
          accessToken: "imported",
          nickname: `${platform} (importado)`,
        },
      });
    }

    let imported = 0;
    let skipped = 0;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(separator).map((c: string) => c.trim().replace(/"/g, ""));
      if (cols.length < 5) { skipped++; continue; }

      const campaignName = colCampaign >= 0 ? cols[colCampaign] : "";
      const title = colTitle >= 0 ? cols[colTitle] : "";
      const code = colCode >= 0 ? cols[colCode] : "";
      const status = colStatus >= 0 ? cols[colStatus] : "";
      const impressions = colImpressions >= 0 ? parseInt(cols[colImpressions]?.replace(/\./g, "")) || 0 : 0;
      const clicks = colClicks >= 0 ? parseInt(cols[colClicks]?.replace(/\./g, "")) || 0 : 0;
      const spend = colSpend >= 0 ? parseMoney(cols[colSpend]) : 0;
      const revenue = colRevenue >= 0 ? parseMoney(cols[colRevenue]) : 0;
      const directSales = colDirectSales >= 0 ? parseInt(cols[colDirectSales]) || 0 : 0;
      const indirectSales = colIndirectSales >= 0 ? parseInt(cols[colIndirectSales]) || 0 : 0;
      const totalSales = colTotalSales >= 0 ? parseInt(cols[colTotalSales]) || 0 : directSales + indirectSales;
      if (!campaignName && !title) { skipped++; continue; }

      // Cria identificador unico da campanha+anuncio
      const campId = code || `${campaignName}-${title}`.replace(/\s+/g, "-").slice(0, 50);

      // Upsert campanha
      const savedCampaign = await prisma.adCampaign.upsert({
        where: { accountId_campaignId: { accountId: account.id, campaignId: campId } },
        update: { campaignName: `${campaignName} | ${title}`.slice(0, 200), status: status.toLowerCase() },
        create: {
          accountId: account.id,
          platform: platform as "MERCADO_LIVRE" | "SHOPEE" | "TIKTOK_SHOP" | "AMAZON",
          campaignId: campId,
          campaignName: `${campaignName} | ${title}`.slice(0, 200),
          status: status.toLowerCase(),
        },
      });

      // Determina data
      let metricDate = new Date();
      if (colSince >= 0 && cols[colSince]) {
        const parts = cols[colSince].split("-");
        if (parts.length === 3) {
          metricDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`);
        }
      }

      const cpc = clicks > 0 ? spend / clicks : 0;
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const acos = revenue > 0 ? (spend / revenue) * 100 : 0;
      const roas = spend > 0 ? revenue / spend : 0;

      // Upsert metrica
      await prisma.adMetric.upsert({
        where: { campaignId_date: { campaignId: savedCampaign.id, date: metricDate } },
        update: { impressions, clicks, spend, revenue, orders: totalSales, cpc, ctr, acos, roas, sku: code || null, itemId: code || null },
        create: {
          campaignId: savedCampaign.id,
          date: metricDate,
          impressions, clicks, spend, revenue, orders: totalSales,
          cpc, ctr, acos, roas,
          sku: code || null,
          itemId: code || null,
        },
      });

      imported++;
    }

    return NextResponse.json({
      success: true,
      platform,
      imported,
      skipped,
      columnsDetected: {
        campaign: colCampaign >= 0, title: colTitle >= 0, code: colCode >= 0,
        status: colStatus >= 0, impressions: colImpressions >= 0, clicks: colClicks >= 0,
        spend: colSpend >= 0, revenue: colRevenue >= 0,
        directSales: colDirectSales >= 0, totalSales: colTotalSales >= 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
