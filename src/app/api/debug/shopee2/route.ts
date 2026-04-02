import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID || "0");
  const partnerKey = process.env.SHOPEE_PARTNER_KEY || "";
  const redirect = process.env.SHOPEE_REDIRECT_URI || "";
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/shop/auth_partner";

  // Chave sem prefixo shpk
  const rawKey = partnerKey.startsWith("shpk") ? partnerKey.slice(4) : partnerKey;

  // Base strings diferentes
  const base1 = `${partnerId}${path}${timestamp}`;

  // 4 combinacoes de sign
  const signFullKey = crypto.createHmac("sha256", partnerKey).update(base1).digest("hex");
  const signRawKey = crypto.createHmac("sha256", rawKey).update(base1).digest("hex");

  const hosts = ["https://partner.shopeemobile.com", "https://openplatform.shopee.com.br"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = {
    partnerId,
    keyLength: partnerKey.length,
    keyPrefix: partnerKey.slice(0, 8),
    rawKeyLength: rawKey.length,
    timestamp,
    base1,
  };

  for (const host of hosts) {
    for (const [label, sign] of [["fullKey", signFullKey], ["rawKey", signRawKey]]) {
      const url = `${host}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirect)}`;
      try {
        const res = await fetch(url, { redirect: "manual" });
        const status = res.status;
        if (status === 302 || status === 301) {
          results[`${host.split("//")[1].split(".")[0]}_${label}`] = { status, redirect: res.headers.get("location")?.slice(0, 150), SUCCESS: true };
        } else {
          const body = await res.text();
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = body.slice(0, 200); }
          results[`${host.split("//")[1].split(".")[0]}_${label}`] = { status, response: parsed };
        }
      } catch (e) {
        results[`${host.split("//")[1].split(".")[0]}_${label}`] = { error: String(e) };
      }
    }
  }

  return NextResponse.json(results);
}
