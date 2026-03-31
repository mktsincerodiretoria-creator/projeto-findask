"use client";

import { useState } from "react";
import ProgressBar from "@/components/ProgressBar";

const TABS = [
  { id: "perguntar", label: "Perguntar", icon: "💬" },
  { id: "abc", label: "Curva ABC", icon: "📊" },
  { id: "contas", label: "Entre Contas", icon: "🔄" },
  { id: "concorrencia", label: "Concorrencia", icon: "🎯" },
  { id: "voz", label: "Voz do Cliente", icon: "🗣️" },
  { id: "preco", label: "Elasticidade Preco", icon: "💲" },
  { id: "stp", label: "Analise STP", icon: "🧩" },
];

interface AnalysisResult {
  text: string;
  data?: Record<string, unknown>;
}

export default function AnalistaPage() {
  const [activeTab, setActiveTab] = useState("perguntar");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Record<string, AnalysisResult>>({});
  const [error, setError] = useState("");

  async function runAnalysis(type: string, customQuery?: string) {
    setLoading(true);
    setProgress(5);
    setError("");

    const queries: Record<string, string> = {
      abc: "Faca a analise Curva ABC completa dos meus SKUs. Classifique cada produto em A (80% receita), B (15%) e C (5%). Para cada um me diga: SKU, nome, vendas 30d, receita, margem, classificacao. Me diga quais CORTAR (classe C com margem negativa), quais OTIMIZAR (classe B) e quais ESCALAR (classe A). Formate em tabela.",
      contas: "Analise ENTRE CONTAS: Compare todas as minhas contas conectadas. Para cada produto, identifique: 1) Produtos que existem em uma conta mas NAO em outra (oportunidade de replicacao) 2) Mesmo produto com performance diferente entre contas 3) Oportunidades ocultas. Formate em tabela comparativa.",
      concorrencia: "Faca o mapeamento de concorrencia dos meus TOP 10 produtos. Para cada um analise: posicionamento de preco vs mercado, margem atual, volume de vendas, e sugira acoes especificas (ajustar preco, melhorar titulo, investir em ads). Formate em tabela.",
      voz: "Analise a voz do cliente baseado nos meus produtos. Identifique: 1) Quais produtos tem mais reclamacoes potenciais 2) Onde posso melhorar titulo/descricao 3) Oportunidades de diferenciacao 4) Objecoes que preciso quebrar. Formate com acoes praticas por SKU.",
      preco: "Faca analise de elasticidade de preco dos meus TOP 10 produtos. Para cada um: preco atual, margem atual, sugestao de teste (ex: -R$2 ou +R$3), impacto estimado na conversao, e se vale a pena. Formate em tabela com acoes.",
      stp: "Faca a analise STP simplificada: 1) Segmentos de clientes para cada categoria de produto 2) Possiveis reposicionamentos 3) Angulos de venda diferentes (titulo, imagem, publico). Formate com sugestoes praticas.",
    };

    const q = customQuery || queries[type] || query;
    if (!q.trim()) { setLoading(false); return; }

    // Simula progresso
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 85) { clearInterval(interval); return 85; }
        return prev + Math.random() * 8;
      });
    }, 500);

    try {
      const res = await fetch("/api/analista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();

      clearInterval(interval);
      setProgress(100);

      if (data.response) {
        setResults(prev => ({ ...prev, [type || "perguntar"]: { text: data.response } }));
      } else {
        setError(data.error || "Erro ao analisar");
      }
    } catch (e) {
      clearInterval(interval);
      setError(String(e));
    } finally {
      setTimeout(() => { setLoading(false); setProgress(0); }, 500);
    }
  }

  const currentResult = results[activeTab];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analista Senior</h1>
        <p className="text-sm text-gray-500">Inteligencia artificial para analise estrategica do seu negocio</p>
      </div>

      {/* Barra de progresso */}
      <ProgressBar progress={progress} show={loading} label={loading ? `Analisando... ${Math.round(progress)}%` : undefined} />

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? "bg-white text-indigo-700 border border-b-0 border-gray-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={() => setError("")} className="text-red-400 text-xs">Fechar</button>
        </div>
      )}

      {/* Conteudo da aba */}
      <div className="bg-white rounded-lg border p-6">
        {/* ABA: Perguntar */}
        {activeTab === "perguntar" && (
          <div className="space-y-4">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pergunte qualquer coisa sobre seu negocio..."
              className="w-full border rounded-lg p-3 text-sm text-gray-900 bg-gray-50 min-h-[80px]"
              rows={3}
            />
            <button onClick={() => runAnalysis("perguntar", query)} disabled={loading || !query.trim()}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
              {loading ? "Analisando..." : "Analisar"}
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
              {[
                "Faz a Curva ABC dos meus SKUs e me diz quais cortar",
                "Quais produtos devo replicar entre minhas contas?",
                "Analise a elasticidade de preco dos meus top 5 produtos",
                "Qual plataforma esta mais lucrativa e por que?",
                "Quais SKUs tem margem negativa? O que fazer?",
                "Onde estou perdendo dinheiro com frete?",
                "Qual produto devo escalar primeiro e como?",
                "Compare a performance entre minhas contas",
                "Me da um plano de acao para a proxima semana",
                "Analise meu investimento em ADS - esta valendo?",
                "Quais oportunidades ocultas voce ve nos meus dados?",
                "Faz a analise SWOT do meu nicho principal",
              ].map((s, i) => (
                <button key={i} onClick={() => { setQuery(s); runAnalysis("perguntar", s); }}
                  className="text-left px-3 py-2 bg-gray-50 hover:bg-indigo-50 rounded-lg text-xs text-gray-700 hover:text-indigo-700 border hover:border-indigo-200">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ABA: Curva ABC */}
        {activeTab === "abc" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Curva ABC dos SKUs</h2>
                <p className="text-sm text-gray-500">Classificacao A (80% receita), B (15%), C (5%)</p>
              </div>
              <button onClick={() => runAnalysis("abc")} disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
                {loading ? "Analisando..." : "Analisar Curva ABC"}
              </button>
            </div>
          </div>
        )}

        {/* ABA: Entre Contas */}
        {activeTab === "contas" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Analise Entre Contas</h2>
                <p className="text-sm text-gray-500">Oportunidades de replicacao e comparacao de performance</p>
              </div>
              <button onClick={() => runAnalysis("contas")} disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
                {loading ? "Analisando..." : "Analisar Contas"}
              </button>
            </div>
          </div>
        )}

        {/* ABA: Concorrencia */}
        {activeTab === "concorrencia" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Mapeamento de Concorrencia</h2>
                <p className="text-sm text-gray-500">Benchmarking de preco, posicionamento e visibilidade</p>
              </div>
              <button onClick={() => runAnalysis("concorrencia")} disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
                {loading ? "Analisando..." : "Analisar Concorrencia"}
              </button>
            </div>
          </div>
        )}

        {/* ABA: Voz do Cliente */}
        {activeTab === "voz" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Analise de Voz do Cliente</h2>
                <p className="text-sm text-gray-500">Reclamacoes, elogios, objecoes e oportunidades</p>
              </div>
              <button onClick={() => runAnalysis("voz")} disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
                {loading ? "Analisando..." : "Analisar Voz do Cliente"}
              </button>
            </div>
          </div>
        )}

        {/* ABA: Elasticidade de Preco */}
        {activeTab === "preco" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Elasticidade de Preco</h2>
                <p className="text-sm text-gray-500">Testes de preco, impacto na conversao e margem</p>
              </div>
              <button onClick={() => runAnalysis("preco")} disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
                {loading ? "Analisando..." : "Analisar Precos"}
              </button>
            </div>
          </div>
        )}

        {/* ABA: STP */}
        {activeTab === "stp" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Analise STP</h2>
                <p className="text-sm text-gray-500">Segmentacao, posicionamento e angulos de venda</p>
              </div>
              <button onClick={() => runAnalysis("stp")} disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">
                {loading ? "Analisando..." : "Analisar STP"}
              </button>
            </div>
          </div>
        )}

        {/* Resultado da analise */}
        {currentResult && (
          <div className="mt-6 border-t pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🧠</span>
              <h3 className="font-bold text-gray-900">Resultado da Analise</h3>
            </div>
            <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap bg-gray-50 rounded-lg p-4 leading-relaxed">
              {currentResult.text}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
