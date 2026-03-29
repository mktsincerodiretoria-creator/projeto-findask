import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/ads - Busca metricas de ads agregadas
export async function GET(request: NextRequest) {
    try {
          const { searchParams } = request.nextUrl;
          const platform = searchParams.get("platform");
          const from = searchParams.get("from");
          const to = searchParams.get("to");

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
              include: {
                        campaign: {
                                    select: { campaignName: true, platform: true, campaignId: true }
                        }
              },
              orderBy: { date: "desc" },
      });

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

      const bySku: Record<string, { sku: string; spend: number; revenue: number; clicks: number; orders: number }> = {};
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

// Chamada generica para API do ML
async function mlApiCall(endpoint: string, accessToken: string) {
    const response = await fetch(`https://api.mercadolibre.com${endpoint}`, {
          headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
          },
    });
    if (!response.ok) {
          const error = await response.text();
          throw new Error(`ML API (${response.status}): ${error}`);
    }
    return response.json();
}

// Chamada especifica para API de Ads do ML (requer header api-version: 2)
async function mlAdsApiCall(endpoint: string, accessToken: string) {
    const response = await fetch(`https://api.mercadolibre.com${endpoint}`, {
          headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                  "api-version": "2",
          },
    });
    if (!response.ok) {
          const error = await response.text();
          throw new Error(`ML Ads API (${response.status}): ${error}`);
    }
    return response.json();
}

