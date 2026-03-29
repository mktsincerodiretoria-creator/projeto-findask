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

// Faz uma chamada raw para a API do ML e retorna status + body (sem throw)
async function mlRawCall(endpoint: string, accessToken: string, apiVersion?: string) {
        const headers: Record<string, string> = {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
        };
        if (apiVersion) headers["api-version"] = apiVersion;

  const response = await fetch(`https://api.mercadolibre.com${endpoint}`, { headers });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* nao e json */ }
        return { status: response.status, ok: response.ok, text, json };
}

// Chamada generica para API do ML (lanca erro se nao ok)
async function mlApiCall(endpoint: string, accessToken: string) {
        const r = await mlRawCall(endpoint, accessToken);
        if (!r.ok) throw new Error(`ML API (${r.status}): ${r.text}`);
        return r.json;
}

// Chamada para API de Ads do ML com api-version: 2 (lanca erro se nao ok)
async function mlAdsApiCall(endpoint: string, accessToken: string) {
        const r = await mlRawCall(endpoint, accessToken, "2");
        if (!r.ok) throw new Error(`ML Ads API (${r.status}): ${r.text}`);
        return r.json;
}

async function syncMLAds() {
        const account = await prisma.account.findFirst({
                  where: { platform: "MERCADO_LIVRE", isActive: true },
        });

  if (!account) return NextResponse.json({ error: "Sem conta ML conectada" }, { status: 404 });

  let accessToken = account.accessToken;

  // Renova token se expirado
  if (account.tokenExpires && account.tokenExpires < new Date()) {
            if (!account.refreshToken) return NextResponse.json({ error: "Token expirado e sem refresh token. Reconecte a conta ML." }, { status: 401 });
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diagnostico: any = { sellerId, tokenExpires: account.tokenExpires, etapas: [] };

  // ── ETAPA 1: Verifica token e escopo ──────────────────────────────────────
  const tokenInfo = await mlRawCall(`/oauth/token/introspect`, accessToken);
        diagnostico.etapas.push({ etapa: "token_introspect", status: tokenInfo.status, body: tokenInfo.json || tokenInfo.text });

  // Testa acesso basico ao perfil
  const meInfo = await mlRawCall(`/users/me`, accessToken);
        diagnostico.etapas.push({ etapa: "users_me", status: meInfo.status, userId: meInfo.json?.id });

  // ── ETAPA 2: Testa endpoint de advertisers ────────────────────────────────
  // Formato 1: /marketplace/advertising/advertisers?user_id=X
  const adv1 = await mlRawCall(`/marketplace/advertising/advertisers?user_id=${sellerId}`, accessToken);
        diagnostico.etapas.push({ etapa: "advertisers_by_user_id", status: adv1.status, body: adv1.json || adv1.text });

  // Formato 2: /advertising/advertisers/{sellerId}
  const adv2 = await mlRawCall(`/advertising/advertisers/${sellerId}`, accessToken);
        diagnostico.etapas.push({ etapa: "advertising_direct", status: adv2.status, body: adv2.json || adv2.text });

  // Formato 3: /users/{sellerId}/product_ads
  const adv3 = await mlRawCall(`/users/${sellerId}/product_ads`, accessToken);
        diagnostico.etapas.push({ etapa: "users_product_ads", status: adv3.status, body: adv3.json || adv3.text });

  // ── ETAPA 3: Tenta listar campanhas em varios formatos de endpoint ─────────
  // Endpoint com api-version: 2
  const camp1 = await mlRawCall(`/marketplace/advertising/MLB/advertisers/${sellerId}/product_ads/campaigns/search`, accessToken, "2");
        diagnostico.etapas.push({ etapa: "campaigns_v2_MLB", status: camp1.status, body: camp1.json || camp1.text });

  // Endpoint sem api-version
  const camp2 = await mlRawCall(`/marketplace/advertising/MLB/advertisers/${sellerId}/product_ads/campaigns/search`, accessToken);
        diagnostico.etapas.push({ etapa: "campaigns_no_version", status: camp2.status, body: camp2.json || camp2.text });

  // Endpoint alternativo product_ads/campaigns
  const camp3 = await mlRawCall(`/product_ads/advertisers/${sellerId}/campaigns`, accessToken);
        diagnostico.etapas.push({ etapa: "product_ads_campaigns_alt", status: camp3.status, body: camp3.json || camp3.text });

  // ── ETAPA 4: Se algum endpoint de campanhas funcionou, sincroniza ──────────
  let campaignData = null;
        let workingEndpoint = null;

  for (const [idx, camp] of [[camp1, "v2_MLB"], [camp2, "no_version"], [camp3, "alt"]] as [[typeof camp1, string]]) {
            if (camp.ok && camp.json) {
                        campaignData = camp.json;
                        workingEndpoint = idx;
                        break;
            }
  }

  if (!campaignData) {
            return NextResponse.json({
                        status: "diagnostico",
                        message: "Nenhum endpoint de campanhas funcionou. Veja o diagnostico abaixo para identificar o problema.",
                        diagnostico,
            });
  }

  // Sincroniza campanhas encontradas
  const campaigns = campaignData.results || (Array.isArray(campaignData) ? campaignData : []);
        diagnostico.etapas.push({ etapa: "campaigns_found", endpoint: workingEndpoint, total: campaigns.length });

  const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const dateTo = new Date().toISOString().split("T")[0];
        let totalSynced = 0;

  for (const camp of campaigns) {
            const campId = String(camp.id || camp.campaign_id);
            if (!campId) continue;
            const campName = camp.name || `Campanha ${campId}`;

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

          try {
                      const metricsData = await mlAdsApiCall(
                                    `/marketplace/advertising/product_ads/campaigns/${campId}/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
                                    accessToken
                                  );
                      const m = metricsData.metrics || metricsData;
                      const impressions = Number(m.prints || m.impressions || 0);
                      const clicks = Number(m.clicks || 0);
                      const spend = Number(m.cost || m.spend || 0);
                      const revenue = Number(m.total_amount || m.revenue || m.direct_amount || 0) + Number(m.indirect_amount || 0);
                      const orders = Number(m.advertising_items_quantity || m.direct_items_quantity || 0) + Number(m.indirect_items_quantity || 0);

              if (spend > 0 || clicks > 0 || impressions > 0) {
                            await prisma.adMetric.upsert({
                                            where: { campaignId_date: { campaignId: savedCampaign.id, date: new Date(dateTo) } },
                                            update: { impressions, clicks, spend, revenue, orders, cpc: clicks > 0 ? spend / clicks : 0, ctr: impressions > 0 ? (clicks / impressions) * 100 : 0, acos: revenue > 0 ? (spend / revenue) * 100 : 0, roas: spend > 0 ? revenue / spend : 0 },
                                            create: { campaignId: savedCampaign.id, date: new Date(dateTo), impressions, clicks, spend, revenue, orders, cpc: clicks > 0 ? spend / clicks : 0, ctr: impressions > 0 ? (clicks / impressions) * 100 : 0, acos: revenue > 0 ? (spend / revenue) * 100 : 0, roas: spend > 0 ? revenue / spend : 0 },
                            });
                            totalSynced++;
              }
          } catch (metricsErr) {
                      diagnostico.etapas.push({ etapa: "metrics_error", campaign: campId, err: String(metricsErr) });
          }

          await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({ status: "success", totalSynced, diagnostico });
}
