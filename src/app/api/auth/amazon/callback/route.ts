import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeAmazonToken } from "@/lib/amazon";

export const dynamic = "force-dynamic";

// GET /api/auth/amazon/callback?spapi_oauth_code=xxx&selling_partner_id=xxx
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("spapi_oauth_code");
  const sellingPartnerId = request.nextUrl.searchParams.get("selling_partner_id");

  if (!code) {
    return NextResponse.redirect(new URL("/contas?error=amazon_no_code", request.url));
  }

  try {
    const tokenData = await exchangeAmazonToken(code);

    await prisma.account.upsert({
      where: {
        platform_platformId: {
          platform: "AMAZON",
          platformId: sellingPartnerId || "amazon_br",
        },
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
        isActive: true,
      },
      create: {
        platform: "AMAZON",
        platformId: sellingPartnerId || "amazon_br",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
        nickname: `Amazon BR (${sellingPartnerId || "importado"})`,
      },
    });

    return NextResponse.redirect(new URL("/contas?amazon_connected=1", request.url));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("Amazon OAuth error:", errorMsg);
    return NextResponse.redirect(
      new URL(`/contas?error=${encodeURIComponent("Amazon: " + errorMsg)}`, request.url)
    );
  }
}
