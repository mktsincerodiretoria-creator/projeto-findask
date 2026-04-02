import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mlApiCall, refreshAccessToken } from "@/lib/mercadolivre";
import { generateAIResponse } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SEMPRE renova token antes de usar (evita expirar no meio)
async function getValidToken(account: {
  id: string; accessToken: string; refreshToken: string | null; tokenExpires: Date | null;
}) {
  let accessToken = account.accessToken;
  // Sempre tenta renovar se tem refresh_token
  if (account.refreshToken) {
    try {
      const newToken = await refreshAccessToken(account.refreshToken);
      accessToken = newToken.access_token;
      await prisma.account.update({
        where: { id: account.id },
        data: {
          accessToken: newToken.access_token,
          refreshToken: newToken.refresh_token || account.refreshToken,
          tokenExpires: new Date(Date.now() + (newToken.expires_in || 21600) * 1000),
        },
      });
    } catch {
      // Se refresh falhar, usa token atual
    }
  }
  return accessToken;
}

// GET /api/messages/mercadolivre - Busca perguntas nao respondidas de TODAS as contas ML
export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      where: { platform: "MERCADO_LIVRE", isActive: true },
    });
    if (accounts.length === 0) return NextResponse.json({ error: "Sem conta ML" }, { status: 404 });

    const allQuestions = [];
    const allMessages: Array<Record<string, unknown>> = [];
    let totalQuestionsCount = 0;

    const errors: Array<{account: string; error: string}> = [];

    for (const account of accounts) {
      try {
        const accessToken = await getValidToken(account);
        if (!accessToken) { errors.push({account: account.nickname || account.platformId, error: "Token vazio"}); continue; }
        const storeName = account.nickname || account.platformId;

        // Busca perguntas nao respondidas desta conta
        const questionsData = await mlApiCall(
          `/questions/search?seller_id=${account.platformId}&status=UNANSWERED&api_version=4`,
          accessToken
        );

        const questions = questionsData.questions || [];
        totalQuestionsCount += questionsData.total || questions.length;

        // Enriquece com detalhes do item
        for (const q of questions.slice(0, 20)) {
          let itemTitle = "";
          let itemPrice = 0;
          try {
            const item = await mlApiCall(`/items/${q.item_id}`, accessToken);
            itemTitle = item.title || "";
            itemPrice = item.price || 0;
          } catch { /* sem detalhes */ }

          allQuestions.push({
            id: q.id,
            text: q.text,
            date: q.date_created,
            itemId: q.item_id,
            itemTitle,
            itemPrice,
            from: q.from?.id,
            status: q.status,
            accountId: account.id,
            storeName,
          });
        }

        // Busca mensagens pos-venda (packs recentes com mensagens nao lidas)
        try {
          // Busca pedidos recentes para verificar mensagens
          const recentOrders = await mlApiCall(
            `/orders/search?seller=${account.platformId}&sort=date_desc&limit=20`,
            accessToken
          );

          for (const order of (recentOrders.results || []).slice(0, 15)) {
            try {
              const packId = order.pack_id || order.id;
              // Busca mensagens do pack/order
              const msgsData = await mlApiCall(
                `/messages/packs/${packId}/sellers/${account.platformId}?tag=post_sale`,
                accessToken
              );

              const messages = msgsData.messages || [];
              if (messages.length === 0) continue;

              // Verifica se a mensagem mais recente e do comprador
              // A API pode retornar em qualquer ordem, entao verifica TANTO primeira quanto ultima
              const sellerId = Number(account.platformId);
              const firstMsg = messages[0];
              const lastMsg = messages[messages.length - 1];
              const firstIsFromSeller = firstMsg?.from?.user_id === sellerId;
              const lastIsFromSeller = lastMsg?.from?.user_id === sellerId;

              // Se a primeira OU ultima mensagem e do vendedor, ja respondeu
              if (firstIsFromSeller || lastIsFromSeller) continue;

              // Pega a ultima mensagem do comprador
              const buyerMessages = messages.filter((m: Record<string, unknown>) => {
                const from = m.from as Record<string, unknown> | undefined;
                return from?.user_id !== Number(account.platformId);
              });
              if (buyerMessages.length === 0) continue;

              const latestBuyerMsg = buyerMessages[buyerMessages.length - 1];

              // Busca info do item
              let itemTitle = "";
              try {
                if (order.order_items?.[0]?.item?.title) {
                  itemTitle = order.order_items[0].item.title;
                }
              } catch { /* */ }

              const lbm = latestBuyerMsg as Record<string, unknown>;
              const lbmFrom = lbm.from as Record<string, unknown> | undefined;
              const lbmText = lbm.text as Record<string, unknown> | string | undefined;

              allMessages.push({
                id: String(lbm.id || `${packId}-${Date.now()}`),
                text: typeof lbmText === "object" ? String((lbmText as Record<string,unknown>)?.plain || "") : String(lbmText || ""),
                date: String(lbm.date_created || lbm.date || ""),
                from: lbmFrom?.user_id,
                fromName: order.buyer?.nickname || "Comprador",
                orderId: String(order.id),
                packId: String(packId),
                itemTitle,
                totalAmount: order.total_amount,
                type: "posvenda",
                accountId: account.id,
                storeName,
              });
            } catch { /* sem mensagens para este pedido */ }
          }
        } catch { /* endpoint de mensagens nao disponivel */ }
      } catch (e) {
        console.error(`Error fetching messages for account ${account.nickname}:`, e);
      }
    }

    return NextResponse.json({
      questions: allQuestions,
      messages: allMessages,
      totalQuestions: totalQuestionsCount,
      totalMessages: allMessages.length,
      accountsChecked: accounts.length,
      accountErrors: errors,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/messages/mercadolivre
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, accountId } = body;

    // === GERAR resposta com IA (nao envia, so retorna) ===
    if (action === "generate_only") {
      const account = accountId
        ? await prisma.account.findFirst({ where: { id: accountId, platform: "MERCADO_LIVRE" } })
        : await prisma.account.findFirst({ where: { platform: "MERCADO_LIVRE", isActive: true } });
      if (!account) return NextResponse.json({ error: "Conta nao encontrada" }, { status: 404 });

      const accessToken = await getValidToken(account);
      let itemTitle = body.itemTitle || "Produto";
      let itemPrice = body.totalAmount || 0;
      const context = body.context || "pergunta_anuncio";

      // Se e pergunta, busca detalhes do item
      if (body.questionId) {
        try {
          const question = await mlApiCall(`/questions/${body.questionId}`, accessToken);
          const item = await mlApiCall(`/items/${question.item_id}`, accessToken);
          itemTitle = item.title || itemTitle;
          itemPrice = item.price || itemPrice;
        } catch { /* usa o que veio */ }
      }

      const customerMsg = body.customerMessage || "";
      const aiResponse = await generateAIResponse(customerMsg, itemTitle, itemPrice, "MERCADO_LIVRE", context);

      return NextResponse.json({ aiResponse });
    }

    // === ENVIAR resposta a pergunta (ja aprovada) ===
    if (action === "send_answer" && body.questionId) {
      const account = accountId
        ? await prisma.account.findFirst({ where: { id: accountId, platform: "MERCADO_LIVRE" } })
        : await prisma.account.findFirst({ where: { platform: "MERCADO_LIVRE", isActive: true } });
      if (!account) return NextResponse.json({ error: "Conta nao encontrada" }, { status: 404 });

      const accessToken = await getValidToken(account);
      const answerResponse = await fetch("https://api.mercadolibre.com/answers", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: body.questionId, text: body.text }),
      });

      if (!answerResponse.ok) {
        const err = await answerResponse.text();
        return NextResponse.json({ error: err }, { status: 400 });
      }

      return NextResponse.json({ status: "sent" });
    }

    // === ENVIAR mensagem pos-venda (ja aprovada) ===
    if (action === "send_message" && body.packId) {
      const account = accountId
        ? await prisma.account.findFirst({ where: { id: accountId, platform: "MERCADO_LIVRE" } })
        : await prisma.account.findFirst({ where: { platform: "MERCADO_LIVRE", isActive: true } });
      if (!account) return NextResponse.json({ error: "Conta nao encontrada" }, { status: 404 });

      const accessToken = await getValidToken(account);
      const sellerId = Number(account.platformId);
      const buyerId = Number(body.buyerId);
      const packId = body.packId;
      const msgText = String(body.text || "");

      // Tenta formato 1: /messages/packs/{pack_id}/sellers/{seller_id}
      let response = await fetch(
        `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: { user_id: sellerId },
            to: { user_id: buyerId },
            text: msgText,
          }),
        }
      );

      // Se falhar, tenta formato 2: text como objeto
      if (!response.ok) {
        response = await fetch(
          `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: { user_id: sellerId },
              to: { user_id: buyerId },
              text: { plain: msgText },
            }),
          }
        );
      }

      // Se falhar, tenta formato 3: /messages com resource
      if (!response.ok) {
        response = await fetch(
          `https://api.mercadolibre.com/messages`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: { user_id: sellerId },
              to: { user_id: buyerId },
              text: { plain: msgText },
              resource: "packs",
              resource_id: packId,
            }),
          }
        );
      }

      if (!response.ok) {
        const err = await response.text();
        return NextResponse.json({ error: `Erro ao enviar mensagem: ${err}` }, { status: 400 });
      }

      return NextResponse.json({ status: "sent" });
    }

    return NextResponse.json({ error: "Acao invalida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
