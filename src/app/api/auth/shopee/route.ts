import { NextResponse } from "next/server";
import { getShopeeAuthUrl } from "@/lib/shopee";

export const dynamic = "force-dynamic";

// GET /api/auth/shopee - Redireciona para OAuth da Shopee
export async function GET() {
  const authUrl = getShopeeAuthUrl();
  return NextResponse.redirect(authUrl);
}
