import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function rawCall(url: string, token: string, apiVersion?: string) {
    const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
    if (apiVersion) headers["api-version"] = apiVersion;
    try {
          const res = await fetch(url, { headers });
          const text = await res.text();
          let json = null;
          try { json = JSON.parse(text); } catch { /* nao json */ }
          return { status: res.status, ok: res.ok, body: json ?? text };
        } catch (e) {
          return { status: 0, ok: false, body: String(e) };
        }
  }

export async function GET() {
    const account = await prisma.account.findFirst({
          where: { platform: "MERCADO_LIVRE", isActive: true },
        });
    if (!account) return NextResponse.json({ erro: "Sem conta ML" }, { status: 404 });

    let token = account.accessToken;
    if (account.tokenExpires && account.tokenExpires < new Date()) {
          if (!account.refreshToken) return NextResponse.json({ erro: "Token expirado sem refresh" });
          const nt = await refreshAccessToken(account.refreshToken);
          token = nt.access_token;
          await prisma.account.update({
                  where: { id: account.id },
                  data: { accessToken: nt.access_token, refreshToken: nt.refresh_token, tokenExpires: new Date(Date.now() + nt.expires_in * 1000) },
                });
        }

    const id = account.platformId;
    const BASE = "https://api.mercadolibre.com";

    const resultados = await Promise.all([
          rawCall(`${BASE}/users/me`, token).then(r => ({ teste: "users_me", ...r })),
          rawCall(`${BASE}/users/${id}/advertising/product_ads/v2/campaigns`, token).then(r => ({ teste: "users_campaigns_v2", ...r })),
          rawCall(`${BASE}/marketplace/advertising/MLB/advertisers/${id}/product_ads/campaigns/search`, token, "2").then(r => ({ teste: "marketplace_ads_v2", ...r })),
          rawCall(`${BASE}/marketplace/advertising/MLB/advertisers/${id}/product_ads/campaigns/search`, token).then(r => ({ teste: "marketplace_ads_sem_version", ...r })),
          rawCall(`${BASE}/advertising/advertisers?user_id=${id}`, token).then(r => ({ teste: "advertising_advertisers", ...r })),
          rawCall(`${BASE}/advertising/advertisers/${id}`, token).then(r => ({ teste: "advertising_advertiser_direto", ...r })),
          rawCall(`${BASE}/product_ads/advertisers/${id}/campaigns`, token).then(r => ({ teste: "product_ads_alt", ...r })),
          rawCall(`${BASE}/users/${id}/product_ads/v1/campaigns`, token).then(r => ({ teste: "product_ads_v1", ...r })),
        ]);

    return NextResponse.json({
          sellerId: id,
          tokenExpira: account.tokenExpires,
          resultados,
        });
  }

