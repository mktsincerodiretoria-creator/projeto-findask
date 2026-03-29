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
  const endpoints = [
    // Formato v2 com MLB
    { url: `/marketplace/advertising/MLB/advertisers/${sellerId}/product_ads/campaigns/search`, headers: { "api-version": "2" } },
    // Sem o /search
    { url: `/marketplace/advertising/MLB/advertisers/${sellerId}/product_ads/campaigns`, headers: { "api-version": "2" } },
    // Busca o advertiser_id do usuario
    { url: `/marketplace/advertising/MLB/advertisers/${sellerId}`, headers: { "api-version": "2" } },
    // Tenta sem MLB (site_id pode ser diferente)
    { url: `/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search`, headers: { "api-version": "2" } },
    // Tenta endpoint de user info para ver se tem ads
    { url: `/users/${sellerId}`, headers: {} },
    // Tenta pegar info do advertiser
    { url: `/advertising/advertisers/${sellerId}`, headers: {} },
    // Endpoint antigo que pode ainda funcionar
    { url: `/advertising/product_ads/campaigns/${sellerId}`, headers: {} },
    // Tenta listar com caller.id
    { url: `/marketplace/advertising/MLB/product_ads/campaigns/search?user_id=${sellerId}`, headers: { "api-version": "2" } },
  ];

  for (const ep of endpoints) {
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
