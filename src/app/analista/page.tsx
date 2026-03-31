"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import ProgressBar from "@/components/ProgressBar";
import { formatCurrency } from "@/lib/utils";

interface SkuRow { sku: string; title: string; sold: number; revenue: number; cost: number; margin: number; marginPct: number; abc: string; accounts: Array<{name: string; platform: string}> }
interface PlatformRow { platform: string; revenue: number; orders: number }
interface AccountRow { name: string; platform: string; revenue: number; orders: number; skus: number }
interface CrossRow { sku: string; title: string; presentIn: string[]; missingIn: string[] }
interface DailyRow { date: string; revenue: number; orders: number }

const TABS = [
  { id: "perguntar", label: "Perguntar", icon: "💬" },
  { id: "abc", label: "Curva ABC", icon: "📊" },
  { id: "contas", label: "Entre Contas", icon: "🔄" },
  { id: "concorrencia", label: "Concorrencia", icon: "🎯" },
  { id: "voz", label: "Voz Cliente", icon: "🗣️" },
  { id: "preco", label: "Preco", icon: "💲" },
  { id: "stp", label: "STP", icon: "🧩" },
];

const COLORS = ["#22c55e", "#3b82f6", "#ef4444", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];
const ABC_COLORS: Record<string, string> = { A: "#22c55e", B: "#3b82f6", C: "#ef4444" };

