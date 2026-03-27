import { NextResponse } from "next/server";
import { getTikTokAuthUrl } from "@/lib/tiktok";

// GET /api/auth/tiktok - Redireciona para OAuth do TikTok Shop
export async function GET() {
  const authUrl = getTikTokAuthUrl();
  return NextResponse.redirect(authUrl);
}
