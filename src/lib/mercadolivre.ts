const ML_API_URL = "https://api.mercadolibre.com";
const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export const ML_CONFIG = {
        clientId: process.env.ML_CLIENT_ID || "",
        clientSecret: process.env.ML_CLIENT_SECRET || "",
        redirectUri: process.env.ML_REDIRECT_URI || "",
};

// Escopos necessarios para o FinDash
const ML_SCOPES = [
        "read_content",
        "write_content",
        "offline_access",
        "advertising_read",
        "advertising_write",
      ].join(" ");

// Gera URL de autorizacao OAuth do Mercado Livre
export function getAuthUrl(): string {
        const params = new URLSearchParams({
                  response_type: "code",
                  client_id: ML_CONFIG.clientId,
                  redirect_uri: ML_CONFIG.redirectUri,
                  scope: ML_SCOPES,
        });
        return `${ML_AUTH_URL}?${params.toString()}`;
}

// Helper: parse JSON seguro - le o texto e faz parse manualmente para evitar double-read
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeParseResponse(response: Response, context: string): Promise<any> {
        const rawText = await response.text();
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json") && !rawText.trimStart().startsWith("{") && !rawText.trimStart().startsWith("[")) {
                  throw new Error(`${context} retornou resposta nao-JSON (status ${response.status}): ${rawText.substring(0, 150)}`);
        }
        try {
                  return JSON.parse(rawText);
        } catch {
                  throw new Error(`${context} retornou JSON invalido (status ${response.status}): ${rawText.substring(0, 150)}`);
        }
}

// Troca code por access_token
export async function exchangeCodeForToken(code: string) {
        const response = await fetch(ML_TOKEN_URL, {
                  method: "POST",
                  headers: {
                              "Content-Type": "application/x-www-form-urlencoded",
                              Accept: "application/json"
                  },
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
                  throw new Error(`ML token exchange falhou (${response.status}): ${error}`);
        }
        return safeParseResponse(response, "exchangeCodeForToken");
}

// Renova access_token usando refresh_token
export async function refreshAccessToken(refreshToken: string) {
        const response = await fetch(ML_TOKEN_URL, {
                  method: "POST",
                  headers: {
                              "Content-Type": "application/x-www-form-urlencoded",
                              Accept: "application/json"
                  },
                  body: new URLSearchParams({
                              grant_type: "refresh_token",
                              client_id: ML_CONFIG.clientId,
                              client_secret: ML_CONFIG.clientSecret,
                              refresh_token: refreshToken,
                  }),
        });
        if (!response.ok) {
                  const errText = await response.text().catch(() => "");
                  throw new Error(`Falha ao renovar token ML (${response.status}): ${errText.substring(0, 200)}`);
        }
        return safeParseResponse(response, "refreshAccessToken");
}

// Faz chamada autenticada a API do ML com retry para rate limiting
export async function mlApiCall(endpoint: string, accessToken: string, retries = 3): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(`${ML_API_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Rate limit — espera e tenta novamente
    if (response.status === 429 && attempt < retries - 1) {
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`ML API error (${response.status}) em ${endpoint}: ${errText.substring(0, 200)}`);
    }

    return safeParseResponse(response, `mlApiCall(${endpoint})`);
  }

  throw new Error(`ML API falhou apos ${retries} tentativas em ${endpoint}`);
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
        if (dateFrom) {
          // Garante formato ISO que a API do ML aceita
          const from = dateFrom.includes("T") ? dateFrom : `${dateFrom}T00:00:00.000-03:00`;
          endpoint += `&order.date_created.from=${encodeURIComponent(from)}`;
        }
        if (dateTo) {
          const to = dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.000-03:00`;
          endpoint += `&order.date_created.to=${encodeURIComponent(to)}`;
        }
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

// Busca detalhes de pagamento do pedido (inclui fees)
export async function getPaymentInfo(accessToken: string, paymentId: string) {
        try {
                  return await mlApiCall(`/collections/${paymentId}`, accessToken);
        } catch {
                  return null;
        }
}
