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
  const problematic: BcgRow[] = data?.problematic || [];
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
      {tab === "bcg" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-lg font-bold">Matriz BCG</h2>
            <div className="flex gap-2 items-center">
              <AccountFilter />
              <button onClick={() => runAI("bcg", "Analise a matriz BCG dos meus produtos. Quais sao Estrela, Vaca Leiteira, Interrogacao e Abacaxi? O que fazer com cada um?")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading ? "..." : "Analisar com IA"}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{q:"Estrela",icon:"⭐",color:"bg-yellow-50 border-yellow-200",text:"text-yellow-700"},{q:"Vaca Leiteira",icon:"🐄",color:"bg-green-50 border-green-200",text:"text-green-700"},{q:"Interrogacao",icon:"❓",color:"bg-blue-50 border-blue-200",text:"text-blue-700"},{q:"Abacaxi",icon:"🍍",color:"bg-red-50 border-red-200",text:"text-red-700"}].map(({q,icon,color,text})=>(
              <div key={q} className={`${color} border rounded-lg p-3 text-center`}><p className="text-2xl">{icon}</p><p className={`text-2xl font-bold ${text}`}>{bcg.filter(s=>s.quadrant===q).length}</p><p className={`text-xs font-medium ${text}`}>{q}</p></div>
            ))}
          </div>
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold mb-2">Crescimento vs Participacao</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart><CartesianGrid/><XAxis type="number" dataKey="share" name="Participacao %" fontSize={10}/><YAxis type="number" dataKey="growth" name="Crescimento %" fontSize={10}/>
              <Tooltip cursor={{strokeDasharray:"3 3"}} formatter={(v)=>`${Number(v).toFixed(1)}%`}/>
              {["Estrela","Vaca Leiteira","Interrogacao","Abacaxi"].map(q=>(<Scatter key={q} name={q} data={bcg.filter(s=>s.quadrant===q)} fill={BCG_COLORS[q]}/>))}</ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]"><thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Quadrante</th><th className="text-left px-3 py-2">SKU</th><th className="text-left px-3 py-2">Produto</th><th className="text-right px-3 py-2">Receita 30d</th><th className="text-right px-3 py-2">Crescimento</th><th className="text-right px-3 py-2">Participacao</th><th className="text-right px-3 py-2">Margem</th></tr></thead>
            <tbody>{bcg.filter(s=>s.revenue30d>0).slice(0,20).map((s,i)=>(<tr key={i} className="border-t hover:bg-gray-50"><td className="px-3 py-1.5"><span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{backgroundColor:BCG_COLORS[s.quadrant]}}>{s.quadrant}</span></td><td className="px-3 py-1.5 font-mono text-xs">{s.sku}</td><td className="px-3 py-1.5 max-w-[150px] truncate">{s.title}</td><td className="px-3 py-1.5 text-right">{formatCurrency(s.revenue30d)}</td><td className={`px-3 py-1.5 text-right font-bold ${s.growth>0?"text-green-600":"text-red-600"}`}>{s.growth>0?"+":""}{s.growth}%</td><td className="px-3 py-1.5 text-right">{s.share}%</td><td className={`px-3 py-1.5 text-right ${s.marginPct>=0?"text-green-600":"text-red-600"}`}>{s.marginPct}%</td></tr>))}</tbody></table>
          </div>
          {aiResult.bcg && <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 whitespace-pre-wrap text-sm">{aiResult.bcg}</div>}
        </div>
      )}

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
      {tab === "voz" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2"><h2 className="text-lg font-bold">Voz do Cliente - SKUs Problematicos</h2><div className="flex gap-2"><AccountFilter/><button onClick={() => runAI("voz", "Analise voz do cliente. Reclamacoes, melhorias, objecoes.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar"}</button></div></div>
          <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2">Ranking SKUs Problematicos (margem negativa ou queda forte)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={problematic.slice(0,10)} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number" fontSize={9}/><YAxis type="category" dataKey="sku" fontSize={9} width={80}/><Tooltip formatter={(v)=>`${Number(v).toFixed(1)}%`}/><Bar dataKey="marginPct" name="Margem %" fill="#ef4444"/></BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-red-50"><tr><th className="text-left px-3 py-2 text-red-700">SKU</th><th className="text-left px-3 py-2 text-red-700">Produto</th><th className="text-right px-3 py-2 text-red-700">Margem</th><th className="text-right px-3 py-2 text-red-700">Crescimento</th><th className="text-left px-3 py-2 text-red-700">Problema</th></tr></thead>
          <tbody>{problematic.map((s,i)=>(<tr key={i} className="border-t"><td className="px-3 py-1.5 font-mono text-xs">{s.sku}</td><td className="px-3 py-1.5 max-w-[150px] truncate">{s.title}</td><td className={`px-3 py-1.5 text-right font-bold ${s.marginPct<0?"text-red-600":"text-yellow-600"}`}>{s.marginPct}%</td><td className={`px-3 py-1.5 text-right ${s.growth<0?"text-red-600":"text-green-600"}`}>{s.growth>0?"+":""}{s.growth}%</td><td className="px-3 py-1.5 text-xs">{s.marginPct<0?"Margem negativa":""}{s.growth<-30?" Queda forte":""}</td></tr>))}</tbody></table></div>
          {aiResult.voz && <div className="bg-indigo-50 rounded-lg p-4 whitespace-pre-wrap text-sm">{aiResult.voz}</div>}
        </div>
      )}

      {/* ===== STP ===== */}
      {tab === "stp" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2"><h2 className="text-lg font-bold">Analise STP</h2><div className="flex gap-2"><AccountFilter/><button onClick={() => runAI("stp", "Analise STP: segmentos de clientes, reposicionamentos, angulos de venda por produto.")} disabled={aiLoading} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:bg-gray-400">{aiLoading?"...":"Analisar STP"}</button></div></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2 text-green-700">📈 SKUs em Alta (oportunidade)</h3>
              <ResponsiveContainer width="100%" height={220}><BarChart data={rising}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="sku" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>`${Number(v).toFixed(1)}%`}/><Bar dataKey="growth" name="Crescimento %" fill="#22c55e"/></BarChart></ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border p-4"><h3 className="font-semibold mb-2 text-red-700">📉 SKUs em Queda (atencao)</h3>
              <ResponsiveContainer width="100%" height={220}><BarChart data={falling}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="sku" fontSize={9}/><YAxis fontSize={9}/><Tooltip formatter={(v)=>`${Number(v).toFixed(1)}%`}/><Bar dataKey="growth" name="Queda %" fill="#ef4444"/></BarChart></ResponsiveContainer>
            </div>
          </div>
          {/* Blocos STP por SKU */}
          <h3 className="font-semibold text-gray-800">Segmentacao + Target + Posicionamento por SKU</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {abc.filter(s=>s.abc==="A"||s.abc==="B").slice(0,9).map((s,i)=>(
              <div key={i} className="bg-white rounded-lg border p-4">
                <div className="flex justify-between items-start mb-2"><span className="font-mono text-xs font-bold text-indigo-600">{s.sku}</span><span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{backgroundColor:ABC_COLORS[s.abc]}}>{s.abc}</span></div>
                <p className="text-sm font-medium text-gray-900 mb-3">{s.title}</p>
                <div className="space-y-2">
                  <div className="bg-blue-50 rounded p-2"><p className="text-xs font-bold text-blue-700">SEGMENTACAO</p><p className="text-xs text-blue-600">Vendas: {s.sold} un | Receita: {formatCurrency(s.revenue)}</p></div>
                  <div className="bg-green-50 rounded p-2"><p className="text-xs font-bold text-green-700">TARGET (ALVO)</p><p className="text-xs text-green-600">Margem: {formatCurrency(s.margin)} ({s.marginPct}%)</p></div>
                  <div className="bg-purple-50 rounded p-2"><p className="text-xs font-bold text-purple-700">POSICIONAMENTO</p><p className="text-xs text-purple-600">{s.marginPct>30?"Premium - margem alta":s.marginPct>15?"Competitivo - margem saudavel":s.marginPct>0?"Volume - margem baixa":"Rever - margem negativa"}</p></div>
                </div>
              </div>
            ))}
          </div>
          {aiResult.stp && <div className="bg-indigo-50 rounded-lg p-4 whitespace-pre-wrap text-sm">{aiResult.stp}</div>}
        </div>
      )}

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
