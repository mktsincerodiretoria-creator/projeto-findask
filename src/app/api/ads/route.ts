import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mlApiCall, refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/ads - Busca metricas de ads agregadas
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const platform = searchParams.get("platform");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Busca metricas de ads por campanha
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (platform) {
      where.campaign = { platform };
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const metrics = await prisma.adMetric.findMany({
      where,
      include: { campaign: { select: { campaignName: true, platform: true, campaignId: true } } },
      orderBy: { date: "desc" },
    });

    // Agrupa totais
    const totals = metrics.reduce(
      (acc, m) => ({
        impressions: acc.impressions + m.impressions,
        clicks: acc.clicks + m.clicks,
        spend: acc.spend + m.spend,
        revenue: acc.revenue + m.revenue,
        orders: acc.orders + m.orders,
      }),
      { impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 }
    );

    const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const acos = totals.revenue > 0 ? (totals.spend / totals.revenue) * 100 : 0;
    const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

    // Busca faturamento total para TACOS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderWhere: any = {};
    if (platform) orderWhere.account = { platform };
    if (from || to) {
      orderWhere.orderDate = {};
      if (from) orderWhere.orderDate.gte = new Date(from);
      if (to) orderWhere.orderDate.lte = new Date(to);
    }
    orderWhere.status = { not: "cancelled" };

    const totalRevenue = await prisma.order.aggregate({
      where: orderWhere,
      _sum: { totalAmount: true },
    });

    const totalFaturamento = totalRevenue._sum.totalAmount || 0;
    const tacos = totalFaturamento > 0 ? (totals.spend / totalFaturamento) * 100 : 0;

    // Agrupa por campanha
    const byCampaign: Record<string, {
      campaignName: string; platform: string; campaignId: string;
      spend: number; revenue: number; clicks: number; impressions: number; orders: number;
    }> = {};

    for (const m of metrics) {
      const key = m.campaignId;
      if (!byCampaign[key]) {
        byCampaign[key] = {
          campaignName: m.campaign.campaignName || m.campaign.campaignId,
          platform: m.campaign.platform,
          campaignId: m.campaign.campaignId,
          spend: 0, revenue: 0, clicks: 0, impressions: 0, orders: 0,
        };
      }
      byCampaign[key].spend += m.spend;
      byCampaign[key].revenue += m.revenue;
      byCampaign[key].clicks += m.clicks;
      byCampaign[key].impressions += m.impressions;
      byCampaign[key].orders += m.orders;
    }

    // Agrupa por SKU (produto)
    const bySku: Record<string, {
      sku: string; spend: number; revenue: number; clicks: number; orders: number;
    }> = {};

    for (const m of metrics) {
      if (!m.sku) continue;
      if (!bySku[m.sku]) {
        bySku[m.sku] = { sku: m.sku, spend: 0, revenue: 0, clicks: 0, orders: 0 };
      }
      bySku[m.sku].spend += m.spend;
      bySku[m.sku].revenue += m.revenue;
      bySku[m.sku].clicks += m.clicks;
      bySku[m.sku].orders += m.orders;
    }

    // Metricas diarias para grafico
    const dailyMap: Record<string, { date: string; spend: number; revenue: number; clicks: number; orders: number }> = {};
    for (const m of metrics) {
      const dk = new Date(m.date).toISOString().split("T")[0];
      if (!dailyMap[dk]) dailyMap[dk] = { date: dk, spend: 0, revenue: 0, clicks: 0, orders: 0 };
      dailyMap[dk].spend += m.spend;
      dailyMap[dk].revenue += m.revenue;
      dailyMap[dk].clicks += m.clicks;
      dailyMap[dk].orders += m.orders;
    }

    return NextResponse.json({
      totals: { ...totals, cpc, ctr, acos, roas, tacos, totalFaturamento },
      byCampaign: Object.values(byCampaign),
      bySku: Object.values(bySku),
      daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/ads - Sincroniza dados de ADS do Mercado Livre
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const platform = body.platform || "MERCADO_LIVRE";

    if (platform === "MERCADO_LIVRE") {
      return await syncMLAds();
    }

    return NextResponse.json({ error: "Plataforma de ads nao suportada ainda" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function syncMLAds() {
  const account = await prisma.account.findFirst({
    where: { platform: "MERCADO_LIVRE", isActive: true },
  });
  if (!account) return NextResponse.json({ error: "Sem conta ML" }, { status: 404 });

  let accessToken = account.accessToken;
  if (account.tokenExpires && account.tokenExpires < new Date()) {
    if (!account.refreshToken) throw new Error("Token expirado");
    const newToken = await refreshAccessToken(account.refreshToken);
    accessToken = newToken.access_token;
    await prisma.account.update({
      where: { id: account.id },
      data: {
        accessToken: newToken.access_token,
        refreshToken: newToken.refresh_token,
        tokenExpires: new Date(Date.now() + newToken.expires_in * 1000),
      },
    });
  }

  let totalSynced = 0;

  try {
    // Busca campanhas de Product Ads do ML
    const campaignsData = await mlApiCall(
      `/advertising/product_ads/campaigns?advertiser_id=${account.platformId}&limit=50`,
      accessToken
    );

    const campaigns = campaignsData.results || campaignsData || [];

    for (const camp of (Array.isArray(campaigns) ? campaigns : [])) {
      const campId = String(camp.id || camp.campaign_id);
      const campName = camp.name || camp.title || `Campanha ${campId}`;

      // Upsert campanha
      const savedCampaign = await prisma.adCampaign.upsert({
        where: {
          accountId_campaignId: { accountId: account.id, campaignId: campId },
        },
        update: { campaignName: campName, status: camp.status },
        create: {
          accountId: account.id, platform: "MERCADO_LIVRE",
          campaignId: campId, campaignName: campName, status: camp.status,
          dailyBudget: Number(camp.daily_budget || 0),
          totalBudget: Number(camp.total_budget || 0),
        },
      });

      // Busca metricas da campanha (ultimos 30 dias)
      try {
        const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const dateTo = new Date().toISOString().split("T")[0];

        const metricsData = await mlApiCall(
          `/advertising/product_ads/campaigns/${campId}/metrics?date_from=${dateFrom}&date_to=${dateTo}&advertiser_id=${account.platformId}`,
          accessToken
        );

        const dailyMetrics = metricsData.results || metricsData.daily || [];

        for (const dm of (Array.isArray(dailyMetrics) ? dailyMetrics : [metricsData])) {
          const date = dm.date || dateTo;
          const impressions = Number(dm.impressions || dm.prints || 0);
          const clicks = Number(dm.clicks || 0);
          const spend = Number(dm.cost || dm.spend || dm.amount || 0);
          const revenue = Number(dm.revenue || dm.total_amount || 0);
          const orders = Number(dm.orders || dm.conversions || 0);

          if (spend > 0 || clicks > 0 || impressions > 0) {
            await prisma.adMetric.upsert({
              where: {
                campaignId_date: { campaignId: savedCampaign.id, date: new Date(date) },
              },
              update: {
                impressions, clicks, spend, revenue, orders,
                cpc: clicks > 0 ? spend / clicks : 0,
                ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                acos: revenue > 0 ? (spend / revenue) * 100 : 0,
                roas: spend > 0 ? revenue / spend : 0,
              },
              create: {
                campaignId: savedCampaign.id, date: new Date(date),
                impressions, clicks, spend, revenue, orders,
                cpc: clicks > 0 ? spend / clicks : 0,
                ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                acos: revenue > 0 ? (spend / revenue) * 100 : 0,
                roas: spend > 0 ? revenue / spend : 0,
                sku: dm.item_id || dm.sku || null,
                itemId: dm.item_id || null,
              },
            });
            totalSynced++;
          }
        }
      } catch (e) {
        console.error(`Error syncing metrics for campaign ${campId}:`, e);
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    // Se nao tem acesso a API de ads, retorna info
    return NextResponse.json({
      error: "Nao foi possivel acessar a API de Ads do ML. Verifique se a permissao 'Publicidade de um produto' esta ativada.",
      details: String(e),
      totalSynced: 0,
    });
  }

  return NextResponse.json({ status: "success", totalSynced });
}
