import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/mercadolivre";

// GET /api/auth/mercadolivre - Redireciona para OAuth do ML
export async function GET() {
  const authUrl = getAuthUrl();
  return NextResponse.redirect(authUrl);
}
