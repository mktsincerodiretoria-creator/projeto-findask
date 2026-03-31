import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/debug/ads4 - Testa endpoints CORRETOS de ads com metricas
export async function GET() {
  // Busca TODAS as contas ML
  const accounts = await prisma.account.findMany({
    where: { platform: "MERCADO_LIVRE", isActive: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allResults: Record<string, any> = {};

  for (const account of accounts) {
    let accessToken = account.accessToken;
    if (account.refreshToken) {
      try {
        const newToken = await refreshAccessToken(account.refreshToken);
        accessToken = newToken.access_token;
        await prisma.account.update({
          where: { id: account.id },
          data: { accessToken: newToken.access_token, refreshToken: newToken.refresh_token || account.refreshToken, tokenExpires: new Date(Date.now() + 21600000) },
        });
      } catch { /* usa atual */ }
    }

    const sellerId = account.platformId;
    const dateFrom = "2025-12-29";
    const dateTo = new Date().toISOString().split("T")[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: Record<string, any> = {};

    const endpoints = [
      // Formato COMPLETO com MLB + metrics_summary
      `/marketplace/advertising/MLB/advertisers/${sellerId}/product_ads/campaigns/search?metrics_summary=true&metrics=clicks,prints,cost,cpc,acos,roas,total_amount,direct_amount,indirect_amount,advertising_items_quantity&date_from=${dateFrom}&date_to=${dateTo}`,
      // Sem MLB + metrics_summary
      `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search?metrics_summary=true&metrics=clicks,prints,cost,cpc,acos,roas,total_amount&date_from=${dateFrom}&date_to=${dateTo}`,
      // Endpoint de ads por item com metricas
      `/marketplace/advertising/MLB/advertisers/${sellerId}/product_ads/ads/search?metrics_summary=true&metrics=clicks,prints,cost,total_amount&date_from=${dateFrom}&date_to=${dateTo}`,
      // Sem MLB ads search
      `/marketplace/advertising/advertisers/${sellerId}/product_ads/ads/search?metrics_summary=true&metrics=clicks,prints,cost,total_amount&date_from=${dateFrom}&date_to=${dateTo}`,
      // Metrica de campanha especifica (se tiver campaign_id)
      `/marketplace/advertising/MLB/product_ads/campaigns/search?filters[advertiser_id]=${sellerId}&metrics_summary=true&date_from=${dateFrom}&date_to=${dateTo}`,
    ];

    for (const ep of endpoints) {
      try {
        // Testa com e sem api-version header
        for (const apiVer of ["2", ""]) {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          };
          if (apiVer) headers["api-version"] = apiVer;

          const key = apiVer ? `${ep} [v${apiVer}]` : `${ep} [no-ver]`;
          const res = await fetch(`https://api.mercadolibre.com${ep}`, { headers });
          const text = await res.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }

          if (res.status === 200 && text.length > 5) {
            results[key] = { status: res.status, hasData: text.length > 10, dataPreview: JSON.stringify(parsed).slice(0, 600) };
          } else {
            results[key] = { status: res.status, error: typeof parsed === "object" ? parsed.error || parsed.message : String(parsed).slice(0, 100) };
          }
        }
      } catch (e) {
        results[ep] = { error: String(e) };
      }
    }

    allResults[`${account.nickname || sellerId}`] = results;
  }

  return NextResponse.json(allResults);
}
