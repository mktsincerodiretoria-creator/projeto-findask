"use client";

import { useState } from "react";

export default function AnalistaPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");

  async function askAnalyst() {
    if (!query.trim()) return;
    setLoading(true);
    setResponse("");
    setError("");
    try {
      const res = await fetch("/api/analista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (data.response) {
        setResponse(data.response);
      } else {
        setError(data.error || "Erro ao analisar");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analista Senior</h1>
        <p className="text-sm text-gray-500">Inteligencia artificial para analise estrategica do seu negocio</p>
      </div>

      {/* Input de pergunta */}
      <div className="bg-white rounded-lg border p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Pergunte ao Analista</label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex: Qual produto tem a melhor margem? Devo investir mais em ads? Qual SKU devo cortar do estoque?"
          className="w-full border rounded-lg p-3 text-sm text-gray-900 bg-gray-50 min-h-[80px]"
          rows={3}
        />
        <button
          onClick={askAnalyst}
          disabled={loading || !query.trim()}
          className="mt-3 px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400"
        >
          {loading ? "Analisando..." : "Analisar"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Resposta do analista */}
      {response && (
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🧠</span>
            <h2 className="font-bold text-gray-900">Analise do Analista Senior</h2>
          </div>
          <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">{response}</div>
        </div>
      )}

      {/* Sugestoes rapidas */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="font-semibold text-gray-800 mb-3">Perguntas sugeridas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[
            "Faz a Curva ABC dos meus SKUs e me diz quais cortar",
            "Quais produtos devo replicar entre minhas contas?",
            "Analise a elasticidade de preco dos meus top 5 produtos",
            "Qual plataforma esta mais lucrativa e por que?",
            "Faz a analise SWOT do meu nicho principal",
            "Quais SKUs tem margem negativa? O que fazer?",
            "Onde estou perdendo dinheiro com frete?",
            "Qual produto devo escalar primeiro e como?",
            "Compare a performance entre minhas contas",
            "Quais oportunidades ocultas voce ve nos meus dados?",
            "Me da um plano de acao para a proxima semana",
            "Analise meu investimento em ADS - esta valendo?",
          ].map((suggestion, i) => (
            <button
              key={i}
              onClick={() => { setQuery(suggestion); }}
              className="text-left px-4 py-2.5 bg-gray-50 hover:bg-indigo-50 rounded-lg text-sm text-gray-700 hover:text-indigo-700 border hover:border-indigo-200 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
