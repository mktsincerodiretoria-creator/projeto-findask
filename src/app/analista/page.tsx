"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter, LineChart, Line } from "recharts";
import ProgressBar from "@/components/ProgressBar";
import { formatCurrency } from "@/lib/utils";

interface SkuRow { sku: string; title: string; sold: number; revenue: number; cost: number; margin: number; marginPct: number; abc: string }
interface BcgRow { sku: string; title: string; revenue30d: number; growth: number; share: number; quadrant: string; margin: number; marginPct: number }
interface AccOption { id: string; nickname: string | null; platform: string }

const TABS = [
  { id: "perguntar", label: "Perguntar", icon: "💬" },
  { id: "abc", label: "Curva ABC", icon: "📊" },
  { id: "bcg", label: "Matriz BCG", icon: "🎯" },
  { id: "contas", label: "Entre Contas", icon: "🔄" },
  { id: "voz", label: "Voz Cliente", icon: "🗣️" },
  { id: "stp", label: "STP", icon: "🧩" },
  { id: "preco", label: "Preco", icon: "💲" },
  { id: "concorrencia", label: "Concorrencia", icon: "🔍" },
];

const ABC_COLORS: Record<string, string> = { A: "#22c55e", B: "#3b82f6", C: "#ef4444" };
const BCG_COLORS: Record<string, string> = { Estrela: "#f59e0b", "Vaca Leiteira": "#22c55e", Interrogacao: "#3b82f6", Abacaxi: "#ef4444" };
const COLORS = ["#22c55e", "#3b82f6", "#ef4444", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];

