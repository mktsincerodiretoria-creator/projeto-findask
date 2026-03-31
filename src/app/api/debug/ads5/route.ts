import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await prisma.account.findMany({
    where: { platform: "MERCADO_LIVRE", isActive: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = {};

  for (const account of accounts) {
    let accessToken = String(account.accessToken);
    if (account.refreshToken) {
      try {
        const newToken = await refreshAccessToken(account.refreshToken);
        accessToken = String(newToken.access_token);
      } catch { /* */ }
    }

    const sellerId = account.platformId;
    const dateFrom = "2025-12-29";
    const dateTo = new Date().toISOString().split("T")[0];

    const url = `https://api.mercadolibre.com/marketplace/advertising/advertisers/${sellerId}/product_ads/campaigns/search?metrics_summary=true&metrics=clicks,prints,cost,cpc,acos,roas,total_amount,direct_amount,indirect_amount,advertising_items_quantity&date_from=${dateFrom}&date_to=${dateTo}`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "api-version": "2" },
      });
      const fullText = await res.text();
      results[String(account.nickname || sellerId)] = {
        status: res.status,
        contentLength: fullText.length,
        fullResponse: fullText.slice(0, 2000),
      };
    } catch (e) {
      results[String(account.nickname || sellerId)] = { error: String(e) };
    }
  }

  return NextResponse.json(results);
}
