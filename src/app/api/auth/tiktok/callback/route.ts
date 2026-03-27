import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeTikTokToken, getTikTokShops } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// GET /api/auth/tiktok/callback?code=xxx
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/contas?error=tiktok_no_code", request.url));
  }

  try {
    // 1. Troca code pelo token
    const tokenData = await exchangeTikTokToken(code);

    // 2. Busca lojas autorizadas
    const shops = await getTikTokShops(tokenData.access_token);

    // 3. Salva cada loja como conta
    for (const shop of shops) {
      await prisma.account.upsert({
        where: {
          platform_platformId: {
            platform: "TIKTOK_SHOP",
            platformId: String(shop.id),
          },
        },
        update: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpires: new Date(Date.now() + (tokenData.access_token_expire_in || 86400) * 1000),
          nickname: shop.name || shop.code || String(shop.id),
          isActive: true,
        },
        create: {
          platform: "TIKTOK_SHOP",
          platformId: String(shop.id),
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpires: new Date(Date.now() + (tokenData.access_token_expire_in || 86400) * 1000),
          nickname: shop.name || shop.code || String(shop.id),
        },
      });
    }

    return NextResponse.redirect(new URL("/contas?tiktok_connected=1", request.url));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("TikTok OAuth error:", errorMsg);
    return NextResponse.redirect(
      new URL(`/contas?error=${encodeURIComponent("TikTok: " + errorMsg)}`, request.url)
    );
  }
}
