import { NextResponse } from "next/server";
import { getShopeeAuthUrl } from "@/lib/shopee";

// GET /api/auth/shopee - Redireciona para OAuth da Shopee
export async function GET() {
  const authUrl = getShopeeAuthUrl();
  return NextResponse.redirect(authUrl);
}
