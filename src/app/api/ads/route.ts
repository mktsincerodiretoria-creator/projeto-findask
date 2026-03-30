import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
            try {
                          const { searchParams } = request.nextUrl;
                          const platform = searchParams.get("platform");
                          const from = searchParams.get("from");
                          const to = searchParams.get("to");
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const where: any = {};
                          if (platform) where.campaign = { platform };
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
                          const totals = metrics.reduce(
                                          (acc, m) => ({
                                                            impressions: acc.impressions + m.impressions,
                                                            clicks: acc.clicks + m.clicks,
                                                            spend: acc.spend + m.spend,
                                                            revenue: acc.revenue + m.revenue,
                                                            orders: acc.orders + m.orders
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
                                          _sum: { totalAmount: true }
                          });
                          const totalFaturamento = totalRevenue._sum.totalAmount || 0;
                          const tacos = totalFaturamento > 0 ? (totals.spend / totalFaturamento) * 100 : 0;
                          const byCampaign: Record<string, { campaignName: string; platform: string; campaignId: string; spend: number; revenue: number; clicks: number; impressions: number; orders: number }> = {};
                          for (const m of metrics) {
                                          const key = m.campaignId;
                                          if (!byCampaign[key]) byCampaign[key] = { campaignName: m.campaign.campaignName || m.campaign.campaignId, platform: m.campaign.platform, campaignId: m.campaign.campaignId, spend: 0, revenue: 0, clicks: 0, impressions: 0, orders: 0 };
                                          byCampaign[key].spend += m.spend;
                                          byCampaign[key].revenue += m.revenue;
                                          byCampaign[key].clicks += m.clicks;
                                          byCampaign[key].impressions += m.impressions;
                                          byCampaign[key].orders += m.orders;
                          }
                          const bySku: Record<string, { sku: string; spend: number; revenue: number; clicks: number; orders: number }> = {};
                          for (const m of metrics) {
                                          if (!m.sku) continue;
                                          if (!bySku[m.sku]) bySku[m.sku] = { sku: m.sku, spend: 0, revenue: 0, clicks: 0, orders: 0 };
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
                                          daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))
                          });
            } catch (error) {
                          return NextResponse.json({ error: String(error) }, { status: 500 });
            }
}

export async function POST(request: NextRequest) {
            try {
                          const body = await request.json().catch(() => ({}));
                          const platform = body.platform || "MERCADO_LIVRE";
                          if (platform === "MERCADO_LIVRE") return await syncMLAds();
                          return NextResponse.json({ error: "Plataforma nao suportada" }, { status: 400 });
            } catch (error) {
                          return NextResponse.json({ error: String(error) }, { status: 500 });
            }
}

