import crypto from "crypto";

const SHOPEE_API_URL = "https://partner.shopeemobile.com";
const SHOPEE_AUTH_PATH = "/api/v2/shop/auth_partner";
const SHOPEE_TOKEN_PATH = "/api/v2/auth/token/get";
const SHOPEE_REFRESH_PATH = "/api/v2/auth/access_token/get";

export const SHOPEE_CONFIG = {
  partnerId: Number(process.env.SHOPEE_PARTNER_ID || "0"),
  partnerKey: process.env.SHOPEE_PARTNER_KEY || "",
  redirectUri: process.env.SHOPEE_REDIRECT_URI || "",
};

// Gera assinatura HMAC-SHA256 para autenticacao Shopee
function generateSign(partnerKey: string, ...args: (string | number)[]): string {
  const baseString = args.join("");
  return crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

// Gera URL de autorizacao OAuth da Shopee
export function getShopeeAuthUrl(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = SHOPEE_AUTH_PATH;
  const sign = generateSign(
    SHOPEE_CONFIG.partnerKey,
    SHOPEE_CONFIG.partnerId,
    path,
    timestamp
  );

  const params = new URLSearchParams({
    partner_id: String(SHOPEE_CONFIG.partnerId),
    timestamp: String(timestamp),
    sign,
    redirect: SHOPEE_CONFIG.redirectUri,
  });

  return `${SHOPEE_API_URL}${path}?${params.toString()}`;
}

// Troca code + shop_id por access_token
export async function exchangeShopeeToken(code: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = SHOPEE_TOKEN_PATH;
  const sign = generateSign(
    SHOPEE_CONFIG.partnerKey,
    SHOPEE_CONFIG.partnerId,
    path,
    timestamp
  );

  const url = `${SHOPEE_API_URL}${path}?partner_id=${SHOPEE_CONFIG.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: shopId,
      partner_id: SHOPEE_CONFIG.partnerId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopee token exchange failed: ${error}`);
  }

  return response.json();
}

// Renova access_token usando refresh_token
export async function refreshShopeeToken(refreshToken: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = SHOPEE_REFRESH_PATH;
  const sign = generateSign(
    SHOPEE_CONFIG.partnerKey,
    SHOPEE_CONFIG.partnerId,
    path,
    timestamp
  );

  const url = `${SHOPEE_API_URL}${path}?partner_id=${SHOPEE_CONFIG.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: shopId,
      partner_id: SHOPEE_CONFIG.partnerId,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to refresh Shopee token");
  }

  return response.json();
}

// Faz chamada autenticada a API da Shopee
export async function shopeeApiCall(
  path: string,
  accessToken: string,
  shopId: number,
  params: Record<string, string | number> = {}
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSign(
    SHOPEE_CONFIG.partnerKey,
    SHOPEE_CONFIG.partnerId,
    path,
    timestamp,
    accessToken,
    shopId
  );

  const queryParams = new URLSearchParams({
    partner_id: String(SHOPEE_CONFIG.partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
  });

  const url = `${SHOPEE_API_URL}${path}?${queryParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopee API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Shopee API error: ${data.error} - ${data.message}`);
  }

  return data;
}

// Busca informacoes da loja
export async function getShopInfo(accessToken: string, shopId: number) {
  return shopeeApiCall("/api/v2/shop/get_shop_info", accessToken, shopId);
}

// Busca lista de pedidos
export async function getShopeeOrders(
  accessToken: string,
  shopId: number,
  timeFrom: number,
  timeTo: number,
  cursor = "",
  pageSize = 50
) {
  const params: Record<string, string | number> = {
    time_range_field: "create_time",
    time_from: timeFrom,
    time_to: timeTo,
    page_size: pageSize,
    order_status: "COMPLETED",
    response_optional_fields: "order_status",
  };
  if (cursor) params.cursor = cursor;

  return shopeeApiCall("/api/v2/order/get_order_list", accessToken, shopId, params);
}

// Busca detalhes de pedidos (ate 50 por vez)
export async function getShopeeOrderDetails(
  accessToken: string,
  shopId: number,
  orderSnList: string[]
) {
  const params: Record<string, string | number> = {
    order_sn_list: orderSnList.join(","),
    response_optional_fields: "buyer_user_id,buyer_username,estimated_shipping_fee,actual_shipping_fee,item_list,pay_time,buyer_cancel_reason,cancel_by,package_list,shipping_carrier,payment_method,total_amount,order_income",
  };

  return shopeeApiCall("/api/v2/order/get_order_detail", accessToken, shopId, params);
}

// Busca income (receita detalhada) de um pedido
export async function getShopeeOrderIncome(
  accessToken: string,
  shopId: number,
  orderSn: string
) {
  return shopeeApiCall("/api/v2/payment/get_escrow_detail", accessToken, shopId, {
    order_sn: orderSn,
  });
}

// Busca lista de produtos
export async function getShopeeItems(
  accessToken: string,
  shopId: number,
  offset = 0,
  pageSize = 50
) {
  return shopeeApiCall("/api/v2/product/get_item_list", accessToken, shopId, {
    offset,
    page_size: pageSize,
    item_status: "NORMAL",
  });
}
