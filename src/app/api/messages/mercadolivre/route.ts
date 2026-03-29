import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mlApiCall, refreshAccessToken } from "@/lib/mercadolivre";
import { generateAIResponse } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Renova token se necessario
async function getValidToken(account: {
  id: string; accessToken: string; refreshToken: string | null; tokenExpires: Date | null;
}) {
  let accessToken = account.accessToken;
  if (account.tokenExpires && account.tokenExpires < new Date()) {
    if (!account.refreshToken) throw new Error("Token expirado");
    const newToken = await refreshAccessToken(account.refreshToken);
    accessToken = newToken.access_token;
    await prisma.account.update({
      where: { id: account.id },
      data: {
        accessToken: newToken.access_token,
        refreshToken: newToken.refresh_token,
        tokenExpires: new Date(Date.now() + newToken.expires_in * 1000),
      },
    });
  }
  return accessToken;
}

// GET /api/messages/mercadolivre - Busca perguntas nao respondidas
export async function GET() {
  try {
    const account = await prisma.account.findFirst({
      where: { platform: "MERCADO_LIVRE", isActive: true },
    });
    if (!account) return NextResponse.json({ error: "Sem conta ML" }, { status: 404 });

    const accessToken = await getValidToken(account);

    // Busca perguntas nao respondidas
    const questionsData = await mlApiCall(
      `/questions/search?seller_id=${account.platformId}&status=UNANSWERED&api_version=4`,
      accessToken
    );

    const questions = questionsData.questions || [];

    // Enriquece com detalhes do item
    const enriched = [];
    for (const q of questions.slice(0, 20)) {
      let itemTitle = "";
      let itemPrice = 0;
      try {
        const item = await mlApiCall(`/items/${q.item_id}`, accessToken);
        itemTitle = item.title || "";
        itemPrice = item.price || 0;
      } catch { /* sem detalhes */ }

      enriched.push({
        id: q.id,
        text: q.text,
        date: q.date_created,
        itemId: q.item_id,
        itemTitle,
        itemPrice,
        from: q.from?.id,
        status: q.status,
      });
    }

    // Busca mensagens pos-venda recentes (orders messages)
    const messages: Array<Record<string, unknown>> = [];
    try {
      const msgsData = await mlApiCall(
        `/messages/unread?seller_id=${account.platformId}&api_version=2`,
        accessToken
      );
      if (msgsData.results) {
        for (const msg of msgsData.results.slice(0, 10)) {
          messages.push({
            id: msg.id,
            text: msg.text?.plain || msg.text || "",
            date: msg.date,
            from: msg.from?.user_id,
            orderId: msg.resource_id,
            type: "message",
          });
        }
      }
    } catch {
      // Mensagens pos-venda podem nao estar disponiveis
    }

    return NextResponse.json({
      questions: enriched,
      messages,
      totalQuestions: questionsData.total || questions.length,
      totalMessages: messages.length,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/messages/mercadolivre - Responde perguntas automaticamente com IA
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, questionId, autoReplyAll } = body;

    const account = await prisma.account.findFirst({
      where: { platform: "MERCADO_LIVRE", isActive: true },
    });
    if (!account) return NextResponse.json({ error: "Sem conta ML" }, { status: 404 });

    const accessToken = await getValidToken(account);

    // Responder automaticamente TODAS as perguntas pendentes
    if (autoReplyAll) {
      const questionsData = await mlApiCall(
        `/questions/search?seller_id=${account.platformId}&status=UNANSWERED&api_version=4`,
        accessToken
      );

      const questions = questionsData.questions || [];
      const results = [];

      for (const q of questions) {
        try {
          // Busca info do item
          let itemTitle = "Produto";
          let itemPrice = 0;
          try {
            const item = await mlApiCall(`/items/${q.item_id}`, accessToken);
            itemTitle = item.title || "Produto";
            itemPrice = item.price || 0;
          } catch { /* sem detalhes */ }

          // Gera resposta com IA
          const aiResponse = await generateAIResponse(
            q.text,
            itemTitle,
            itemPrice,
            "MERCADO_LIVRE",
            "pergunta_anuncio"
          );

          // Envia resposta via API do ML
          await mlApiCall(`/answers`, accessToken);
          const answerResponse = await fetch(
            "https://api.mercadolibre.com/answers",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                question_id: q.id,
                text: aiResponse,
              }),
            }
          );

          if (!answerResponse.ok) {
            const err = await answerResponse.text();
            results.push({ questionId: q.id, status: "error", error: err, question: q.text, answer: aiResponse });
          } else {
            results.push({ questionId: q.id, status: "answered", question: q.text, answer: aiResponse, item: itemTitle });
          }

          // Rate limiting
          await new Promise((r) => setTimeout(r, 1000));
        } catch (e) {
          results.push({ questionId: q.id, status: "error", error: String(e) });
        }
      }

      return NextResponse.json({ results, totalAnswered: results.filter(r => r.status === "answered").length });
    }

    // Responder uma pergunta especifica
    if (action === "answer" && questionId) {
      const question = await mlApiCall(`/questions/${questionId}`, accessToken);

      let itemTitle = "Produto";
      let itemPrice = 0;
      try {
        const item = await mlApiCall(`/items/${question.item_id}`, accessToken);
        itemTitle = item.title || "Produto";
        itemPrice = item.price || 0;
      } catch { /* */ }

      const aiResponse = await generateAIResponse(
        question.text,
        itemTitle,
        itemPrice,
        "MERCADO_LIVRE",
        "pergunta_anuncio"
      );

      const answerResponse = await fetch(
        "https://api.mercadolibre.com/answers",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question_id: questionId,
            text: aiResponse,
          }),
        }
      );

      if (!answerResponse.ok) {
        const err = await answerResponse.text();
        return NextResponse.json({ error: err, aiResponse }, { status: 400 });
      }

      return NextResponse.json({ status: "answered", question: question.text, answer: aiResponse });
    }

    return NextResponse.json({ error: "Acao invalida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
