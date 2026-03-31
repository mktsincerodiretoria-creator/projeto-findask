import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// GET /api/debug/shopee - Testa a geracao de URL da Shopee
export async function GET() {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID || "0");
  const partnerKey = process.env.SHOPEE_PARTNER_KEY || "";
  const redirectUri = process.env.SHOPEE_REDIRECT_URI || "";

  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/shop/auth_partner";

  // Remove prefixo shpk se presente
  const rawKey = partnerKey.startsWith("shpk") ? partnerKey.slice(4) : partnerKey;

  // Gera sign: partner_id + path + timestamp
  const baseString = `${partnerId}${path}${timestamp}`;
  const sign = crypto.createHmac("sha256", rawKey).update(baseString).digest("hex");

  // Testa com a chave COMPLETA (sem remover shpk)
  const signFull = crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");

  const urlWithRawKey = `https://openplatform.shopee.com.br${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectUri)}`;
  const urlWithFullKey = `https://openplatform.shopee.com.br${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${signFull}&redirect=${encodeURIComponent(redirectUri)}`;

  // Testa no host antigo tambem
  const urlOldHost = `https://partner.shopeemobile.com${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectUri)}`;
  const urlOldHostFull = `https://partner.shopeemobile.com${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${signFull}&redirect=${encodeURIComponent(redirectUri)}`;

  // Testa chamada real
  const results: Record<string, unknown> = {
    partnerId,
    partnerKeyLength: partnerKey.length,
    partnerKeyPrefix: partnerKey.slice(0, 8),
    rawKeyLength: rawKey.length,
    timestamp,
    timestampDate: new Date(timestamp * 1000).toISOString(),
    serverTime: new Date().toISOString(),
    baseString,
    sign,
    signFull,
    redirectUri,
  };

  // Testa cada URL
  const urls = [
    { label: "BR_rawKey", url: urlWithRawKey },
    { label: "BR_fullKey", url: urlWithFullKey },
    { label: "Global_rawKey", url: urlOldHost },
    { label: "Global_fullKey", url: urlOldHostFull },
  ];

  for (const { label, url } of urls) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      const status = res.status;
      if (status === 302 || status === 301) {
        results[label] = { status, redirect: res.headers.get("location")?.slice(0, 100), message: "REDIRECT = SUCCESS!" };
      } else {
        const body = await res.text();
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body.slice(0, 200); }
        results[label] = { status, response: parsed };
      }
    } catch (e) {
      results[label] = { error: String(e) };
    }
  }

  return NextResponse.json(results);
}
