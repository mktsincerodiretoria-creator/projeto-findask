import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/debug - Verifica configuracao (remover em producao)
export async function GET() {
  const mlClientId = process.env.ML_CLIENT_ID || "";
  const mlRedirectUri = process.env.ML_REDIRECT_URI || "";
  const dbUrl = process.env.DATABASE_URL || "";

  return NextResponse.json({
    ml_client_id: mlClientId ? `${mlClientId.slice(0, 6)}...` : "NAO CONFIGURADO",
    ml_client_secret: process.env.ML_CLIENT_SECRET ? "CONFIGURADO" : "NAO CONFIGURADO",
    ml_redirect_uri: mlRedirectUri || "NAO CONFIGURADO",
    database_url: dbUrl ? `${dbUrl.slice(0, 30)}...` : "NAO CONFIGURADO",
    anthropic_api_key: process.env.ANTHROPIC_API_KEY ? "CONFIGURADO" : "NAO CONFIGURADO",
    gemini_api_key: process.env.GEMINI_API_KEY ? "CONFIGURADO" : "NAO CONFIGURADO",
    node_env: process.env.NODE_ENV,
  });
}
