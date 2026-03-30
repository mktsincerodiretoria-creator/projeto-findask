import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/debug/ads2 - Testa endpoints de ads com diferentes formatos
export async function GET() {
  const account = await prisma.account.findFirst({
    where: { platform: "MERCADO_LIVRE", isActive: true },
  });
  if (!account) return NextResponse.json({ error: "Sem conta ML" });

  let accessToken = account.accessToken;
  if (account.tokenExpires && account.tokenExpires < new Date() && account.refreshToken) {
    const newToken = await refreshAccessToken(account.refreshToken);
    accessToken = newToken.access_token;
    await prisma.account.update({
      where: { id: account.id },
      data: { accessToken: newToken.access_token, refreshToken: newToken.refresh_token, tokenExpires: new Date(Date.now() + newToken.expires_in * 1000) },
    });
  }

  const sellerId = account.platformId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = { sellerId };

  // Primeiro: descobre se o usuario tem acesso a ads
  // Testa o endpoint que retornou 200 com diferentes parametros
  const workingEndpoints = [
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search`, headers: { "api-version": "2" } },
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search?status=active`, headers: { "api-version": "2" } },
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search?limit=50`, headers: { "api-version": "2" } },
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search?status=active&limit=50`, headers: {} },
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/ads/search`, headers: { "api-version": "2" } },
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/ads/search?limit=10`, headers: { "api-version": "2" } },
  ];

  for (const ep of workingEndpoints) {
    try {
      const hdrs: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        };
        if (ep.headers["api-version"]) hdrs["api-version"] = ep.headers["api-version"];
        const res = await fetch(`https://api.mercadolibre.com${ep.url}`, { headers: hdrs });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
      results[ep.url] = {
        status: res.status,
        response: typeof data === "object" ? (
          data.error ? data :
          Array.isArray(data) ? { count: data.length, sample: data[0] } :
          { keys: Object.keys(data).slice(0, 10), sample: JSON.stringify(data).slice(0, 300) }
        ) : data,
      };
    } catch (e) {
      results[ep.url] = { error: String(e) };
    }
  }

  return NextResponse.json(results);
}