export default function AnalistaPage() {
  const [tab, setTab] = useState("abc");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [bcgFilter, setBcgFilter] = useState<string | null>(null); // quadrant filter for BCG
  const [bcgPlatform, setBcgPlatform] = useState(""); // platform filter for BCG
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiResult, setAiResult] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");

  const fetchData = useCallback(async (accId?: string) => {
    setLoading(true); setProgress(10);
    const iv = setInterval(() => setProgress(p => Math.min(p + 12, 85)), 300);
    try {
      const params = accId ? `?accountId=${accId}` : "";
      const res = await fetch(`/api/analista/data${params}`);
      setData(await res.json());
    } catch (e) { setError(String(e)); }
    finally { clearInterval(iv); setProgress(100); setTimeout(() => { setLoading(false); setProgress(0); }, 400); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onAccountChange(accId: string) {
    setSelectedAccount(accId);
    fetchData(accId || undefined);
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

  const abc: SkuRow[] = data?.abcData || [];
  const abcS = data?.abcSummary || {};
  const bcg: BcgRow[] = data?.bcgData || [];
  // problematic not used in UI anymore (replaced by vozClienteData)
  const rising: BcgRow[] = data?.rising || [];
  const falling: BcgRow[] = data?.falling || [];
  const accs = data?.accounts || [];
  const accOptions: AccOption[] = data?.accountOptions || [];
  const plat = data?.platforms || [];
  const cross = data?.crossAccount || [];
  const daily = data?.daily || [];

  // Filtro de conta (renderizado em cada aba)
  const AccountFilter = () => accOptions.length > 1 ? (
    <select value={selectedAccount} onChange={e => onAccountChange(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
      <option value="">Todas as contas ({accOptions.length})</option>
      {accOptions.map(a => <option key={a.id} value={a.id}>{a.nickname || a.platform}</option>)}
    </select>
  ) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Analista Senior</h1>
      <ProgressBar progress={loading ? progress : aiProgress} show={loading || aiLoading} label={loading ? `Carregando... ${Math.round(progress)}%` : `Analisando... ${Math.round(aiProgress)}%`} />

      <div className="flex gap-1 overflow-x-auto pb-0 border-b">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg ${tab === t.id ? "bg-white text-indigo-700 border border-b-0 border-gray-200" : "text-gray-500 hover:bg-gray-50"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">{error} <button onClick={() => setError("")} className="ml-2 text-xs">x</button></div>}

      {/* ===== PERGUNTAR ===== */}
      {tab === "perguntar" && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <textarea value={query} onChange={e => setQuery(e.target.value)} placeholder="Pergunte qualquer coisa..." className="w-full border rounded-lg p-3 text-sm bg-gray-50 min-h-[80px]" rows={3} />
          <button onClick={() => runAI("q", query)} disabled={aiLoading || !query.trim()} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-400">{aiLoading ? "Analisando..." : "Analisar"}</button>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {["Curva ABC e quais SKUs cortar", "Quais produtos replicar entre contas?", "Onde estou perdendo dinheiro?", "Qual produto escalar primeiro?", "Plano de acao para proxima semana", "Analise SWOT do meu nicho"].map((s, i) => (
              <button key={i} onClick={() => { setQuery(s); runAI("q", s); }} className="text-left px-3 py-2 bg-gray-50 hover:bg-indigo-50 rounded-lg text-xs text-gray-700 hover:text-indigo-700 border">{s}</button>
            ))}
          </div>
          {aiResult.q && <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-sm">{aiResult.q}</div>}
        </div>
      )}

      {/* ===== CURVA ABC ===== */}
      {tab === "abc" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-lg font-bold">Curva ABC</h2>
            <div className="flex gap-2 items-center">
              <AccountFilter />
              <button onClick={() => runAI("abc", "Curva ABC completa. Quais cortar, otimizar e escalar.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading ? "..." : "Analisar com IA"}</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center"><p className="text-3xl font-bold text-green-700">{abcS.A || 0}</p><p className="text-sm text-green-600">Classe A (80%)</p><p className="font-bold text-green-800">{formatCurrency(abcS.revenueA || 0)}</p></div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center"><p className="text-3xl font-bold text-blue-700">{abcS.B || 0}</p><p className="text-sm text-blue-600">Classe B (15%)</p><p className="font-bold text-blue-800">{formatCurrency(abcS.revenueB || 0)}</p></div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center"><p className="text-3xl font-bold text-red-700">{abcS.C || 0}</p><p className="text-sm text-red-600">Classe C (5%)</p><p className="font-bold text-red-800">{formatCurrency(abcS.revenueC || 0)}</p></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Distribuicao ABC</h3><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={[{name:"A",value:abcS.revenueA||0},{name:"B",value:abcS.revenueB||0},{name:"C",value:abcS.revenueC||0}]} cx="50%" cy="50%" outerRadius={75} label={({name,percent})=>`${name}: ${((percent||0)*100).toFixed(0)}%`} dataKey="value"><Cell fill="#22c55e"/><Cell fill="#3b82f6"/><Cell fill="#ef4444"/></Pie><Tooltip formatter={(v)=>formatCurrency(Number(v))}/></PieChart></ResponsiveContainer></div>
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Top 10 - Receita vs Margem</h3><ResponsiveContainer width="100%" height={220}><BarChart data={abc.slice(0,10)}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="sku" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>formatCurrency(Number(v))}/><Bar dataKey="revenue" name="Receita" fill="#3b82f6"/><Bar dataKey="margin" name="Margem" fill="#22c55e"/></BarChart></ResponsiveContainer></div>
          </div>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]"><thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">ABC</th><th className="text-left px-3 py-2">SKU</th><th className="text-left px-3 py-2">Produto</th><th className="text-right px-3 py-2">Vendas</th><th className="text-right px-3 py-2">Receita</th><th className="text-right px-3 py-2">Margem</th><th className="text-right px-3 py-2">MC%</th></tr></thead>
            <tbody>{abc.map((s,i)=>(<tr key={i} className="border-t hover:bg-gray-50"><td className="px-3 py-1.5"><span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{backgroundColor:ABC_COLORS[s.abc]}}>{s.abc}</span></td><td className="px-3 py-1.5 font-mono text-xs">{s.sku}</td><td className="px-3 py-1.5 max-w-[150px] truncate">{s.title}</td><td className="px-3 py-1.5 text-right">{s.sold}</td><td className="px-3 py-1.5 text-right">{formatCurrency(s.revenue)}</td><td className={`px-3 py-1.5 text-right font-bold ${s.margin>=0?"text-green-600":"text-red-600"}`}>{formatCurrency(s.margin)}</td><td className={`px-3 py-1.5 text-right ${s.marginPct>=20?"text-green-600":s.marginPct>=0?"text-yellow-600":"text-red-600"}`}>{s.marginPct}%</td></tr>))}</tbody></table>
          </div>
          {aiResult.abc && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.abc}</div>}
        </div>
      )}

      {/* ===== MATRIZ BCG ===== */}
      {tab === "bcg" && (() => {
        // Filtra BCG por plataforma e conta
        const filteredBcg = bcg.filter((s: BcgRow & {platforms?: string[]}) => {
          if (bcgPlatform && s.platforms && !s.platforms.includes(bcgPlatform)) return false;
          return true;
        });
        const visibleBcg = bcgFilter ? filteredBcg.filter((s: BcgRow) => s.quadrant === bcgFilter) : filteredBcg;

        return (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-lg font-bold">Matriz BCG</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <select value={bcgPlatform} onChange={e => setBcgPlatform(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
                <option value="">Todas as plataformas</option>
                <option value="MERCADO_LIVRE">Mercado Livre</option>
                <option value="SHOPEE">Shopee</option>
                <option value="AMAZON">Amazon</option>
                <option value="TIKTOK_SHOP">TikTok Shop</option>
              </select>
              <AccountFilter />
              <button onClick={() => runAI("bcg", "Analise a matriz BCG dos meus produtos. Quais sao Estrela, Vaca Leiteira, Interrogacao e Abacaxi? O que fazer com cada um?")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading ? "..." : "Analisar com IA"}</button>
            </div>
          </div>

          {/* Cards clicaveis */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {q:"Estrela",icon:"⭐",color:"bg-yellow-50 border-yellow-200 hover:bg-yellow-100",text:"text-yellow-700",ring:"ring-yellow-400"},
              {q:"Vaca Leiteira",icon:"🐄",color:"bg-green-50 border-green-200 hover:bg-green-100",text:"text-green-700",ring:"ring-green-400"},
              {q:"Interrogacao",icon:"❓",color:"bg-blue-50 border-blue-200 hover:bg-blue-100",text:"text-blue-700",ring:"ring-blue-400"},
              {q:"Abacaxi",icon:"🍍",color:"bg-red-50 border-red-200 hover:bg-red-100",text:"text-red-700",ring:"ring-red-400"},
            ].map(({q,icon,color,text,ring})=>(
              <button key={q} onClick={() => setBcgFilter(bcgFilter === q ? null : q)}
                className={`${color} border-2 rounded-lg p-3 text-center cursor-pointer transition-all ${bcgFilter === q ? `ring-2 ${ring} shadow-lg scale-105` : ""}`}>
                <p className="text-2xl">{icon}</p>
                <p className={`text-2xl font-bold ${text}`}>{filteredBcg.filter((s: BcgRow) => s.quadrant === q).length}</p>
                <p className={`text-xs font-medium ${text}`}>{q}</p>
                {bcgFilter === q && <p className="text-xs mt-1 text-gray-500">Clique para limpar filtro</p>}
              </button>
            ))}
          </div>

          {bcgFilter && (
            <div className="bg-gray-100 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Filtrando: <strong>{bcgFilter}</strong> ({visibleBcg.length} produtos)</span>
              <button onClick={() => setBcgFilter(null)} className="text-xs text-blue-600 hover:underline">Limpar filtro</button>
            </div>
          )}

          {/* Grafico scatter */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold mb-2">Crescimento vs Participacao</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart><CartesianGrid/><XAxis type="number" dataKey="share" name="Participacao %" fontSize={10}/><YAxis type="number" dataKey="growth" name="Crescimento %" fontSize={10}/>
              <Tooltip cursor={{strokeDasharray:"3 3"}} formatter={(v)=>`${Number(v).toFixed(1)}%`}/>
              {["Estrela","Vaca Leiteira","Interrogacao","Abacaxi"].map(q=>(<Scatter key={q} name={q} data={visibleBcg.filter((s: BcgRow) => s.quadrant === q)} fill={BCG_COLORS[q]}/>))}</ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Tabela filtrada */}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <div className="p-3 border-b"><h3 className="font-semibold">{bcgFilter ? `Produtos: ${bcgFilter}` : "Todos os Produtos"} ({visibleBcg.filter((s: BcgRow) => s.revenue30d > 0).length})</h3></div>
            <table className="w-full text-sm min-w-[700px]"><thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Quadrante</th><th className="text-left px-3 py-2">SKU</th><th className="text-left px-3 py-2">Produto</th><th className="text-right px-3 py-2">Receita 30d</th><th className="text-right px-3 py-2">Crescimento</th><th className="text-right px-3 py-2">Participacao</th><th className="text-right px-3 py-2">Margem</th></tr></thead>
            <tbody>{visibleBcg.filter((s: BcgRow) => s.revenue30d > 0).map((s: BcgRow, i: number)=>(<tr key={i} className="border-t hover:bg-gray-50"><td className="px-3 py-1.5"><span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{backgroundColor:BCG_COLORS[s.quadrant]}}>{s.quadrant}</span></td><td className="px-3 py-1.5 font-mono text-xs">{s.sku}</td><td className="px-3 py-1.5 max-w-[150px] truncate">{s.title}</td><td className="px-3 py-1.5 text-right">{formatCurrency(s.revenue30d)}</td><td className={`px-3 py-1.5 text-right font-bold ${s.growth>0?"text-green-600":"text-red-600"}`}>{s.growth>0?"+":""}{s.growth}%</td><td className="px-3 py-1.5 text-right">{s.share}%</td><td className={`px-3 py-1.5 text-right ${s.marginPct>=0?"text-green-600":"text-red-600"}`}>{s.marginPct}%</td></tr>))}</tbody></table>
          </div>
          {aiResult.bcg && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.bcg}</div>}
        </div>
        );
      })()}

      {/* ===== ENTRE CONTAS ===== */}
      {tab === "contas" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center"><h2 className="text-lg font-bold">Entre Contas</h2><button onClick={() => runAI("contas", "Compare minhas contas. Oportunidades de replicacao?")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar"}</button></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Receita por Conta</h3><ResponsiveContainer width="100%" height={220}><BarChart data={accs}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>formatCurrency(Number(v))}/><Bar dataKey="revenue" fill="#8b5cf6"/></BarChart></ResponsiveContainer></div>
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Por Plataforma</h3><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={plat} cx="50%" cy="50%" outerRadius={75} label={({name,percent})=>`${name}: ${((percent||0)*100).toFixed(0)}%`} dataKey="revenue" nameKey="platform">{plat.map((_: unknown,i: number)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={(v)=>formatCurrency(Number(v))}/></PieChart></ResponsiveContainer></div>
          </div>
          {cross.length > 0 && <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4"><h3 className="font-semibold text-yellow-800 mb-2">Oportunidades de Replicacao ({cross.length})</h3>{cross.slice(0,10).map((c: {sku:string;title:string;presentIn:string[];missingIn:string[]},i: number)=>(<div key={i} className="bg-white rounded-lg p-2 border mb-1 text-sm"><span className="font-mono font-bold">{c.sku}</span> - {c.title}<div className="text-xs"><span className="text-green-600">Presente: {c.presentIn.join(", ")}</span> | <span className="text-red-600">Falta: {c.missingIn.join(", ")}</span></div></div>))}</div>}
          {aiResult.contas && <div className="bg-indigo-50 rounded-lg p-4 whitespace-pre-wrap text-sm">{aiResult.contas}</div>}
        </div>
      )}

      {/* ===== VOZ DO CLIENTE ===== */}
      {tab === "voz" && (() => {
        const vozData: Array<{sku:string;title:string;returns:number;cancellations:number;totalLost:number;totalSold:number;problemRate:number;totalProblems:number;statuses:string[]}> = data?.vozClienteData || [];
        const problemTypes: Record<string, number> = data?.problemTypes || {};
        const totalReturnsCount = vozData.reduce((s,v) => s + v.returns, 0);
        const totalCancellations = vozData.reduce((s,v) => s + v.cancellations, 0);
        const totalLost = vozData.reduce((s,v) => s + v.totalLost, 0);
        const [vozFilter, setVozFilter] = [aiResult._vozFilter || "", (v: string) => setAiResult(prev => ({...prev, _vozFilter: v}))];
        const [vozSort, setVozSort] = [aiResult._vozSort || "totalProblems", (v: string) => setAiResult(prev => ({...prev, _vozSort: v}))];
        const [vozSortDir, setVozSortDir] = [aiResult._vozSortDir || "desc", (v: string) => setAiResult(prev => ({...prev, _vozSortDir: v}))];

        const filteredVoz = vozFilter === "returns" ? vozData.filter(v => v.returns > 0) :
          vozFilter === "cancellations" ? vozData.filter(v => v.cancellations > 0) : vozData;

        const sortedVoz = [...filteredVoz].sort((a, b) => {
          const key = vozSort as keyof typeof a;
          const av = Number(a[key]) || 0, bv = Number(b[key]) || 0;
          return vozSortDir === "desc" ? bv - av : av - bv;
        });

        function toggleSort(key: string) {
          if (vozSort === key) setVozSortDir(vozSortDir === "desc" ? "asc" : "desc");
          else { setVozSort(key); setVozSortDir("desc"); }
        }
        const arrow = (key: string) => vozSort === key ? (vozSortDir === "asc" ? " ▲" : " ▼") : " ▴▾";

        return (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-lg font-bold">Voz do Cliente - Devolucoes e Reclamacoes</h2>
            <div className="flex gap-2 flex-wrap items-center">
              {/* Filtro de periodo */}
              <select onChange={e => { const v = e.target.value; if (v.startsWith("m-")) fetchData(selectedAccount || undefined); else fetchData(selectedAccount || undefined); }} className="border rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="30">Ultimos 30 dias</option>
                <option value="7">Ultimos 7 dias</option>
                <option value="15">Ultimos 15 dias</option>
                <option value="90">Ultimos 3 meses</option>
              </select>
              <AccountFilter/>
              <button onClick={() => runAI("voz", `Analise os ${vozData.length} produtos com devolucoes/cancelamentos. Top problematicos: ${vozData.slice(0,5).map(v=>`${v.sku}(${v.totalProblems} problemas)`).join(", ")}. O que fazer para reduzir?`)} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar com IA"}</button>
            </div>
          </div>

          {/* Cards clicaveis */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button onClick={() => setVozFilter(vozFilter === "returns" ? "" : "returns")}
              className={`bg-red-50 border-2 rounded-lg p-4 text-center transition-all hover:shadow-md ${vozFilter === "returns" ? "border-red-500 ring-2 ring-red-200 scale-105" : "border-red-200"}`}>
              <p className="text-3xl font-bold text-red-700">{totalReturnsCount}</p>
              <p className="text-sm text-red-600 font-medium">Devolucoes</p>
              {vozFilter === "returns" && <p className="text-xs text-gray-500 mt-1">Clique p/ limpar</p>}
            </button>
            <button onClick={() => setVozFilter(vozFilter === "cancellations" ? "" : "cancellations")}
              className={`bg-orange-50 border-2 rounded-lg p-4 text-center transition-all hover:shadow-md ${vozFilter === "cancellations" ? "border-orange-500 ring-2 ring-orange-200 scale-105" : "border-orange-200"}`}>
              <p className="text-3xl font-bold text-orange-700">{totalCancellations}</p>
              <p className="text-sm text-orange-600 font-medium">Cancelamentos</p>
              {vozFilter === "cancellations" && <p className="text-xs text-gray-500 mt-1">Clique p/ limpar</p>}
            </button>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <p className="text-xl font-bold text-red-700">{formatCurrency(totalLost)}</p>
              <p className="text-sm text-red-600 font-medium">Valor Perdido</p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-yellow-700">{vozData.length}</p>
              <p className="text-sm text-yellow-600 font-medium">SKUs com Problema</p>
            </div>
          </div>

          {/* Cards de tipos de problema */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(problemTypes).filter(([,v]) => v > 0).map(([tipo, count]) => (
              <div key={tipo} className="bg-white border rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-gray-800">{count}</p>
                <p className="text-xs text-gray-600 font-medium">{tipo}</p>
              </div>
            ))}
            {Object.values(problemTypes).every(v => v === 0) && (
              <>
                <div className="bg-white border rounded-lg p-3 text-center"><p className="text-lg font-bold text-red-600">{totalCancellations}</p><p className="text-xs text-gray-600">Cancelamentos</p></div>
                <div className="bg-white border rounded-lg p-3 text-center"><p className="text-lg font-bold text-orange-600">{totalReturnsCount}</p><p className="text-xs text-gray-600">Devolucoes</p></div>
                <div className="bg-white border rounded-lg p-3 text-center"><p className="text-lg font-bold text-yellow-600">-</p><p className="text-xs text-gray-600">Produto Errado</p></div>
                <div className="bg-white border rounded-lg p-3 text-center"><p className="text-lg font-bold text-purple-600">-</p><p className="text-xs text-gray-600">Quebra/Defeito</p></div>
              </>
            )}
          </div>

          {vozFilter && <div className="bg-gray-100 rounded-lg px-3 py-2 flex justify-between items-center"><span className="text-sm">Filtrando: <strong>{vozFilter === "returns" ? "Devolucoes" : "Cancelamentos"}</strong> ({filteredVoz.length} SKUs)</span><button onClick={() => setVozFilter("")} className="text-xs text-blue-600">Limpar</button></div>}

          {/* Grafico */}
          {sortedVoz.length > 0 && (
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold mb-2 text-red-700">Ranking: SKUs com mais Problemas</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, sortedVoz.slice(0,12).length * 35)}>
                <BarChart data={sortedVoz.slice(0,12)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3"/><XAxis type="number" fontSize={9}/><YAxis type="category" dataKey="sku" fontSize={9} width={90}/><Tooltip/><Legend/>
                  <Bar dataKey="returns" name="Devolucoes" fill="#ef4444" stackId="a"/><Bar dataKey="cancellations" name="Cancelamentos" fill="#f97316" stackId="a"/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabela com ordenacao */}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <div className="p-3 border-b"><h3 className="font-semibold text-red-700">Detalhamento por SKU ({sortedVoz.length} produtos)</h3></div>
            <table className="w-full text-sm">
              <thead className="bg-red-50">
                <tr>
                  <th className="text-left px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("sku")}>SKU{arrow("sku")}</th>
                  <th className="text-left px-3 py-2 text-red-700">Produto</th>
                  <th className="text-right px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("returns")}>Devolucoes{arrow("returns")}</th>
                  <th className="text-right px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("cancellations")}>Cancelamentos{arrow("cancellations")}</th>
                  <th className="text-right px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("totalProblems")}>Total{arrow("totalProblems")}</th>
                  <th className="text-right px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("totalSold")}>Vendas OK{arrow("totalSold")}</th>
                  <th className="text-right px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("problemRate")}>Taxa %{arrow("problemRate")}</th>
                  <th className="text-right px-3 py-2 text-red-700 cursor-pointer" onClick={() => toggleSort("totalLost")}>Valor Perdido{arrow("totalLost")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedVoz.map((v,i) => (
                  <tr key={i} className="border-t hover:bg-red-50">
                    <td className="px-3 py-1.5 font-mono text-xs font-bold">{v.sku}</td>
                    <td className="px-3 py-1.5 max-w-[180px] truncate">{v.title}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-red-600">{v.returns}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-orange-600">{v.cancellations}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-red-700">{v.totalProblems}</td>
                    <td className="px-3 py-1.5 text-right text-green-600">{v.totalSold}</td>
                    <td className={`px-3 py-1.5 text-right font-bold ${v.problemRate > 20 ? "text-red-600" : v.problemRate > 10 ? "text-orange-600" : "text-yellow-600"}`}>{v.problemRate}%</td>
                    <td className="px-3 py-1.5 text-right text-red-600">{formatCurrency(v.totalLost)}</td>
                  </tr>
                ))}
                {sortedVoz.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">Nenhuma devolucao ou cancelamento no periodo</td></tr>}
              </tbody>
            </table>
          </div>
          {aiResult.voz && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.voz}</div>}
        </div>
        );
      })()}

      {/* ===== STP ===== */}
      {tab === "stp" && (() => {
        const [stpDetail, setStpDetail] = [aiResult._stpDetail || "", (v: string) => setAiResult(prev => ({...prev, _stpDetail: v}))];
        const [stpSku, setStpSku] = [aiResult._stpSku || "", (v: string) => setAiResult(prev => ({...prev, _stpSku: v}))];

        async function loadSkuDetail(sku: string, title: string) {
          setStpSku(sku);
          setStpDetail("");
          setAiLoading(true); setAiProgress(5);
          const iv = setInterval(() => setAiProgress(p => Math.min(p + Math.random() * 10, 88)), 400);
          try {
            const skuInfo = abc.find((s: SkuRow) => s.sku === sku);
            const bcgInfo = bcg.find((s: BcgRow) => s.sku === sku);
            const q = `Analise STP detalhada para o produto "${title}" (SKU: ${sku}).
Dados reais: vendas ${skuInfo?.sold || 0} un, receita ${formatCurrency(skuInfo?.revenue || 0)}, margem ${skuInfo?.marginPct || 0}%, crescimento ${bcgInfo?.growth || 0}%.

Me retorne EXATAMENTE neste formato:

SEGMENTACAO:
- Qual segmento de publico compra esse produto? (ex: "Mulheres 25-45 que organizam casa")
- Tamanho do segmento (grande/medio/pequeno) e poder de compra
- Comportamento de compra (impulsiva/planejada, frequencia)

TARGET (ALVO):
- Potencial de lucro deste segmento (alto/medio/baixo)
- Volume de busca estimado no marketplace
- Perfil ideal do comprador

POSICIONAMENTO:
- Como este produto esta posicionado vs concorrentes
- Nivel de concorrencia (saturado/moderado/pouco explorado)
- Sugestao de angulo de venda diferente (titulo, imagem, descricao)

ACOES RECOMENDADAS:
- 3 acoes praticas e imediatas para melhorar vendas deste SKU`;

            const res = await fetch("/api/analista", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ query: q }) });
            const d = await res.json();
            clearInterval(iv); setAiProgress(100);
            if (d.response) setStpDetail(d.response);
          } catch { clearInterval(iv); }
          finally { setTimeout(() => { setAiLoading(false); setAiProgress(0); }, 400); }
        }

        return (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-lg font-bold">Analise STP - Segmentacao, Target e Posicionamento</h2>
            <div className="flex gap-2"><AccountFilter/><button onClick={() => runAI("stp", "Faca analise STP de TODOS os meus produtos. Para cada um: segmento de publico, atratividade do segmento, nivel de concorrencia, e sugestao de posicionamento.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar Todos"}</button></div>
          </div>

          {/* Graficos oportunidade e queda */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2 text-green-700">📈 Oportunidade - SKUs em Alta</h3>
              <ResponsiveContainer width="100%" height={220}><BarChart data={rising}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="sku" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>`${Number(v).toFixed(1)}%`}/><Bar dataKey="growth" name="Crescimento %" fill="#22c55e"/></BarChart></ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2 text-red-700">📉 Atencao - SKUs em Queda</h3>
              <ResponsiveContainer width="100%" height={220}><BarChart data={falling}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="sku" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>`${Number(v).toFixed(1)}%`}/><Bar dataKey="growth" name="Queda %" fill="#ef4444"/></BarChart></ResponsiveContainer>
            </div>
          </div>

          {/* Blocos STP clicaveis */}
          <h3 className="font-semibold text-gray-800">Clique no SKU para analise detalhada</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {abc.filter((s: SkuRow) => s.abc === "A" || s.abc === "B").slice(0, 12).map((s: SkuRow, i: number) => {
              const bcgInfo = bcg.find((b: BcgRow) => b.sku === s.sku);
              const growth = bcgInfo?.growth || 0;
              const concLevel = s.sold > 50 ? "Alto volume" : s.sold > 20 ? "Medio volume" : "Baixo volume";
              const segment = s.title.toLowerCase().includes("gaveteiro") ? "Organizacao e casa" :
                s.title.toLowerCase().includes("pipa") || s.title.toLowerCase().includes("rabiola") || s.title.toLowerCase().includes("bambu") ? "Lazer e brinquedos" :
                s.title.toLowerCase().includes("cozinha") || s.title.toLowerCase().includes("kit") ? "Brinquedos infantis" :
                s.title.toLowerCase().includes("carrinho") || s.title.toLowerCase().includes("boneca") ? "Brinquedos infantis" : "Utilidades domesticas";

              return (
              <button key={i} onClick={() => loadSkuDetail(s.sku, s.title)}
                className={`bg-white rounded-lg border-2 p-4 text-left transition-all hover:shadow-lg hover:border-indigo-300 ${stpSku === s.sku ? "border-indigo-500 ring-2 ring-indigo-200" : "border-gray-200"}`}>
                <div className="flex justify-between items-start mb-2"><span className="font-mono text-xs font-bold text-indigo-600">{s.sku}</span><span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{backgroundColor:ABC_COLORS[s.abc]}}>{s.abc}</span></div>
                <p className="text-sm font-bold text-gray-900 mb-3">{s.title}</p>
                <div className="space-y-2">
                  <div className="bg-blue-50 rounded p-2.5">
                    <p className="text-xs font-bold text-blue-700 mb-1">SEGMENTACAO</p>
                    <p className="text-xs text-blue-800 font-medium">{segment}</p>
                    <p className="text-xs text-blue-600">{concLevel} | {s.sold} vendas/mes</p>
                  </div>
                  <div className="bg-green-50 rounded p-2.5">
                    <p className="text-xs font-bold text-green-700 mb-1">TARGET (ALVO)</p>
                    <p className="text-xs text-green-800 font-medium">{s.marginPct > 20 ? "Alta atratividade" : s.marginPct > 10 ? "Media atratividade" : "Baixa atratividade"}</p>
                    <p className="text-xs text-green-600">{growth > 0 ? `Crescendo ${growth}%` : `Caindo ${growth}%`}</p>
                  </div>
                  <div className="bg-purple-50 rounded p-2.5">
                    <p className="text-xs font-bold text-purple-700 mb-1">POSICIONAMENTO</p>
                    <p className="text-xs text-purple-800 font-medium">{s.sold > 50 ? "Mercado competitivo" : s.sold > 20 ? "Moderadamente explorado" : "Pouco explorado"}</p>
                  </div>
                </div>
                <p className="text-xs text-indigo-500 mt-2 text-center font-medium">Clique para analise completa →</p>
              </button>
              );
            })}
          </div>

          {/* Detalhe do SKU selecionado */}
          {stpSku && stpDetail && (
            <div className="bg-white rounded-lg border-2 border-indigo-300 p-6 shadow-lg">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-indigo-700">Analise Detalhada: {stpSku}</h3>
                <button onClick={() => { setStpSku(""); setStpDetail(""); }} className="text-gray-400 hover:text-gray-600 text-sm">Fechar x</button>
              </div>
              <div className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{stpDetail}</div>
            </div>
          )}
          {stpSku && !stpDetail && aiLoading && (
            <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3" />
              <p className="text-indigo-700 font-medium">Analisando {stpSku}...</p>
            </div>
          )}

          {aiResult.stp && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.stp}</div>}
        </div>
        );
      })()}

      {/* ===== PRECO ===== */}
      {tab === "preco" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2"><h2 className="text-lg font-bold">Elasticidade de Preco</h2><div className="flex gap-2"><AccountFilter/><button onClick={() => runAI("preco", "Elasticidade de preco TOP 10 produtos. Sugestoes de testes.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar"}</button></div></div>
          <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Receita vs Custo vs Margem</h3><ResponsiveContainer width="100%" height={250}><BarChart data={abc.filter(s=>s.revenue>0).slice(0,12)}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="sku" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>formatCurrency(Number(v))}/><Legend/><Bar dataKey="revenue" name="Receita" fill="#3b82f6"/><Bar dataKey="cost" name="Custo" fill="#ef4444"/><Bar dataKey="margin" name="Margem" fill="#22c55e"/></BarChart></ResponsiveContainer></div>
          {aiResult.preco && <div className="bg-indigo-50 rounded-lg p-4 whitespace-pre-wrap text-sm">{aiResult.preco}</div>}
        </div>
      )}

      {/* ===== CONCORRENCIA ===== */}
      {tab === "concorrencia" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2"><h2 className="text-lg font-bold">Concorrencia</h2><div className="flex gap-2"><AccountFilter/><button onClick={() => runAI("concorrencia", "Mapeie concorrencia dos meus TOP 10 produtos. Acoes especificas.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar"}</button></div></div>
          <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Evolucao Receita 30 dias</h3><ResponsiveContainer width="100%" height={250}><LineChart data={daily}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" fontSize={9} tickFormatter={v=>v.slice(5)}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>formatCurrency(Number(v))}/><Line type="monotone" dataKey="revenue" name="Receita" stroke="#3b82f6" strokeWidth={2}/></LineChart></ResponsiveContainer></div>
          {aiResult.concorrencia && <div className="bg-indigo-50 rounded-lg p-4 whitespace-pre-wrap text-sm">{aiResult.concorrencia}</div>}
        </div>
      )}
    </div>
  );
}