export default function AnalistaPage() {
  const [tab, setTab] = useState("abc");
  const [data, setData] = useState<{abcData: SkuRow[]; abcSummary: Record<string,number>; platforms: PlatformRow[]; accounts: AccountRow[]; crossAccount: CrossRow[]; daily: DailyRow[]; totals: Record<string,number>} | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiResult, setAiResult] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true); setProgress(10);
    const iv = setInterval(() => setProgress(p => Math.min(p + 15, 85)), 300);
    try {
      const res = await fetch("/api/analista/data");
      const d = await res.json();
      setData(d);
    } catch (e) { setError(String(e)); }
    finally { clearInterval(iv); setProgress(100); setTimeout(() => { setLoading(false); setProgress(0); }, 400); }
  }

  async function runAI(type: string, q: string) {
    setAiLoading(true); setAiProgress(5); setError("");
    const iv = setInterval(() => setAiProgress(p => Math.min(p + Math.random() * 8, 88)), 500);
    try {
      const res = await fetch("/api/analista", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const d = await res.json();
      clearInterval(iv); setAiProgress(100);
      if (d.response) setAiResult(prev => ({ ...prev, [type]: d.response }));
      else setError(d.error || "Erro");
    } catch (e) { clearInterval(iv); setError(String(e)); }
    finally { setTimeout(() => { setAiLoading(false); setAiProgress(0); }, 400); }
  }

  const abc = data?.abcData || [];
  const abcS = data?.abcSummary || { A: 0, B: 0, C: 0, revenueA: 0, revenueB: 0, revenueC: 0 };
  const plat = data?.platforms || [];
  const accs = data?.accounts || [];
  const cross = data?.crossAccount || [];
  const daily = data?.daily || [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Analista Senior</h1>
      <ProgressBar progress={loading ? progress : aiProgress} show={loading || aiLoading} label={loading ? `Carregando dados... ${Math.round(progress)}%` : `Analisando... ${Math.round(aiProgress)}%`} />

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-0 border-b">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg ${tab === t.id ? "bg-white text-indigo-700 border border-b-0 border-gray-200" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">{error} <button onClick={() => setError("")} className="ml-2 text-xs text-red-400">x</button></div>}

      {/* PERGUNTAR */}
      {tab === "perguntar" && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <textarea value={query} onChange={e => setQuery(e.target.value)} placeholder="Pergunte qualquer coisa..." className="w-full border rounded-lg p-3 text-sm bg-gray-50 min-h-[80px]" rows={3} />
          <button onClick={() => runAI("q", query)} disabled={aiLoading || !query.trim()} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">{aiLoading ? "Analisando..." : "Analisar"}</button>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {["Curva ABC e quais SKUs cortar", "Quais produtos replicar entre contas?", "Onde estou perdendo dinheiro?", "Qual produto escalar primeiro?", "Analise meu investimento em ADS", "Plano de acao para proxima semana", "SKUs com margem negativa", "Qual plataforma mais lucrativa?", "Analise SWOT do meu nicho"].map((s, i) => (
              <button key={i} onClick={() => { setQuery(s); runAI("q", s); }} className="text-left px-3 py-2 bg-gray-50 hover:bg-indigo-50 rounded-lg text-xs text-gray-700 hover:text-indigo-700 border">{s}</button>
            ))}
          </div>
          {aiResult.q && <div className="mt-4 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-sm text-gray-800">{aiResult.q}</div>}
        </div>
      )}

      {/* CURVA ABC */}
      {tab === "abc" && (
        <div className="space-y-4">
          {/* Cards resumo */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-green-700">{abcS.A}</p>
              <p className="text-sm text-green-600 font-medium">Classe A (80% receita)</p>
              <p className="text-lg font-bold text-green-800 mt-1">{formatCurrency(abcS.revenueA || 0)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-blue-700">{abcS.B}</p>
              <p className="text-sm text-blue-600 font-medium">Classe B (15% receita)</p>
              <p className="text-lg font-bold text-blue-800 mt-1">{formatCurrency(abcS.revenueB || 0)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-red-700">{abcS.C}</p>
              <p className="text-sm text-red-600 font-medium">Classe C (5% receita)</p>
              <p className="text-lg font-bold text-red-800 mt-1">{formatCurrency(abcS.revenueC || 0)}</p>
            </div>
          </div>

          {/* Graficos lado a lado */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Distribuicao ABC (Receita)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={[{ name: "A", value: abcS.revenueA || 0 }, { name: "B", value: abcS.revenueB || 0 }, { name: "C", value: abcS.revenueC || 0 }]} cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`} dataKey="value">
                    <Cell fill="#22c55e" />
                    <Cell fill="#3b82f6" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Top 10 SKUs por Receita</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={abc.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sku" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  <Bar dataKey="revenue" name="Receita" fill="#3b82f6" />
                  <Bar dataKey="margin" name="Margem" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela ABC */}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <div className="p-3 border-b flex justify-between items-center">
              <h3 className="font-semibold text-gray-800">Todos os SKUs - Classificacao ABC</h3>
              <button onClick={() => runAI("abc", "Faca a analise Curva ABC completa dos meus SKUs. Classifique e diga quais cortar, otimizar e escalar.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-400">{aiLoading ? "..." : "Analisar com IA"}</button>
            </div>
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">ABC</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">SKU</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Produto</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Vendas</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Receita</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Custo</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Margem</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">MC%</th>
                </tr>
              </thead>
              <tbody>
                {abc.map((s, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-bold text-white`} style={{backgroundColor: ABC_COLORS[s.abc]}}>{s.abc}</span></td>
                    <td className="px-3 py-2 font-mono text-xs">{s.sku}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate">{s.title}</td>
                    <td className="px-3 py-2 text-right font-medium">{s.sold}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(s.revenue)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(s.cost)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${s.margin >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(s.margin)}</td>
                    <td className={`px-3 py-2 text-right ${s.marginPct >= 20 ? "text-green-600" : s.marginPct >= 0 ? "text-yellow-600" : "text-red-600"}`}>{s.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aiResult.abc && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm text-gray-800">{aiResult.abc}</div>}
        </div>
      )}

      {/* ENTRE CONTAS */}
      {tab === "contas" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Receita por Conta</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={accs}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  <Bar dataKey="revenue" name="Receita" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Receita por Plataforma</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={plat} cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`} dataKey="revenue" nameKey="platform">
                    {plat.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela contas */}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <div className="p-3 border-b flex justify-between items-center">
              <h3 className="font-semibold text-gray-800">Performance por Conta</h3>
              <button onClick={() => runAI("contas", "Compare performance entre minhas contas. Quais produtos replicar? Onde esta forte/fraco?")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading ? "..." : "Analisar com IA"}</button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Conta</th><th className="text-left px-3 py-2">Plataforma</th><th className="text-right px-3 py-2">Receita</th><th className="text-right px-3 py-2">Pedidos</th><th className="text-right px-3 py-2">SKUs</th><th className="text-right px-3 py-2">Ticket Medio</th></tr></thead>
              <tbody>{accs.map((a, i) => (<tr key={i} className="border-t hover:bg-gray-50"><td className="px-3 py-2 font-medium">{a.name}</td><td className="px-3 py-2">{a.platform}</td><td className="px-3 py-2 text-right font-bold">{formatCurrency(a.revenue)}</td><td className="px-3 py-2 text-right">{a.orders}</td><td className="px-3 py-2 text-right">{a.skus}</td><td className="px-3 py-2 text-right">{formatCurrency(a.orders > 0 ? a.revenue / a.orders : 0)}</td></tr>))}</tbody>
            </table>
          </div>

          {/* Oportunidades cross-account */}
          {cross.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-800 mb-2">Oportunidades de Replicacao ({cross.length})</h3>
              <div className="space-y-2">{cross.slice(0, 10).map((c, i) => (
                <div key={i} className="bg-white rounded-lg p-3 border text-sm">
                  <span className="font-mono font-bold">{c.sku}</span> - {c.title}
                  <div className="text-xs mt-1"><span className="text-green-600">Presente: {c.presentIn.join(", ")}</span> | <span className="text-red-600">Falta: {c.missingIn.join(", ")}</span></div>
                </div>
              ))}</div>
            </div>
          )}
          {aiResult.contas && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.contas}</div>}
        </div>
      )}

      {/* CONCORRENCIA */}
      {tab === "concorrencia" && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-800 mb-3">Evolucao de Receita (30 dias)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={10} tickFormatter={v => v.slice(5)} /><YAxis fontSize={10} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} /><Legend />
                <Line type="monotone" dataKey="revenue" name="Receita" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
            <div><h3 className="font-semibold">Mapeamento de Concorrencia</h3><p className="text-sm text-gray-500">Analise de posicionamento, preco e visibilidade</p></div>
            <button onClick={() => runAI("concorrencia", "Mapeie a concorrencia dos meus TOP 10 produtos. Preco vs mercado, margem, volume, acoes especificas.")} disabled={aiLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-400">{aiLoading ? "Analisando..." : "Analisar Concorrencia"}</button>
          </div>
          {aiResult.concorrencia && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.concorrencia}</div>}
        </div>
      )}

      {/* VOZ DO CLIENTE */}
      {tab === "voz" && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-800 mb-3">Top SKUs por Volume (potencial de reviews)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={abc.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="sku" fontSize={10} /><YAxis fontSize={10} />
                <Tooltip /><Bar dataKey="sold" name="Unidades Vendidas" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
            <div><h3 className="font-semibold">Analise de Voz do Cliente</h3><p className="text-sm text-gray-500">Reclamacoes, elogios, objecoes e diferenciacao</p></div>
            <button onClick={() => runAI("voz", "Analise voz do cliente dos meus produtos. Reclamacoes potenciais, melhorias em titulo/descricao, objecoes a quebrar.")} disabled={aiLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-400">{aiLoading ? "Analisando..." : "Analisar"}</button>
          </div>
          {aiResult.voz && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.voz}</div>}
        </div>
      )}

      {/* ELASTICIDADE DE PRECO */}
      {tab === "preco" && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-800 mb-3">Margem vs Receita por SKU</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={abc.filter(s => s.revenue > 0).slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="sku" fontSize={10} /><YAxis fontSize={10} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} /><Legend />
                <Bar dataKey="revenue" name="Receita" fill="#3b82f6" />
                <Bar dataKey="cost" name="Custo" fill="#ef4444" />
                <Bar dataKey="margin" name="Margem" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
            <div><h3 className="font-semibold">Elasticidade de Preco</h3><p className="text-sm text-gray-500">Testes de preco, impacto na conversao e margem</p></div>
            <button onClick={() => runAI("preco", "Analise elasticidade de preco dos meus TOP 10 produtos. Preco atual, margem, sugestao de teste, impacto estimado.")} disabled={aiLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-400">{aiLoading ? "Analisando..." : "Analisar Precos"}</button>
          </div>
          {aiResult.preco && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.preco}</div>}
        </div>
      )}

      {/* STP */}
      {tab === "stp" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Distribuicao por Plataforma</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart><Pie data={plat} cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`} dataKey="orders" nameKey="platform">
                  {plat.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Pedidos por Dia</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={10} tickFormatter={v => v.slice(5)} /><YAxis fontSize={10} />
                <Tooltip /><Line type="monotone" dataKey="orders" name="Pedidos" stroke="#8b5cf6" strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
            <div><h3 className="font-semibold">Analise STP</h3><p className="text-sm text-gray-500">Segmentacao, posicionamento e angulos de venda</p></div>
            <button onClick={() => runAI("stp", "Faca analise STP: segmentos de clientes, reposicionamentos, angulos de venda diferentes por produto.")} disabled={aiLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-400">{aiLoading ? "Analisando..." : "Analisar STP"}</button>
          </div>
          {aiResult.stp && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.stp}</div>}
        </div>
      )}
    </div>
  );
}