// Busca o advertiser_id correto para o usuario na API de Ads do ML
async function getMLAdvertiserId(sellerId: string, accessToken: string): Promise<string> {
    try {
          // Tenta buscar via endpoint de advertisers por user_id
      const data = await mlApiCall(
              `/marketplace/advertising/advertisers?user_id=${sellerId}`,
              accessToken
            );
          const results = data.results || (Array.isArray(data) ? data : []);
          if (results.length > 0) {
                  return String(results[0].id || results[0].advertiser_id || sellerId);
          }
    } catch {
          // Fallback: tenta endpoint direto do advertiser
      try {
              const data = await mlApiCall(
                        `/marketplace/advertising/advertisers/${sellerId}`,
                        accessToken
                      );
              if (data.id || data.advertiser_id) {
                        return String(data.id || data.advertiser_id);
              }
      } catch {
              // Se nenhum endpoint funcionar, usa o proprio sellerId como fallback
      }
    }
    return sellerId;
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
    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const dateTo = new Date().toISOString().split("T")[0];

  let totalSynced = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugInfo: any[] = [];

  try {
        // Passo 1: Busca o advertiser_id correto (pode ser diferente do user_id/sellerId)
      const advertiserId = await getMLAdvertiserId(sellerId, accessToken);
        debugInfo.push({ sellerId, advertiserId });

      // Passo 2: Busca campanhas usando o advertiser_id correto
      const campaignsData = await mlAdsApiCall(
              `/marketplace/advertising/MLB/advertisers/${advertiserId}/product_ads/campaigns/search`,
              accessToken
            );

      const campaigns = campaignsData.results || (Array.isArray(campaignsData) ? campaignsData : []);
        debugInfo.push({ campaignsFound: campaigns.length });

      for (const camp of campaigns) {
              const campId = String(camp.id || camp.campaign_id);
              if (!campId) continue;

          const campName = camp.name || `Campanha ${campId}`;
              const campMetrics = camp.metrics || camp.metrics_summary || {};

          const savedCampaign = await prisma.adCampaign.upsert({
                    where: { accountId_campaignId: { accountId: account.id, campaignId: campId } },
                    update: { campaignName: campName, status: camp.status || "unknown" },
                    create: {
                                accountId: account.id,
                                platform: "MERCADO_LIVRE",
                                campaignId: campId,
                                campaignName: campName,
                                status: camp.status || "unknown",
                                dailyBudget: Number(camp.daily_budget || camp.budget || 0),
                    },
          });

          // Busca metricas detalhadas da campanha
          try {
                    const metricsData = await mlAdsApiCall(
                                `/marketplace/advertising/product_ads/campaigns/${campId}/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
                                accessToken
                              );
                    const m = metricsData.metrics || metricsData;
                    const impressions = Number(m.prints || m.impressions || 0);
                    const clicks = Number(m.clicks || 0);
                    const spend = Number(m.cost || m.spend || 0);
                    const revenue =
                                Number(m.total_amount || m.revenue || m.direct_amount || 0) +
                                Number(m.indirect_amount || 0);
                    const orders =
                                Number(m.advertising_items_quantity || m.direct_items_quantity || 0) +
                                Number(m.indirect_items_quantity || 0);

                if (spend > 0 || clicks > 0 || impressions > 0) {
                            await prisma.adMetric.upsert({
                                          where: { campaignId_date: { campaignId: savedCampaign.id, date: new Date(dateTo) } },
                                          update: {
                                                          impressions, clicks, spend, revenue, orders,
                                                          cpc: clicks > 0 ? spend / clicks : 0,
                                                          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                                                          acos: revenue > 0 ? (spend / revenue) * 100 : 0,
                                                          roas: spend > 0 ? revenue / spend : 0,
                                          },
                                          create: {
                                                          campaignId: savedCampaign.id,
                                                          date: new Date(dateTo),
                                                          impressions, clicks, spend, revenue, orders,
                                                          cpc: clicks > 0 ? spend / clicks : 0,
                                                          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                                                          acos: revenue > 0 ? (spend / revenue) * 100 : 0,
                                                          roas: spend > 0 ? revenue / spend : 0,
                                          },
                            });
                            totalSynced++;
                }
          } catch (metricsErr) {
                    if (campMetrics && (campMetrics.clicks > 0 || campMetrics.cost > 0)) {
                                const impressions = Number(campMetrics.prints || 0);
                                const clicks = Number(campMetrics.clicks || 0);
                                const spend = Number(campMetrics.cost || 0);
                                const revenue = Number(campMetrics.total_amount || 0);
                                const orders = Number(campMetrics.advertising_items_quantity || 0);
                                await prisma.adMetric.upsert({
                                              where: { campaignId_date: { campaignId: savedCampaign.id, date: new Date(dateTo) } },
                                              update: {
                                                              impressions, clicks, spend, revenue, orders,
                                                              cpc: clicks > 0 ? spend / clicks : 0,
                                                              acos: revenue > 0 ? (spend / revenue) * 100 : 0,
                                                              roas: spend > 0 ? revenue / spend : 0,
                                              },
                                              create: {
                                                              campaignId: savedCampaign.id,
                                                              date: new Date(dateTo),
                                                              impressions, clicks, spend, revenue, orders,
                                                              cpc: clicks > 0 ? spend / clicks : 0,
                                                              acos: revenue > 0 ? (spend / revenue) * 100 : 0,
                                                              roas: spend > 0 ? revenue / spend : 0,
                                              },
                                });
                                totalSynced++;
                    }
                    debugInfo.push({ campaign: campId, metricsErr: String(metricsErr) });
          }

          // Busca ads por item com metricas
          try {
                    const adsData = await mlAdsApiCall(
                                `/marketplace/advertising/product_ads/campaigns/${campId}/ads/metrics?date_from=${dateFrom}&date_to=${dateTo}&offset=0&limit=100`,
                                accessToken
                              );
                    const ads = adsData.results || (Array.isArray(adsData) ? adsData : []);
                    for (const ad of ads) {
                                const itemId = ad.item_id || ad.id;
                                if (!itemId) continue;
                                const adMetrics = ad.metrics || ad.metrics_summary || ad;
                                const adSpend = Number(adMetrics.cost || adMetrics.spend || 0);
                                const adClicks = Number(adMetrics.clicks || 0);
                                const adImpressions = Number(adMetrics.prints || adMetrics.impressions || 0);
                                const adRevenue = Number(adMetrics.total_amount || adMetrics.revenue || 0);
                                const adOrders = Number(adMetrics.advertising_items_quantity || adMetrics.orders || 0);

                      if (adSpend > 0 || adClicks > 0) {
                                    const adCampId = `${campId}-${itemId}`;
                                    const adCampaign = await prisma.adCampaign.upsert({
                                                    where: { accountId_campaignId: { accountId: account.id, campaignId: adCampId } },
                                                    update: { campaignName: `${campName} | ${ad.title || itemId}` },
                                                    create: {
                                                                      accountId: account.id,
                                                                      platform: "MERCADO_LIVRE",
                                                                      campaignId: adCampId,
                                                                      campaignName: `${campName} | ${ad.title || itemId}`,
                                                                      status: ad.status || "active",
                                                    },
                                    });
                                    await prisma.adMetric.upsert({
                                                    where: { campaignId_date: { campaignId: adCampaign.id, date: new Date(dateTo) } },
                                                    update: {
                                                                      impressions: adImpressions, clicks: adClicks, spend: adSpend,
                                                                      revenue: adRevenue, orders: adOrders, sku: itemId, itemId,
                                                    },
                                                    create: {
                                                                      campaignId: adCampaign.id,
                                                                      date: new Date(dateTo),
                                                                      impressions: adImpressions, clicks: adClicks, spend: adSpend,
                                                                      revenue: adRevenue, orders: adOrders, sku: itemId, itemId,
                                                    },
                                    });
                                    totalSynced++;
                      }
                    }
          } catch {
                    // Ads por item nao disponiveis para esta campanha
          }

          await new Promise((r) => setTimeout(r, 300));
      }
  } catch (e) {
        return NextResponse.json({
                error: "Erro ao acessar API de Ads: " + String(e),
                debug: debugInfo,
                totalSynced,
        });
  }

  return NextResponse.json({ status: "success", totalSynced, debug: debugInfo });
}
