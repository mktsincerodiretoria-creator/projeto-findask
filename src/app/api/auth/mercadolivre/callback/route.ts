import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken, getUserInfo } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// GET /api/auth/mercadolivre/callback?code=xxx
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  // ML pode retornar erro direto na URL
  if (error) {
    return NextResponse.redirect(
      new URL(`/contas?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/contas?error=no_code", request.url));
  }

  try {
    // 1. Troca o code pelo token
    const tokenData = await exchangeCodeForToken(code);

    // 2. Busca info do usuario
    const userInfo = await getUserInfo(tokenData.access_token);
    const nickname = String(userInfo.nickname || "");
    const email = String(userInfo.email || "");

    // 3. Salva ou atualiza a conta no banco
    await prisma.account.upsert({
      where: {
        platform_platformId: {
          platform: "MERCADO_LIVRE",
          platformId: String(userInfo.id),
        },
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + tokenData.expires_in * 1000),
        nickname,
        email,
        isActive: true,
      },
      create: {
        platform: "MERCADO_LIVRE",
        platformId: String(userInfo.id),
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + tokenData.expires_in * 1000),
        nickname,
        email,
      },
    });

    return NextResponse.redirect(new URL("/contas?ml_connected=1", request.url));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("ML OAuth callback error:", errorMsg);
    return NextResponse.redirect(
      new URL(`/contas?error=${encodeURIComponent(errorMsg)}`, request.url)
    );
  }
}