interface RawResult {
            status: number;
            ok: boolean;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

async function rawCall(url: string, token: string, apiVersion?: string): Promise<RawResult> {
            const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
            if (apiVersion) headers["api-version"] = apiVersion;
            try {
                          const res = await fetch(url, { headers });
                          const text = await res.text();
                          let body = text;
                          try { body = JSON.parse(text); } catch { /* nao json */ }
                          return { status: res.status, ok: res.ok, body };
            } catch (e) {
                          return { status: 0, ok: false, body: String(e) };
            }
}

async function getToken() {
            const account = await prisma.account.findFirst({ where: { platform: "MERCADO_LIVRE", isActive: true } });
            if (!account) return null;
            let token = account.accessToken;
            if (account.tokenExpires && account.tokenExpires < new Date()) {
                          if (!account.refreshToken) return null;
                          const nt = await refreshAccessToken(account.refreshToken);
                          token = nt.access_token;
                          await prisma.account.update({
                                          where: { id: account.id },
                                          data: { accessToken: nt.access_token, refreshToken: nt.refresh_token, tokenExpires: new Date(Date.now() + nt.expires_in * 1000) }
                          });
            }
            return { token, account };
}

async function getAdvertiserId(token: string, sellerId: string): Promise<string> {
            // Tenta buscar o advertiser ID correto para este vendedor
  const r = await rawCall(`https://api.mercadolibre.com/advertising/advertisers?user_id=${sellerId}&site_id=MLB`, token);
            if (r.ok && r.body) {
                          // Pode retornar array ou objeto com results
              const list = Array.isArray(r.body) ? r.body : (r.body.results || r.body.advertisers || []);
                          if (list.length > 0) {
                                          return String(list[0].advertiser_id || list[0].id || sellerId);
                          }
                          // Se o body tem advertiser_id diretamente
              if (r.body.advertiser_id) return String(r.body.advertiser_id);
            }
            // Tenta endpoint alternativo
  const r2 = await rawCall(`https://api.mercadolibre.com/advertising/advertisers/${sellerId}`, token);
            if (r2.ok && r2.body && r2.body.id) return String(r2.body.id);
            // Fallback: usa o proprio sellerId
  return sellerId;
}

async function syncMLAds() {
            const auth = await getToken();
            if (!auth) return NextResponse.json({ error: "Sem conta ML conectada ou token expirado. Reconecte a conta." }, { status: 404 });
            const { token, account } = auth;
            const sellerId = account.platformId;
            const BASE = "https://api.mercadolibre.com";
            const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
            const dateTo = new Date().toISOString().split("T")[0];

  // Tenta descobrir o advertiser ID correto
  const advertiserId = await getAdvertiserId(token, sellerId);

  // Testa multiplos endpoints de campanhas do Product Ads
  const [r1, r2, r3, r4, r5, r6] = await Promise.all([
                // Endpoint SEM MLB (confirmado que funciona via debug/ads2)
                                                         rawCall(`${BASE}/marketplace/advertising/advertisers/${advertiserId}/product_ads/campaigns/search`, token, "2"),
                // Endpoint com MLB (fallback)
                rawCall(`${BASE}/marketplace/advertising/MLB/advertisers/${advertiserId}/product_ads/campaigns/search`, token, "2"),
                // Endpoint via users
                rawCall(`${BASE}/users/${sellerId}/advertising/product_ads/v2/campaigns`, token),
                // Endpoint de busca de advertisers
                rawCall(`${BASE}/advertising/advertisers?user_id=${sellerId}&site_id=MLB`, token),
                // Endpoint direto do advertiser
                rawCall(`${BASE}/advertising/advertisers/${advertiserId}`, token),
                // users/me para confirmar token
                rawCall(`${BASE}/users/me`, token),
              ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diag: any = {
                sellerId,
                advertiserId,
                tokenExpira: account.tokenExpires,
                users_me: { status: r6.status, id: r6.body?.id, nickname: r6.body?.nickname },
                advertising_advertisers: { status: r4.status, body: r4.body },
                advertiser_direto: { status: r5.status, body: r5.body },
                campaigns_v2_apiversion: { status: r1.status, body: r1.body },
                campaigns_sem_apiversion: { status: r2.status, body: r2.body },
                campaigns_users_endpoint: { status: r3.status, body: r3.body },
  };

  const results = [
            { label: "v2_apiversion", r: r1 },
            { label: "sem_apiversion", r: r2 },
            { label: "users_endpoint", r: r3 },
              ];

  let campaignData = null;
            let usedEndpoint = "";
            for (const { label, r } of results) {
                          if (r.ok && r.body && (r.body.results || Array.isArray(r.body))) {
                                          campaignData = r.body;
                                          usedEndpoint = label;
                                          break;
                          }
            }

  if (!campaignData) {
                return NextResponse.json({ status: "erro_api_ads", diag });
  }

  diag.endpointUsado = usedEndpoint;
            const campaigns = campaignData.results || (Array.isArray(campaignData) ? campaignData : []);
            let totalSynced = 0;

  for (const camp of campaigns) {
                const campId = String(camp.id || camp.campaign_id);
                if (!campId) continue;
                const campName = camp.name || `Campanha ${campId}`;
                const saved = await prisma.adCampaign.upsert({
                                where: { accountId_campaignId: { accountId: account.id, campaignId: campId } },
                                update: { campaignName: campName, status: camp.status || "unknown" },
                                create: { accountId: account.id, platform: "MERCADO_LIVRE", campaignId: campId, campaignName: campName, status: camp.status || "unknown", dailyBudget: Number(camp.daily_budget || 0) },
                });
                try {
                                const mr = await rawCall(`${BASE}/marketplace/advertising/product_ads/campaigns/${campId}/metrics?date_from=${dateFrom}&date_to=${dateTo}`, token, "2");
                                if (mr.ok && mr.body) {
                                                  const m = mr.body.metrics || mr.body;
                                                  const impressions = Number(m.prints || m.impressions || 0);
                                                  const clicks = Number(m.clicks || 0);
                                                  const spend = Number(m.cost || m.spend || 0);
                                                  const revenue = Number(m.total_amount || m.revenue || m.direct_amount || 0) + Number(m.indirect_amount || 0);
                                                  const orders = Number(m.advertising_items_quantity || m.direct_items_quantity || 0) + Number(m.indirect_items_quantity || 0);
                                                  if (spend > 0 || clicks > 0 || impressions > 0) {
                                                                      await prisma.adMetric.upsert({
                                                                                            where: { campaignId_date: { campaignId: saved.id, date: new Date(dateTo) } },
                                                                                            update: { impressions, clicks, spend, revenue, orders, cpc: clicks > 0 ? spend / clicks : 0, ctr: impressions > 0 ? (clicks / impressions) * 100 : 0, acos: revenue > 0 ? (spend / revenue) * 100 : 0, roas: spend > 0 ? revenue / spend : 0 },
                                                                                            create: { campaignId: saved.id, date: new Date(dateTo), impressions, clicks, spend, revenue, orders, cpc: clicks > 0 ? spend / clicks : 0, ctr: impressions > 0 ? (clicks / impressions) * 100 : 0, acos: revenue > 0 ? (spend / revenue) * 100 : 0, roas: spend > 0 ? revenue / spend : 0 },
                                                                      });
                                                                      totalSynced++;
                                                  }
                                }
                } catch { /* ignora erro de metricas individuais */ }
                await new Promise((r) => setTimeout(r, 200));
  }

  return NextResponse.json({ status: "success", totalSynced, campanhas: campaigns.length, diag });
}

