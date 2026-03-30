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

interface AnswerResult {
  questionId: number;
  status: string;
  question: string;
  answer: string;
  item?: string;
  error?: string;
}

export default function MensagensPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [autoReplying, setAutoReplying] = useState(false);
  const [results, setResults] = useState<AnswerResult[]>([]);
  const [error, setError] = useState("");

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
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  async function answerOne(questionId: number) {
    setAnswering(true);
    try {
      const res = await fetch("/api/messages/mercadolivre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", questionId, accountId: questions.find(q => q.id === questionId)?.accountId }),
      });
      const data = await res.json();
      if (data.status === "answered") {
        setResults((prev) => [...prev, data]);
        setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      } else {
        setError(data.error || "Erro ao responder");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAnswering(false);
    }
  }

  async function autoReplyAll() {
    if (!confirm(`Responder automaticamente ${questions.length} perguntas com IA?`)) return;
    setAutoReplying(true);
    setResults([]);
    try {
      const res = await fetch("/api/messages/mercadolivre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReplyAll: true }),
      });
      const data = await res.json();
      setResults(data.results || []);
      fetchMessages();
    } catch (e) {
      setError(String(e));
    } finally {
      setAutoReplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Central de Mensagens</h1>
          <p className="text-sm text-gray-500">
            Respostas automaticas com IA para fechar vendas
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchMessages}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? "Carregando..." : "Atualizar"}
          </button>
          {questions.length > 0 && (
            <button
              onClick={autoReplyAll}
              disabled={autoReplying}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:bg-gray-400"
            >
              {autoReplying ? "Respondendo com IA..." : `Responder Todas (${questions.length}) com IA`}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Resultados das respostas automaticas */}
      {results.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800 mb-2">
            Respostas enviadas: {results.filter(r => r.status === "answered").length} de {results.length}
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`text-sm p-2 rounded ${r.status === "answered" ? "bg-green-100" : "bg-red-100"}`}>
                <p className="text-gray-700"><strong>Pergunta:</strong> {r.question}</p>
                <p className={r.status === "answered" ? "text-green-700" : "text-red-700"}>
                  <strong>Resposta IA:</strong> {r.answer || r.error}
                </p>
                {r.item && <p className="text-gray-500 text-xs">Produto: {r.item}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Perguntas do Mercado Livre */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Mercado Livre - Perguntas no Anuncio</h2>
            <p className="text-sm text-gray-500">{questions.length} perguntas pendentes</p>
          </div>
          <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-medium">
            ML
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            <p className="text-gray-500 mt-3">Buscando perguntas...</p>
          </div>
        ) : questions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg mb-1">Nenhuma pergunta pendente</p>
            <p className="text-sm">Todas as perguntas foram respondidas!</p>
          </div>
        ) : (
          <div className="divide-y">
            {questions.map((q) => (
              <div key={q.id} className="p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <p className="text-gray-900 font-medium mb-1">{q.text}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span title={q.itemTitle} className="max-w-[300px] truncate">
                        Produto: {q.itemTitle}
                      </span>
                      {q.itemPrice > 0 && <span>R$ {q.itemPrice.toFixed(2)}</span>}
                      <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-medium">{q.storeName}</span>
                      <span>{new Date(q.date).toLocaleString("pt-BR")}</span>
                      <span className="font-mono text-gray-400">#{q.id}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => answerOne(q.id)}
                    disabled={answering}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:bg-gray-400 whitespace-nowrap"
                  >
                    {answering ? "..." : "Responder com IA"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shopee - Placeholder */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Shopee - Chat</h2>
            <p className="text-sm text-gray-500">Aguardando aprovacao da API</p>
          </div>
          <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">
            Shopee
          </span>
        </div>
        <div className="p-8 text-center text-gray-400">
          Disponivel apos aprovacao do app na Shopee Open Platform
        </div>
      </div>

      {/* Info do Agente */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-800 mb-2">Sobre o Agente de Vendas IA</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>Usa Google Gemini para gerar respostas inteligentes</li>
          <li>Treinado com taticas de vendas para fechar negocios</li>
          <li>NAO pede dados pessoais, NAO induz cancelamento</li>
          <li>Analisa o produto e preco para personalizar a resposta</li>
          <li>Respostas curtas e objetivas (limite de caracteres do ML)</li>
        </ul>
      </div>
    </div>
  );
}
