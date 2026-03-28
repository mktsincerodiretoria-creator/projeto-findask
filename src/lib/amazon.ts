const AMAZON_AUTH_URL = "https://sellercentral.amazon.com.br/apps/authorize/consent";
const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const AMAZON_API_URL = "https://sellingpartnerapi-na.amazon.com";

export const AMAZON_CONFIG = {
  clientId: process.env.AMAZON_CLIENT_ID || "",
  clientSecret: process.env.AMAZON_CLIENT_SECRET || "",
  redirectUri: process.env.AMAZON_REDIRECT_URI || "",
};

// Gera URL de autorizacao OAuth da Amazon (LWA)
export function getAmazonAuthUrl(): string {
  const params = new URLSearchParams({
    application_id: AMAZON_CONFIG.clientId,
    redirect_uri: AMAZON_CONFIG.redirectUri,
    state: "findash",
  });
  return `${AMAZON_AUTH_URL}?${params.toString()}`;
}

// Troca code por access_token (LWA)
export async function exchangeAmazonToken(code: string) {
  const response = await fetch(AMAZON_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: AMAZON_CONFIG.redirectUri,
      client_id: AMAZON_CONFIG.clientId,
      client_secret: AMAZON_CONFIG.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Amazon token exchange failed: ${error}`);
  }

  return response.json();
}

// Renova access_token
export async function refreshAmazonToken(refreshToken: string) {
  const response = await fetch(AMAZON_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: AMAZON_CONFIG.clientId,
      client_secret: AMAZON_CONFIG.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to refresh Amazon token");
  }

  return response.json();
}

// Faz chamada autenticada a SP-API da Amazon
export async function amazonApiCall(
  path: string,
  accessToken: string,
  method: "GET" | "POST" = "GET",
  queryParams: Record<string, string> = {},
) {
  const url = new URL(`${AMAZON_API_URL}${path}`);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Amazon API error (${response.status}): ${error}`);
  }

  return response.json();
}

// Busca pedidos
export async function getAmazonOrders(
  accessToken: string,
  marketplaceId: string,
  createdAfter: string,
  nextToken?: string,
) {
  const params: Record<string, string> = {
    MarketplaceIds: marketplaceId,
    CreatedAfter: createdAfter,
    OrderStatuses: "Shipped,Delivered",
  };
  if (nextToken) params.NextToken = nextToken;

  return amazonApiCall("/orders/v0/orders", accessToken, "GET", params);
}

// Busca detalhes de um pedido
export async function getAmazonOrderItems(
  accessToken: string,
  orderId: string,
) {
  return amazonApiCall(`/orders/v0/orders/${orderId}/orderItems`, accessToken);
}

// Busca informacoes financeiras de pedidos
export async function getAmazonFinancialEvents(
  accessToken: string,
  orderId: string,
) {
  return amazonApiCall(
    `/finances/v0/orders/${orderId}/financialEvents`,
    accessToken,
  );
}

// Marketplace ID do Brasil
export const AMAZON_BRAZIL_MARKETPLACE = "A2Q3Y263D00KWC";
