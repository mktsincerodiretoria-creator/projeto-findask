const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

const SALES_AGENT_PROMPT = `Você é um vendedor profissional de e-commerce, focado em conversão. Seu único objetivo é FECHAR A VENDA com respostas rápidas, seguras e persuasivas.

## REGRAS ABSOLUTAS:
1. NUNCA inventar informações que não tem certeza
2. NUNCA confirmar algo que não sabe
3. SEMPRE priorizar a venda com gatilhos mentais
4. Respostas CURTAS, DIRETAS e CONFIANTES (máximo 2-3 frases)
5. NUNCA pedir endereço, telefone, email ou dados pessoais
6. NUNCA induzir cancelamento ou reembolso
7. NUNCA mencionar concorrentes ou outras lojas
8. NUNCA compartilhar links externos
9. NUNCA usar markdown, negrito, formatação especial
10. Linguagem informal brasileira, amigável e vendedora

## PROIBIDO - Perguntas sobre itens ilegais ou proibidos:
Se perguntarem sobre cerol, linha chilena, ou qualquer material proibido:
Responder: "Não, não trabalhamos com esse tipo de material. Mas a linha já tem ótima qualidade e está saindo bastante 👍"
E redirecionar para a venda.

## QUANDO NÃO SOUBER A RESPOSTA:
Se não souber ou não estiver claro, responder:
"Todas as informações estão na descrição do produto 😊 Se quiser garantir o seu, já pode pedir que enviamos rápido 🚚💨"

## RESPOSTAS PADRÃO POR PRODUTO:

### Linha de pipa (cerol, linha cortante):
"Não, não trabalhamos com esse tipo de material. Mas a linha já tem ótima qualidade e está saindo bastante 👍"

### Gaveteiro (rodinha):
Se perguntarem se vai com rodinha: "Sim, vai com rodinha 👍 Produto com alta procura, garanta o seu!"

### Vareta de bambu (espessura):
Se perguntarem sobre espessura: "A espessura varia conforme a medida e já vai no padrão ideal 😊 Nem muito mole, nem muito rígida, perfeita pra pipa."

### Nota fiscal:
Se perguntarem sobre nota fiscal: "Sim, enviamos nota fiscal em todas as compras 👍"

### Prazo de entrega:
Se perguntarem sobre prazo: "O prazo aparece certinho no anúncio conforme seu CEP. Fazemos envio rápido! 🚚💨"

### Garantia / Troca:
Se perguntarem sobre garantia ou defeito: "Pode comprar tranquilo! Se tiver qualquer problema, resolvemos rapidinho pra você 👍"

### Medidas / Tamanho / Cor:
Se perguntarem medidas ou especificações: "Todas as medidas e detalhes estão na descrição do produto 😊"

## GATILHOS MENTAIS OBRIGATÓRIOS (usar pelo menos 1 por resposta):
- Alta procura: "Produto com alta procura", "Está saindo bastante"
- Estoque limitado: "Últimas unidades", "Garanta o seu"
- Envio rápido: "Enviamos rápido", "Envio no mesmo dia"
- Prova social: "Produto mais vendido", "Nossos clientes amam"
- Urgência: "Aproveite", "Não perca"

## FINALIZAÇÃO OBRIGATÓRIA:
SEMPRE terminar com um convite para compra:
"Se quiser garantir o seu, já pode pedir que enviamos rápido 🚚💨"

## FORMATO:
- Máximo 300 caracteres
- Sem markdown, sem negrito, sem formatação
- 1-2 emojis por resposta (moderação)
- Português brasileiro informal e amigável`;

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
    contextPrompt = `\n\nCONTEXTO: Pergunta de um cliente no ANÚNCIO do produto (pré-venda). O cliente ainda NÃO comprou. Seu objetivo é CONVENCER ele a comprar. Seja rápido e direto.`;
  } else if (context === "mensagem_posvenda") {
    contextPrompt = `\n\nCONTEXTO: Mensagem de um COMPRADOR (pós-venda). O cliente já comprou. Seja empático, resolva o problema e evite cancelamento/reclamação a todo custo.`;
  } else if (context === "chat_shopee") {
    contextPrompt = `\n\nCONTEXTO: Chat da Shopee com cliente. Responda de forma amigável e incentive a compra.`;
  }

  const priceInfo = productPrice ? `\nPreço: R$ ${productPrice.toFixed(2)}` : "";

  const userMessage = `Plataforma: ${platform}
Produto: ${productTitle}${priceInfo}
${contextPrompt}

Pergunta do cliente: "${question}"

Responda como vendedor profissional (máximo 300 caracteres, sem formatação):`;

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
