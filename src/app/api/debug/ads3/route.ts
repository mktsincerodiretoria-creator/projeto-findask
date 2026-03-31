import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/debug/ads3 - Testa endpoints de metricas de ads do ML
export async function GET() {
  const account = await prisma.account.findFirst({
    where: { platform: "MERCADO_LIVRE", isActive: true },
  });
  if (!account) return NextResponse.json({ error: "Sem conta ML" });

  let accessToken = account.accessToken;
  if (account.refreshToken) {
    try {
      const newToken = await refreshAccessToken(account.refreshToken);
      accessToken = newToken.access_token;
      await prisma.account.update({
        where: { id: account.id },
        data: { accessToken: newToken.access_token, refreshToken: newToken.refresh_token || account.refreshToken, tokenExpires: new Date(Date.now() + (newToken.expires_in || 21600) * 1000) },
      });
    } catch { /* usa token atual */ }
  }

  const sellerId = account.platformId;
  const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const dateTo = new Date().toISOString().split("T")[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = { sellerId };

  const endpoints = [
    // Metricas agregadas do usuario
    `/users/${sellerId}/advertising/product_ads/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
    // Metricas via marketplace/advertising
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
    // Metricas com api-version 2
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/metrics`,
    // Ads search (lista anuncios ativos)
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/ads/search`,
    // Metricas por anuncio
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/ads/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
    // Campaigns com metricas embutidas
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search?include_metrics=true`,
    // Budget do usuario
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/budget`,
    // Status geral
    `/marketplace/advertising/advertisers/${sellerId}/product_ads/status`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`https://api.mercadolibre.com${ep}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "api-version": "2",
        },
      });
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
      results[ep] = {
        status: res.status,
        data: res.status === 200 ? (typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 500) : parsed) : parsed,
      };
    } catch (e) {
      results[ep] = { error: String(e) };
    }
  }

  return NextResponse.json(results);
}
