import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/debug/ads - Testa varios endpoints de ads do ML
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
  const results: Record<string, unknown> = { sellerId };

  // Testa varios endpoints possiveis
  const endpoints = [
    `/users/${sellerId}/advertising/campaigns`,
    `/advertising/campaigns?user_id=${sellerId}`,
    `/advertising/product_ads?user_id=${sellerId}`,
    `/users/${sellerId}/ads/campaigns`,
    `/advertising/product_ads/campaigns?caller.id=${sellerId}`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`https://api.mercadolibre.com${ep}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      results[ep] = { status: res.status, response: typeof data === "object" ? (data.error ? data : { keys: Object.keys(data), sample: JSON.stringify(data).slice(0, 200) }) : data };
    } catch (e) {
      results[ep] = { error: String(e) };
    }
  }

  return NextResponse.json(results);
}
