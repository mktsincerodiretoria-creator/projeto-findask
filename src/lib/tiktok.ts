import crypto from "crypto";

const TIKTOK_AUTH_URL = "https://auth.tiktok-shops.com/oauth/authorize";
const TIKTOK_TOKEN_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
const TIKTOK_REFRESH_URL = "https://auth.tiktok-shops.com/api/v2/token/refresh";
const TIKTOK_API_URL = "https://open-api.tiktokglobalshop.com";

export const TIKTOK_CONFIG = {
  appKey: process.env.TIKTOK_APP_KEY || "",
  appSecret: process.env.TIKTOK_APP_SECRET || "",
  redirectUri: process.env.TIKTOK_REDIRECT_URI || "",
};

// Gera assinatura HMAC-SHA256 para TikTok Shop API
function generateSign(path: string, params: Record<string, string>, appSecret: string): string {
  // Ordena parametros por chave
  const sortedKeys = Object.keys(params).sort();
  const baseString = path + sortedKeys.map(k => k + params[k]).join("");
  return crypto.createHmac("sha256", appSecret).update(baseString).digest("hex");
}

// Gera URL de autorizacao OAuth do TikTok Shop
export function getTikTokAuthUrl(): string {
  const params = new URLSearchParams({
    app_key: TIKTOK_CONFIG.appKey,
    state: "findash",
  });
  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

// Troca code por access_token
export async function exchangeTikTokToken(code: string) {
  const params = new URLSearchParams({
    app_key: TIKTOK_CONFIG.appKey,
    app_secret: TIKTOK_CONFIG.appSecret,
    auth_code: code,
    grant_type: "authorized_code",
  });

  const response = await fetch(`${TIKTOK_TOKEN_URL}?${params.toString()}`);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`TikTok token exchange failed: ${error}`);
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`TikTok token error: ${data.message}`);
  }

  return data.data;
}

// Renova access_token
export async function refreshTikTokToken(refreshToken: string) {
  const params = new URLSearchParams({
    app_key: TIKTOK_CONFIG.appKey,
    app_secret: TIKTOK_CONFIG.appSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(`${TIKTOK_REFRESH_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to refresh TikTok token");
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`TikTok refresh error: ${data.message}`);
  }

  return data.data;
}

// Faz chamada autenticada a API do TikTok Shop
export async function tiktokApiCall(
  path: string,
  accessToken: string,
  shopCipher: string,
  queryParams: Record<string, string> = {},
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const allParams: Record<string, string> = {
    app_key: TIKTOK_CONFIG.appKey,
    timestamp,
    shop_cipher: shopCipher,
    access_token: accessToken,
    ...queryParams,
  };

  const sign = generateSign(path, allParams, TIKTOK_CONFIG.appSecret);
  allParams.sign = sign;

  const url = `${TIKTOK_API_URL}${path}?${new URLSearchParams(allParams).toString()}`;

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (method === "POST" && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`TikTok API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`TikTok API error: ${data.message}`);
  }

  return data.data;
}

// Busca lista de lojas autorizadas
export async function getTikTokShops(accessToken: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = "/authorization/202309/shops";
  const params: Record<string, string> = {
    app_key: TIKTOK_CONFIG.appKey,
    timestamp,
    access_token: accessToken,
  };
  const sign = generateSign(path, params, TIKTOK_CONFIG.appSecret);
  params.sign = sign;

  const url = `${TIKTOK_API_URL}${path}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.code !== 0) throw new Error(`TikTok shops error: ${data.message}`);
  return data.data?.shops || [];
}

// Busca pedidos
export async function getTikTokOrders(
  accessToken: string,
  shopCipher: string,
  pageSize = 50,
  cursor = "",
  createTimeFrom?: number,
  createTimeTo?: number,
) {
  const body: Record<string, unknown> = {
    page_size: pageSize,
  };

  if (cursor) body.cursor = cursor;
  if (createTimeFrom) body.create_time_ge = createTimeFrom;
  if (createTimeTo) body.create_time_lt = createTimeTo;

  return tiktokApiCall(
    "/order/202309/orders/search",
    accessToken,
    shopCipher,
    {},
    "POST",
    body
  );
}

// Busca detalhes de pedidos
export async function getTikTokOrderDetails(
  accessToken: string,
  shopCipher: string,
  orderIds: string[]
) {
  return tiktokApiCall(
    "/order/202309/orders",
    accessToken,
    shopCipher,
    { ids: orderIds.join(",") },
    "GET"
  );
}
