import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mlApiCall, refreshAccessToken } from "@/lib/mercadolivre";
import { generateAIResponse } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Renova token antes de usar
async function getValidToken(account: {
  id: string; accessToken: string; refreshToken: string | null; tokenExpires: Date | null;
}) {
  let accessToken = account.accessToken;
  if (account.refreshToken) {
    try {
      const newToken = await refreshAccessToken(account.refreshToken);
      accessToken = newToken.access_token as string;
      await prisma.account.update({
        where: { id: account.id },
        data: {
          accessToken: newToken.access_token as string,
          refreshToken: (newToken.refresh_token as string) || account.refreshToken,
          tokenExpires: new Date(Date.now() + ((newToken.expires_in as number) || 21600) * 1000),
        },
      });
    } catch {
      // Se refresh falhar, usa token atual
    }
  }
  return accessToken;
}

// GET /api/messages/mercadolivre
export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      where: { platform: "MERCADO_LIVRE", isActive: true },
    });
    if (accounts.length === 0) return NextResponse.json({ error: "Sem conta ML" }, { status: 404 });

    const allQuestions: Array<Record<string, unknown>> = [];
    const allMessages: Array<Record<string, unknown>> = [];
    let totalQuestionsCount = 0;
    const errors: Array<{ account: string; error: string }> = [];

    // Processa contas em paralelo
    await Promise.all(accounts.map(async (account) => {
      try {
        const accessToken = await getValidToken(account);
        if (!accessToken) {
          errors.push({ account: account.nickname || account.platformId, error: "Token vazio" });
          return;
        }
        const storeName = account.nickname || account.platformId;

        // Busca perguntas E pedidos recentes em PARALELO
        // Limita pedidos aos ultimos 3 dias para nao trazer mensagens antigas ja respondidas
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split(".")[0] + ".000-00:00";
        const [questionsData, recentOrders] = await Promise.allSettled([
          mlApiCall(
            `/questions/search?seller_id=${account.platformId}&status=UNANSWERED&api_version=4`,
            accessToken
          ),
          mlApiCall(
            `/orders/search?seller=${account.platformId}&sort=date_desc&limit=10&order.date_created.from=${threeDaysAgo}`,
            accessToken
          ),
        ]);

        // Processa perguntas
        if (questionsData.status === "fulfilled") {
          const qData = questionsData.value;
          const questions = (qData.questions || []) as Array<Record<string, unknown>>;
          totalQuestionsCount += (qData.total as number) || questions.length;

          // Busca detalhes de itens em paralelo (max 10)
          const questionBatch = questions.slice(0, 10);
          const itemDetails = await Promise.allSettled(
            questionBatch.map((q) =>
              mlApiCall(`/items/${q.item_id}`, accessToken).catch(() => ({ title: "", price: 0 }))
            )
          );

          for (let i = 0; i < questionBatch.length; i++) {
            const q = questionBatch[i];
            const item = itemDetails[i].status === "fulfilled" ? itemDetails[i].value : { title: "", price: 0 };
            allQuestions.push({
              id: q.id,
              text: q.text,
              date: q.date_created,
              itemId: q.item_id,
              itemTitle: item.title || "",
              itemPrice: item.price || 0,
              from: (q.from as Record<string, unknown>)?.id,
              status: q.status,
              accountId: account.id,
              storeName,
            });
          }
        }

        // Processa mensagens pos-venda
        if (recentOrders.status === "fulfilled") {
          const orders = ((recentOrders.value.results || []) as Array<Record<string, unknown>>).slice(0, 10);
          const sellerId = Number(account.platformId);

          // Busca mensagens em paralelo (max 10 pedidos)
          const msgResults = await Promise.allSettled(
            orders.map(async (order) => {
              const packId = order.pack_id || order.id;
              const msgsData = await mlApiCall(
                `/messages/packs/${packId}/sellers/${account.platformId}?tag=post_sale`,
                accessToken
              );
              return { order, packId, msgsData };
            })
          );

          for (const result of msgResults) {
            if (result.status !== "fulfilled") continue;
            const { order, packId, msgsData } = result.value;
            const messages = (msgsData.messages || []) as Array<Record<string, unknown>>;
            if (messages.length === 0) continue;

            // Verifica se ultima mensagem e do comprador
            const lastMsg = messages[messages.length - 1];
            const lastFrom = lastMsg.from as Record<string, unknown> | undefined;
            if (lastFrom?.user_id === sellerId) continue;

            // Ignora mensagens antigas (mais de 48h) — provavelmente ja respondidas por outro canal
            const lastMsgDate = lastMsg.date_created || lastMsg.date;
            if (lastMsgDate) {
              const msgAge = Date.now() - new Date(String(lastMsgDate)).getTime();
              if (msgAge > 48 * 60 * 60 * 1000) continue;
            }

            const buyer = order.buyer as Record<string, unknown> | undefined;
            const orderItems = order.order_items as Array<Record<string, unknown>> | undefined;
            const firstItem = orderItems?.[0] as Record<string, unknown> | undefined;
            const itemData = firstItem?.item as Record<string, unknown> | undefined;

            const lbmText = lastMsg.text;
            allMessages.push({
              id: String(lastMsg.id || `${packId}-msg`),
              text: typeof lbmText === "object" ? String((lbmText as Record<string, unknown>)?.plain || "") : String(lbmText || ""),
              date: String(lastMsg.date_created || lastMsg.date || ""),
              from: lastFrom?.user_id,
              fromName: (buyer?.nickname as string) || "Comprador",
              orderId: String(order.id),
              packId: String(packId),
              itemTitle: (itemData?.title as string) || "",
              totalAmount: order.total_amount,
              type: "posvenda",
              accountId: account.id,
              storeName,
            });
          }
        }
      } catch (e) {
        errors.push({
          account: account.nickname || account.platformId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }));

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

    // === GERAR resposta com IA ===
    if (action === "generate_only") {
      const account = accountId
        ? await prisma.account.findFirst({ where: { id: accountId, platform: "MERCADO_LIVRE" } })
        : await prisma.account.findFirst({ where: { platform: "MERCADO_LIVRE", isActive: true } });
      if (!account) return NextResponse.json({ error: "Conta nao encontrada" }, { status: 404 });

      const accessToken = await getValidToken(account);
      let itemTitle = body.itemTitle || "Produto";
      let itemPrice = body.totalAmount || 0;
      const context = body.context || "pergunta_anuncio";

      if (body.questionId) {
        try {
          const question = await mlApiCall(`/questions/${body.questionId}`, accessToken);
          const item = await mlApiCall(`/items/${question.item_id}`, accessToken);
          itemTitle = (item.title as string) || itemTitle;
          itemPrice = (item.price as number) || itemPrice;
        } catch { /* usa o que veio */ }
      }

      const aiResponse = await generateAIResponse(body.customerMessage || "", itemTitle, itemPrice, "MERCADO_LIVRE", context);
      return NextResponse.json({ aiResponse });
    }

    // === ENVIAR resposta a pergunta ===
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

    // === ENVIAR mensagem pos-venda ===
    if (action === "send_message" && body.packId) {
      const account = accountId
        ? await prisma.account.findFirst({ where: { id: accountId, platform: "MERCADO_LIVRE" } })
        : await prisma.account.findFirst({ where: { platform: "MERCADO_LIVRE", isActive: true } });
      if (!account) return NextResponse.json({ error: "Conta nao encontrada" }, { status: 404 });

      const accessToken = await getValidToken(account);
      const sellerId = Number(account.platformId);
      const buyerId = Number(body.buyerId);
      const msgText = String(body.text || "");

      const response = await fetch(
        `https://api.mercadolibre.com/messages/packs/${body.packId}/sellers/${sellerId}?tag=post_sale`,
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

      if (!response.ok) {
        const err = await response.text();
        return NextResponse.json({ error: `Erro ao enviar: ${err}` }, { status: 400 });
      }
      return NextResponse.json({ status: "sent" });
    }

    return NextResponse.json({ error: "Acao invalida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
