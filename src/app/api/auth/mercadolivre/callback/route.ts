import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken, getUserInfo } from "@/lib/mercadolivre";

// GET /api/auth/mercadolivre/callback?code=xxx
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/contas?error=no_code", request.url));
  }

  try {
    // 1. Troca o code pelo token
    const tokenData = await exchangeCodeForToken(code);

    // 2. Busca info do usuario
    const userInfo = await getUserInfo(tokenData.access_token);

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
        nickname: userInfo.nickname,
        email: userInfo.email,
        isActive: true,
      },
      create: {
        platform: "MERCADO_LIVRE",
        platformId: String(userInfo.id),
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: new Date(Date.now() + tokenData.expires_in * 1000),
        nickname: userInfo.nickname,
        email: userInfo.email,
      },
    });

    return NextResponse.redirect(new URL("/contas?ml_connected=1", request.url));
  } catch (error) {
    console.error("ML OAuth callback error:", error);
    return NextResponse.redirect(
      new URL(`/contas?error=oauth_failed`, request.url)
    );
  }
}
