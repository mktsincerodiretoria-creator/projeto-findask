import { NextResponse } from "next/server";
import { getAmazonAuthUrl } from "@/lib/amazon";

// GET /api/auth/amazon - Redireciona para OAuth da Amazon
export async function GET() {
  const authUrl = getAmazonAuthUrl();
  return NextResponse.redirect(authUrl);
}
