const ML_API_URL = "https://api.mercadolibre.com";
const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export const ML_CONFIG = {
  clientId: process.env.ML_CLIENT_ID || "",
  clientSecret: process.env.ML_CLIENT_SECRET || "",
  redirectUri: process.env.ML_REDIRECT_URI || "",
};

// Gera URL de autorizacao OAuth do Mercado Livre
export function getAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ML_CONFIG.clientId,
    redirect_uri: ML_CONFIG.redirectUri,
  });
  return `${ML_AUTH_URL}?${params.toString()}`;
}

// Troca code por access_token
export async function exchangeCodeForToken(code: string) {
  const response = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ML_CONFIG.clientId,
      client_secret: ML_CONFIG.clientSecret,
      code,
      redirect_uri: ML_CONFIG.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ML token exchange failed: ${error}`);
  }

  return response.json();
}

// Renova access_token usando refresh_token
export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ML_CONFIG.clientId,
      client_secret: ML_CONFIG.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to refresh ML token");
  }

  return response.json();
}

// Faz chamada autenticada a API do ML
export async function mlApiCall(endpoint: string, accessToken: string) {
  const response = await fetch(`${ML_API_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ML API error (${response.status}): ${error}`);
  }

  return response.json();
}

// Busca informacoes do usuario autenticado
export async function getUserInfo(accessToken: string) {
  return mlApiCall("/users/me", accessToken);
}

// Busca pedidos do vendedor com paginacao
export async function getOrders(
  accessToken: string,
  sellerId: string,
  offset = 0,
  limit = 50,
  dateFrom?: string,
  dateTo?: string
) {
  let endpoint = `/orders/search?seller=${sellerId}&offset=${offset}&limit=${limit}&sort=date_desc`;

  if (dateFrom) endpoint += `&order.date_created.from=${dateFrom}`;
  if (dateTo) endpoint += `&order.date_created.to=${dateTo}`;

  return mlApiCall(endpoint, accessToken);
}

// Busca detalhes de um pedido
export async function getOrderDetails(accessToken: string, orderId: string) {
  return mlApiCall(`/orders/${orderId}`, accessToken);
}

// Busca itens/produtos do vendedor
export async function getSellerItems(
  accessToken: string,
  sellerId: string,
  offset = 0,
  limit = 50
) {
  return mlApiCall(
    `/users/${sellerId}/items/search?offset=${offset}&limit=${limit}`,
    accessToken
  );
}

// Busca detalhes de um item
export async function getItemDetails(accessToken: string, itemId: string) {
  return mlApiCall(`/items/${itemId}`, accessToken);
}

// Busca informacoes de envio
export async function getShipmentDetails(accessToken: string, shipmentId: string) {
  return mlApiCall(`/shipments/${shipmentId}`, accessToken);
}

// Busca billing (tarifas e comissoes) de um pedido
export async function getOrderBilling(accessToken: string, orderId: string) {
  try {
    return await mlApiCall(`/orders/${orderId}/billing_info`, accessToken);
  } catch {
    return null;
  }
}
