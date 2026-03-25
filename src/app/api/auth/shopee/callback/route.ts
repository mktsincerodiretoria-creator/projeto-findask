import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeShopeeToken, getShopInfo } from "@/lib/shopee";

export const dynamic = "force-dynamic";

// GET /api/auth/shopee/callback?code=xxx&shop_id=xxx
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const shopId = request.nextUrl.searchParams.get("shop_id");

  if (!code || !shopId) {
    return NextResponse.redirect(new URL("/contas?error=shopee_no_code", request.url));
  }

  try {
    // 1. Troca code pelo token
    const tokenData = await exchangeShopeeToken(code, Number(shopId));

    if (tokenData.error) {
      throw new Error(tokenData.message || tokenData.error);
    }

    // 2. Busca info da loja
    let shopName = shopId;
    try {
      const shopInfo = await getShopInfo(tokenData.access_token, Number(shopId));
      shopName = shopInfo.response?.shop_name || shopId;
    } catch {
      // Nome da loja nao obrigatorio
    }

    // 3. Salva ou atualiza conta
    await prisma.account.upsert({
      where: {
        platform_platformId: {
          platform: "SHOPEE",
          platformId: String(shopId),
        },
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + (tokenData.expire_in || 14400) * 1000),
        nickname: String(shopName),
        isActive: true,
      },
      create: {
        platform: "SHOPEE",
        platformId: String(shopId),
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + (tokenData.expire_in || 14400) * 1000),
        nickname: String(shopName),
      },
    });

    return NextResponse.redirect(new URL("/contas?shopee_connected=1", request.url));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("Shopee OAuth callback error:", errorMsg);
    return NextResponse.redirect(
      new URL(`/contas?error=${encodeURIComponent("Shopee: " + errorMsg)}`, request.url)
    );
  }
}
