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

  const sellerId = account.platformId;
  let totalSynced = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugInfo: any[] = [];

  try {
    // Endpoint correto: /advertising/product_ads/campaigns/{seller_id}
    const campaignsData = await mlApiCall(
      `/advertising/product_ads/campaigns/${sellerId}`,
      accessToken
    );

    debugInfo.push({ endpoint: "campaigns", response: typeof campaignsData === "object" ? Object.keys(campaignsData) : typeof campaignsData });

    const campaigns = campaignsData.results || (Array.isArray(campaignsData) ? campaignsData : [campaignsData]);

    for (const camp of campaigns) {
      if (!camp || !camp.campaign_id) continue;

      const campId = String(camp.campaign_id);
      const campName = camp.name || `Campanha ${campId}`;

      const savedCampaign = await prisma.adCampaign.upsert({
        where: { accountId_campaignId: { accountId: account.id, campaignId: campId } },
        update: { campaignName: campName, status: camp.status },
        create: {
          accountId: account.id, platform: "MERCADO_LIVRE",
          campaignId: campId, campaignName: campName, status: camp.status || "unknown",
          dailyBudget: Number(camp.daily_budget || 0),
          totalBudget: Number(camp.total_budget || 0),
        },
      });

      // Busca metricas: /advertising/product_ads/campaigns/{seller_id}/{campaign_id}/metrics
      try {
        const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const dateTo = new Date().toISOString().split("T")[0];

        const metricsData = await mlApiCall(
          `/advertising/product_ads/campaigns/${sellerId}/${campId}/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
          accessToken
        );

        // Pode retornar um objeto unico ou array
        const metricsList = Array.isArray(metricsData) ? metricsData :
          metricsData.results ? metricsData.results :
          metricsData.daily ? metricsData.daily : [metricsData];

        for (const dm of metricsList) {
          if (!dm) continue;
          const date = dm.date || dateTo;
          const impressions = Number(dm.impressions || dm.prints || 0);
          const clicks = Number(dm.clicks || 0);
          const spend = Number(dm.cost || dm.spend || dm.amount || 0);
          const revenue = Number(dm.revenue || dm.total_amount || 0);
          const orders = Number(dm.orders || dm.sales || dm.conversions || 0);

          if (spend > 0 || clicks > 0 || impressions > 0) {
            await prisma.adMetric.upsert({
              where: { campaignId_date: { campaignId: savedCampaign.id, date: new Date(date) } },
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
              },
            });
            totalSynced++;
          }
        }
      } catch (metricsError) {
        debugInfo.push({ campaign: campId, metricsError: String(metricsError) });
      }

      // Busca ads (itens) da campanha com metricas por SKU
      try {
        const adsData = await mlApiCall(
          `/advertising/product_ads/campaigns/${sellerId}/${campId}/ads/metrics?date_from=${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}&date_to=${new Date().toISOString().split("T")[0]}`,
          accessToken
        );

        const ads = Array.isArray(adsData) ? adsData : adsData.results || [];
        for (const ad of ads) {
          if (ad.item_id && (ad.spend > 0 || ad.clicks > 0)) {
            // Cria metrica vinculada ao SKU/item
            const adCampId = `${campId}-${ad.item_id}`;
            const adCampaign = await prisma.adCampaign.upsert({
              where: { accountId_campaignId: { accountId: account.id, campaignId: adCampId } },
              update: { campaignName: `${campName} | ${ad.title || ad.item_id}` },
              create: {
                accountId: account.id, platform: "MERCADO_LIVRE",
                campaignId: adCampId, campaignName: `${campName} | ${ad.title || ad.item_id}`,
                status: ad.status || "active",
              },
            });

            await prisma.adMetric.upsert({
              where: { campaignId_date: { campaignId: adCampaign.id, date: new Date() } },
              update: {
                impressions: Number(ad.impressions || 0), clicks: Number(ad.clicks || 0),
                spend: Number(ad.cost || ad.spend || 0), revenue: Number(ad.revenue || 0),
                orders: Number(ad.orders || ad.sales || 0), sku: ad.item_id,
              },
              create: {
                campaignId: adCampaign.id, date: new Date(),
                impressions: Number(ad.impressions || 0), clicks: Number(ad.clicks || 0),
                spend: Number(ad.cost || ad.spend || 0), revenue: Number(ad.revenue || 0),
                orders: Number(ad.orders || ad.sales || 0), sku: ad.item_id, itemId: ad.item_id,
              },
            });
            totalSynced++;
          }
        }
      } catch {
        // Ads por item nao disponiveis
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    return NextResponse.json({
      error: "Erro ao acessar API de Ads do ML: " + String(e),
      debug: debugInfo,
      totalSynced,
      hint: "Verifique se a permissao 'Publicidade de um produto' esta ativada e re-autorize o app",
    });
  }

  return NextResponse.json({ status: "success", totalSynced, debug: debugInfo });
}
