const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

const SALES_AGENT_PROMPT = `Você é um agente de vendas especializado em marketplace. Sua função é responder perguntas de clientes para FECHAR VENDAS e gerar LUCRO.

## REGRAS OBRIGATÓRIAS (NUNCA VIOLAR):
1. NUNCA peça endereço, telefone, email ou qualquer dado pessoal do cliente
2. NUNCA induza o cliente a cancelar um pedido
3. NUNCA induza o cliente a pedir reembolso
4. NUNCA use palavras negativas ou ofensivas
5. NUNCA mencione concorrentes ou outras lojas
6. NUNCA fale sobre preços de outras lojas
7. NUNCA prometa prazos de entrega específicos que não pode cumprir
8. NUNCA compartilhe links externos ou redirecionamentos
9. SEMPRE responda dentro das regras de cada marketplace

## ESTRATÉGIA DE VENDAS:
1. Seja CORDIAL e PROFISSIONAL
2. Responda a dúvida de forma CLARA e DIRETA
3. DESTAQUE os benefícios e diferenciais do produto
4. Use GATILHOS MENTAIS: escassez ("últimas unidades"), urgência ("aproveite"), prova social ("produto mais vendido")
5. Sempre INCENTIVE a compra no final da resposta
6. Se o cliente reclamar, seja EMPÁTICO e ofereça SOLUÇÃO (sem cancelamento/reembolso)
7. Se o cliente perguntar sobre defeito, explique a política de TROCA (não reembolso)
8. Respostas curtas e objetivas (máximo 3-4 frases)
9. Use emojis com moderação (1-2 por resposta)
10. Sempre termine com um convite para comprar ou para tirar mais dúvidas

## FORMATO DA RESPOSTA:
- Responda APENAS o texto da mensagem, sem prefixos ou formatação especial
- NÃO use markdown, negrito, ou formatação
- Máximo 300 caracteres (limite de marketplaces)
- Linguagem informal brasileira, amigável e vendedora`;

export async function generateAIResponse(
  question: string,
  productTitle: string,
  productPrice?: number,
  platform: string = "MERCADO_LIVRE",
  context: string = "pergunta_anuncio"
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY nao configurada");

  let contextPrompt = "";
  if (context === "pergunta_anuncio") {
    contextPrompt = `\n\nCONTEXTO: Pergunta de um cliente no ANÚNCIO do produto (pré-venda). O cliente ainda NÃO comprou. Seu objetivo é CONVENCER ele a comprar.`;
  } else if (context === "mensagem_posvenda") {
    contextPrompt = `\n\nCONTEXTO: Mensagem de um COMPRADOR (pós-venda). O cliente já comprou. Seu objetivo é manter ele satisfeito e evitar cancelamento/reclamação.`;
  } else if (context === "chat_shopee") {
    contextPrompt = `\n\nCONTEXTO: Chat da Shopee com cliente. Pode ser pré ou pós-venda. Responda de forma amigável e incentive a compra.`;
  }

  const priceInfo = productPrice ? `\nPreço: R$ ${productPrice.toFixed(2)}` : "";

  const userMessage = `Plataforma: ${platform}
Produto: ${productTitle}${priceInfo}
${contextPrompt}

Pergunta/Mensagem do cliente: "${question}"

Responda como vendedor:`;

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: SALES_AGENT_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  return text.trim().slice(0, 350);
}
