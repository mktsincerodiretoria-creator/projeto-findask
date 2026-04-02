import crypto from "crypto";

// Hosts da Shopee
const SHOPEE_HOST = "https://partner.shopeemobile.com";
const SHOPEE_AUTH_PATH = "/api/v2/shop/auth_partner";
const SHOPEE_TOKEN_PATH = "/api/v2/auth/token/get";
const SHOPEE_REFRESH_PATH = "/api/v2/auth/access_token/get";

export const SHOPEE_CONFIG = {
  partnerId: Number(process.env.SHOPEE_PARTNER_ID || "0"),
  partnerKey: process.env.SHOPEE_PARTNER_KEY || "",
  redirectUri: process.env.SHOPEE_REDIRECT_URI || "",
};

// Gera assinatura HMAC-SHA256 - usa chave COMPLETA (com shpk)
function generatePublicSign(partnerId: number, path: string, timestamp: number): string {
  const baseString = `${partnerId}${path}${timestamp}`;
  return crypto.createHmac("sha256", SHOPEE_CONFIG.partnerKey).update(baseString).digest("hex");
}

function generateShopSign(partnerId: number, path: string, timestamp: number, accessToken: string, shopId: number): string {
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", SHOPEE_CONFIG.partnerKey).update(baseString).digest("hex");
}

export function getShopeeAuthUrl(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generatePublicSign(SHOPEE_CONFIG.partnerId, SHOPEE_AUTH_PATH, timestamp);
  const params = new URLSearchParams({
    partner_id: String(SHOPEE_CONFIG.partnerId),
    timestamp: String(timestamp),
    sign,
    redirect: SHOPEE_CONFIG.redirectUri,
  });
  return `${SHOPEE_HOST}${SHOPEE_AUTH_PATH}?${params.toString()}`;
}

export async function exchangeShopeeToken(code: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generatePublicSign(SHOPEE_CONFIG.partnerId, SHOPEE_TOKEN_PATH, timestamp);
  const url = `${SHOPEE_HOST}${SHOPEE_TOKEN_PATH}?partner_id=${SHOPEE_CONFIG.partnerId}&timestamp=${timestamp}&sign=${sign}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, shop_id: shopId, partner_id: SHOPEE_CONFIG.partnerId }),
  });
  if (!response.ok) { const e = await response.text(); throw new Error(`Shopee token failed: ${e}`); }
  return response.json();
}

export async function refreshShopeeToken(refreshToken: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generatePublicSign(SHOPEE_CONFIG.partnerId, SHOPEE_REFRESH_PATH, timestamp);
  const url = `${SHOPEE_HOST}${SHOPEE_REFRESH_PATH}?partner_id=${SHOPEE_CONFIG.partnerId}&timestamp=${timestamp}&sign=${sign}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken, shop_id: shopId, partner_id: SHOPEE_CONFIG.partnerId }),
  });
  if (!response.ok) throw new Error("Failed to refresh Shopee token");
  return response.json();
}

export async function shopeeApiCall(path: string, accessToken: string, shopId: number, params: Record<string, string | number> = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateShopSign(SHOPEE_CONFIG.partnerId, path, timestamp, accessToken, shopId);
  const queryParams = new URLSearchParams({
    partner_id: String(SHOPEE_CONFIG.partnerId), timestamp: String(timestamp),
    access_token: accessToken, shop_id: String(shopId), sign,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const url = `${SHOPEE_HOST}${path}?${queryParams.toString()}`;
  const response = await fetch(url);
  if (!response.ok) { const e = await response.text(); throw new Error(`Shopee API error (${response.status}): ${e}`); }
  const data = await response.json();
  if (data.error) throw new Error(`Shopee: ${data.error} - ${data.message}`);
  return data;
}

export async function getShopInfo(accessToken: string, shopId: number) {
  return shopeeApiCall("/api/v2/shop/get_shop_info", accessToken, shopId);
}

export async function getShopeeOrders(accessToken: string, shopId: number, timeFrom: number, timeTo: number, cursor = "", pageSize = 50) {
  const params: Record<string, string | number> = { time_range_field: "create_time", time_from: timeFrom, time_to: timeTo, page_size: pageSize, response_optional_fields: "order_status" };
  if (cursor) params.cursor = cursor;
  return shopeeApiCall("/api/v2/order/get_order_list", accessToken, shopId, params);
}

export async function getShopeeOrderDetails(accessToken: string, shopId: number, orderSnList: string[]) {
  return shopeeApiCall("/api/v2/order/get_order_detail", accessToken, shopId, {
    order_sn_list: orderSnList.join(","),
    response_optional_fields: "buyer_user_id,buyer_username,estimated_shipping_fee,actual_shipping_fee,item_list,pay_time,total_amount,order_income",
  });
}

export async function getShopeeOrderIncome(accessToken: string, shopId: number, orderSn: string) {
  return shopeeApiCall("/api/v2/payment/get_escrow_detail", accessToken, shopId, { order_sn: orderSn });
}

export async function getShopeeItems(accessToken: string, shopId: number, offset = 0, pageSize = 50) {
  return shopeeApiCall("/api/v2/product/get_item_list", accessToken, shopId, { offset, page_size: pageSize, item_status: "NORMAL" });
}
