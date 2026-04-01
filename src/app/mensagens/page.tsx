"use client";

import { useState, useEffect, useCallback } from "react";

interface Question {
  id: number;
  text: string;
  date: string;
  itemId: string;
  accountId: string;
  storeName: string;
  itemTitle: string;
  itemPrice: number;
  status: string;
}

interface PostSaleMessage {
  id: string;
  text: string;
  date: string;
  fromName: string;
  from: number;
  orderId: string;
  packId: string;
  itemTitle: string;
  totalAmount: number;
  accountId: string;
  storeName: string;
}

interface PendingReply {
  type: "question" | "posvenda";
  id: string | number;
  originalText: string;
  aiResponse: string;
  accountId: string;
  // extras para envio
  packId?: string;
  buyerId?: number;
  itemTitle?: string;
}

export default function MensagensPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [postSaleMessages, setPostSaleMessages] = useState<PostSaleMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [pendingReplies, setPendingReplies] = useState<Record<string, PendingReply>>({});
  const [sentResults, setSentResults] = useState<Array<{ question: string; answer: string; status: string }>>([]);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/messages/mercadolivre");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setQuestions(data.questions || []);
        setPostSaleMessages(data.messages || []);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // GERAR resposta com IA (nao envia, so mostra)
  async function generateReply(type: "question" | "posvenda", id: string | number, text: string, accountId: string, extras?: { packId?: string; buyerId?: number; itemTitle?: string; totalAmount?: number }) {
    const key = `${type}-${id}`;
    setGenerating(key);
    try {
      const res = await fetch("/api/messages/mercadolivre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_only",
          questionId: type === "question" ? id : undefined,
          accountId,
          customerMessage: text,
          itemTitle: extras?.itemTitle || "",
          totalAmount: extras?.totalAmount || 0,
          context: type === "question" ? "pergunta_anuncio" : "mensagem_posvenda",
        }),
      });
      const data = await res.json();
      if (data.aiResponse) {
        setPendingReplies(prev => ({
          ...prev,
          [key]: {
            type, id, originalText: text, aiResponse: data.aiResponse, accountId,
            packId: extras?.packId, buyerId: extras?.buyerId, itemTitle: extras?.itemTitle,
          },
        }));
      } else {
        setError(data.error || "Erro ao gerar resposta");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(null);
    }
  }

  // APROVAR e ENVIAR resposta
  async function approveAndSend(key: string) {
    const reply = pendingReplies[key];
    if (!reply) return;
    setSending(key);
    try {
      let res;
      if (reply.type === "question") {
        res = await fetch("/api/messages/mercadolivre", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_answer", questionId: reply.id, accountId: reply.accountId, text: reply.aiResponse }),
        });
      } else {
        res = await fetch("/api/messages/mercadolivre", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_message", accountId: reply.accountId, packId: reply.packId, buyerId: reply.buyerId, text: reply.aiResponse }),
        });
      }
      const data = await res.json();
      if (data.status === "sent" || data.status === "answered" || data.status === "replied") {
        setSentResults(prev => [...prev, { question: reply.originalText, answer: reply.aiResponse, status: "enviado" }]);
        setPendingReplies(prev => { const n = { ...prev }; delete n[key]; return n; });
        if (reply.type === "question") setQuestions(prev => prev.filter(q => q.id !== reply.id));
        else setPostSaleMessages(prev => prev.filter(m => m.id !== reply.id));
      } else {
        setError(data.error || "Erro ao enviar");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(null);
    }
  }

  // Editar resposta pendente
  function editReply(key: string, newText: string) {
    setPendingReplies(prev => ({ ...prev, [key]: { ...prev[key], aiResponse: newText } }));
  }

  // Cancelar resposta pendente
  function cancelReply(key: string) {
    setPendingReplies(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Closer IA</h1>
          <p className="text-sm text-gray-500">Agente de vendas - gera resposta, voce aprova antes de enviar</p>
        </div>
        <button onClick={fetchMessages} disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400">
          {loading ? "Carregando..." : "Atualizar"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={() => setError("")} className="text-red-400 text-xs mt-1">Fechar</button>
        </div>
      )}

      {/* Respostas enviadas */}
      {sentResults.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800 mb-2">Respostas enviadas: {sentResults.length}</h3>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {sentResults.map((r, i) => (
              <div key={i} className="text-sm bg-green-100 p-2 rounded">
                <p className="text-gray-700"><strong>Pergunta:</strong> {r.question.slice(0, 80)}...</p>
                <p className="text-green-700"><strong>Resposta:</strong> {r.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== PERGUNTAS NO ANUNCIO (Pre-Venda) ===== */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Perguntas no Anuncio (Pre-Venda)</h2>
            <p className="text-sm text-gray-500">{questions.length} perguntas pendentes</p>
          </div>
          <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-medium">ML</span>
        </div>

        {loading ? (
          <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" /><p className="text-gray-500 mt-3">Buscando perguntas...</p></div>
        ) : questions.length === 0 ? (
          <div className="p-8 text-center text-gray-500"><p>Nenhuma pergunta pendente</p></div>
        ) : (
          <div className="divide-y">
            {questions.map((q) => {
              const key = `question-${q.id}`;
              const pending = pendingReplies[key];
              return (
                <div key={q.id} className="p-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {pending ? (
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block"></span><span className="text-xs font-bold text-green-600">RESPONDIDA</span></span>
                        ) : (
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block animate-pulse"></span><span className="text-xs font-bold text-red-600">NAO RESPONDIDA</span></span>
                        )}
                      </div>
                      <p className="text-gray-900 font-medium mb-1">{q.text}</p>
                      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>Produto: {q.itemTitle}</span>
                        {q.itemPrice > 0 && <span>R$ {q.itemPrice.toFixed(2)}</span>}
                        <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-medium">{q.storeName}</span>
                        <span>#{q.id}</span>
                      </div>
                    </div>
                    {!pending && (
                      <button onClick={() => generateReply("question", q.id, q.text, q.accountId, { itemTitle: q.itemTitle, totalAmount: q.itemPrice })}
                        disabled={generating === key}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:bg-gray-400 whitespace-nowrap">
                        {generating === key ? "Gerando..." : "Gerar Resposta IA"}
                      </button>
                    )}
                  </div>

                  {/* Resposta para aprovacao */}
                  {pending && (
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-xs text-blue-600 font-medium mb-2">Resposta gerada pela IA (edite se necessario):</p>
                      <textarea
                        value={pending.aiResponse}
                        onChange={(e) => editReply(key, e.target.value)}
                        className="w-full border rounded-lg p-2 text-sm text-gray-900 bg-white"
                        rows={3}
                      />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => approveAndSend(key)} disabled={sending === key}
                          className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:bg-gray-400">
                          {sending === key ? "Enviando..." : "Aprovar e Enviar"}
                        </button>
                        <button onClick={() => generateReply("question", q.id, q.text, q.accountId, { itemTitle: q.itemTitle })}
                          className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                          Regenerar
                        </button>
                        <button onClick={() => cancelReply(key)}
                          className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== MENSAGENS POS-VENDA ===== */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Mensagens Pos-Venda</h2>
            <p className="text-sm text-gray-500">{postSaleMessages.length} mensagens pendentes</p>
          </div>
          <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">Pos-Venda</span>
        </div>

        {postSaleMessages.length === 0 ? (
          <div className="p-8 text-center text-gray-500"><p>Nenhuma mensagem pos-venda pendente</p></div>
        ) : (
          <div className="divide-y">
            {postSaleMessages.map((msg) => {
              const key = `posvenda-${msg.id}`;
              const pending = pendingReplies[key];
              return (
                <div key={msg.id} className="p-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {pending ? (
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block"></span><span className="text-xs font-bold text-green-600">RESPONDIDA</span></span>
                        ) : (
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block animate-pulse"></span><span className="text-xs font-bold text-red-600">NAO RESPONDIDA</span></span>
                        )}
                        <span className="font-bold text-gray-900">{msg.fromName || "Comprador"}</span>
                        <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-medium">{msg.storeName}</span>
                      </div>
                      <p className="text-gray-900 mb-2 bg-gray-100 rounded-lg p-3">{msg.text}</p>
                      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>Pedido: #{msg.orderId}</span>
                        {msg.itemTitle && <span>Produto: {msg.itemTitle}</span>}
                        {msg.totalAmount > 0 && <span>R$ {msg.totalAmount.toFixed(2)}</span>}
                      </div>
                    </div>
                    {!pending && (
                      <button onClick={() => generateReply("posvenda", msg.id, msg.text, msg.accountId, { packId: msg.packId, buyerId: msg.from, itemTitle: msg.itemTitle, totalAmount: msg.totalAmount })}
                        disabled={generating === key}
                        className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 disabled:bg-gray-400 whitespace-nowrap">
                        {generating === key ? "Gerando..." : "Gerar Resposta IA"}
                      </button>
                    )}
                  </div>

                  {/* Resposta para aprovacao */}
                  {pending && (
                    <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <p className="text-xs text-orange-600 font-medium mb-2">Resposta gerada pela IA (edite se necessario):</p>
                      <textarea
                        value={pending.aiResponse}
                        onChange={(e) => editReply(key, e.target.value)}
                        className="w-full border rounded-lg p-2 text-sm text-gray-900 bg-white"
                        rows={3}
                      />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => approveAndSend(key)} disabled={sending === key}
                          className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:bg-gray-400">
                          {sending === key ? "Enviando..." : "Aprovar e Enviar"}
                        </button>
                        <button onClick={() => generateReply("posvenda", msg.id, msg.text, msg.accountId, { packId: msg.packId, buyerId: msg.from, itemTitle: msg.itemTitle, totalAmount: msg.totalAmount })}
                          className="px-4 py-1.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600">
                          Regenerar
                        </button>
                        <button onClick={() => cancelReply(key)}
                          className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-800 mb-2">Como funciona o Closer IA</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>1. Clique em Gerar Resposta IA - a IA cria a resposta</li>
          <li>2. Leia e edite se necessario</li>
          <li>3. Clique em Aprovar e Enviar para enviar ao cliente</li>
          <li>4. Ou Regenerar para uma nova resposta</li>
        </ul>
      </div>
    </div>
  );
}
