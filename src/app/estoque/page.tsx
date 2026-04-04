"use client";

import { useState, useEffect, useMemo } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface StockItemData {
  sku: string; title: string; currentStock: number;
  unitCost: number; salePrice: number; leadTimeDays: number; safetyStockDays: number;
  avgDailySales: number; totalSold: number; coverageDays: number;
  minStock: number; reorderPoint: number; suggestedPurchase: number;
  oneMonthSales: number; status: string;
  marginPerUnit: number; marginPct: number; capitalTied: number; purchaseCost: number;
  abcClass: string; supplier: string | null; platforms: string[];
}

interface Totals {
  totalSkus: number; totalStock: number; totalCapital: number; totalPurchaseCost: number;
  inRupture: number; needPurchase: number; classA: number; classB: number; classC: number;
  totalSold30d: number; totalSuggested: number;
}

type SortKey = "sku" | "title" | "currentStock" | "avgDailySales" | "coverageDays" | "reorderPoint" | "suggestedPurchase" | "marginPct" | "capitalTied" | "purchaseCost" | "abcClass" | "status" | "totalSold";
type SortDir = "asc" | "desc";

function SortTh({ label, field, sk, sd, onSort, align = "right" }: {
  label: string; field: SortKey; sk: SortKey; sd: SortDir; onSort: (k: SortKey) => void; align?: string;
}) {
  const a = sk === field;
  return (
    <th className={`${align === "left" ? "text-left" : "text-right"} px-3 py-2 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100`} onClick={() => onSort(field)}>
      {label}<span className={`text-xs ml-0.5 ${a ? "text-blue-600" : "text-gray-400"}`}>{a ? (sd === "asc" ? " \u25B2" : " \u25BC") : " \u25B4\u25BE"}</span>
    </th>
  );
}

const statusColors: Record<string, string> = {
  ruptura: "bg-red-100 text-red-700",
  critico: "bg-orange-100 text-orange-700",
  comprar: "bg-yellow-100 text-yellow-700",
  ok: "bg-green-100 text-green-700",
};
const statusLabels: Record<string, string> = {
  ruptura: "RUPTURA", critico: "CRITICO", comprar: "COMPRAR", ok: "OK",
};

export default function EstoquePage() {
  const [items, setItems] = useState<StockItemData[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [sk, setSk] = useState<SortKey>("status");
  const [sd, setSd] = useState<SortDir>("asc");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({ sku: "", title: "", currentStock: "", cost: "", salePrice: "", leadTimeDays: "7", safetyStockDays: "30", supplier: "" });
  const [msg, setMsg] = useState("");

  async function fetchStock() {
    setLoading(true);
    try {
      const res = await fetch("/api/stock");
      const data = await res.json();
      setItems(data.items || []);
      setTotals(data.totals || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchStock(); }, []);

  function handleSort(key: SortKey) {
    if (sk === key) setSd(sd === "asc" ? "desc" : "asc");
    else { setSk(key); setSd("desc"); }
  }

  const filtered = useMemo(() => {
    let list = [...items];
    if (filter === "comprar") list = list.filter(i => i.status === "comprar" || i.status === "critico" || i.status === "ruptura");
    if (filter === "A") list = list.filter(i => i.abcClass === "A");
    if (filter === "B") list = list.filter(i => i.abcClass === "B");
    if (filter === "C") list = list.filter(i => i.abcClass === "C");

    list.sort((a, b) => {
      const statusOrder: Record<string, number> = { ruptura: 0, critico: 1, comprar: 2, ok: 3 };
      if (sk === "status") {
        const diff = (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9);
        return sd === "asc" ? diff : -diff;
      }
      const av = a[sk] ?? "", bv = b[sk] ?? "";
      if (typeof av === "number" && typeof bv === "number") return sd === "asc" ? av - bv : bv - av;
      return sd === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return list;
  }, [items, sk, sd, filter]);

  async function addItem() {
    if (!form.sku) { setMsg("SKU obrigatorio"); return; }
    try {
      await fetch("/api/stock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: form.sku, title: form.title, currentStock: Number(form.currentStock || 0),
          cost: Number(form.cost || 0), salePrice: Number(form.salePrice || 0),
          leadTimeDays: Number(form.leadTimeDays || 7), safetyStockDays: Number(form.safetyStockDays || 30),
          supplier: form.supplier,
        }),
      });
      setForm({ sku: "", title: "", currentStock: "", cost: "", salePrice: "", leadTimeDays: "7", safetyStockDays: "30", supplier: "" });
      setMsg("Salvo!"); fetchStock();
    } catch { setMsg("Erro"); }
    setTimeout(() => setMsg(""), 3000);
  }

  async function syncFromSales() {
    setSyncing(true); setMsg("");
    try {
      const res = await fetch("/api/stock/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setMsg(`${data.created} novos SKUs + ${data.updated} atualizados das vendas!`);
        fetchStock();
      } else { setMsg(`Erro: ${data.error}`); }
    } catch (e) { setMsg(`Erro: ${e}`); }
    finally { setSyncing(false); setTimeout(() => setMsg(""), 8000); }
  }

  async function registerPurchase(sku: string, qty: number, cost: number) {
    await fetch("/api/purchases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, quantity: qty, unitCost: cost }),
    });
    setMsg(`Compra de ${qty}x ${sku} registrada!`);
    fetchStock();
    setTimeout(() => setMsg(""), 3000);
  }

  const t = totals || { totalSkus: 0, totalStock: 0, totalCapital: 0, totalPurchaseCost: 0, inRupture: 0, needPurchase: 0, classA: 0, classB: 0, classC: 0, totalSold30d: 0, totalSuggested: 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Gestao de Compras</h1>
        <button onClick={syncFromSales} disabled={syncing}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:bg-gray-400">
          {syncing ? "Sincronizando..." : "Sincronizar com Vendas"}
        </button>
      </div>

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-700 font-medium">SKUs Vendidos (30d)</p>
          <p className="text-xl font-bold text-gray-900">{t.totalSkus}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-700 font-medium">Vendas 30d (un)</p>
          <p className="text-xl font-bold text-gray-900">{t.totalSold30d || 0}</p>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-3">
          <p className="text-xs text-red-700 font-medium">Sem Estoque</p>
          <p className="text-xl font-bold text-red-700">{t.inRupture}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-3">
          <p className="text-xs text-yellow-700 font-medium">Precisa Comprar</p>
          <p className="text-xl font-bold text-yellow-700">{t.needPurchase}</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-3">
          <p className="text-xs text-green-600">Classe A</p>
          <p className="text-xl font-bold text-green-700">{t.classA}</p>
        </div>
        <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-3">
          <p className="text-xs text-indigo-700 font-medium">Compra Sugerida</p>
          <p className="text-xl font-bold text-indigo-700">{t.totalSuggested || 0} un</p>
          <p className="text-xs text-indigo-600">{formatCurrency(t.totalPurchaseCost || 0)}</p>
        </div>
      </div>

      {/* Filtros + Adicionar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {[
            { key: "all", label: "Todos" },
            { key: "comprar", label: "Precisa Comprar" },
            { key: "A", label: "Classe A" },
            { key: "B", label: "Classe B" },
            { key: "C", label: "Classe C" },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded text-sm font-medium ${filter === f.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 ml-auto">
          {showForm ? "Fechar" : "+ Adicionar Produto"}
        </button>
        {msg && <span className={`text-sm ${msg.includes("Erro") ? "text-red-500" : "text-green-600"}`}>{msg}</span>}
      </div>

      {/* Form adicionar */}
      {showForm && (
        <div className="bg-white rounded-lg border p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="text-xs text-gray-500">SKU *</label><input className="border rounded px-2 py-1 w-full text-sm" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Nome</label><input className="border rounded px-2 py-1 w-full text-sm" value={form.title} onChange={e => setForm({...form, title: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Estoque Atual</label><input type="number" className="border rounded px-2 py-1 w-full text-sm" value={form.currentStock} onChange={e => setForm({...form, currentStock: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Custo (R$)</label><input type="number" step="0.01" className="border rounded px-2 py-1 w-full text-sm" value={form.cost} onChange={e => setForm({...form, cost: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Preco Venda (R$)</label><input type="number" step="0.01" className="border rounded px-2 py-1 w-full text-sm" value={form.salePrice} onChange={e => setForm({...form, salePrice: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Lead Time (dias)</label><input type="number" className="border rounded px-2 py-1 w-full text-sm" value={form.leadTimeDays} onChange={e => setForm({...form, leadTimeDays: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Reserva (dias)</label><input type="number" className="border rounded px-2 py-1 w-full text-sm" value={form.safetyStockDays} onChange={e => setForm({...form, safetyStockDays: e.target.value})} /></div>
            <div><label className="text-xs text-gray-500">Fornecedor</label><input className="border rounded px-2 py-1 w-full text-sm" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} /></div>
          </div>
          <button onClick={addItem} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Salvar</button>
        </div>
      )}

      {/* Lista de produtos */}
      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
          Nenhum produto. Clique em &quot;Sincronizar com Vendas&quot; ou &quot;+ Adicionar Produto&quot;.
        </div>
      ) : (
        <>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((item) => (
              <div key={item.sku} className={`rounded-lg border-2 p-4 ${item.status === "ruptura" ? "border-red-300 bg-red-50" : item.status === "critico" ? "border-orange-300 bg-orange-50" : item.status === "comprar" ? "border-yellow-300 bg-yellow-50" : "border-gray-200 bg-white"}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-bold text-gray-900">{item.title || item.sku}</p>
                    <p className="text-sm text-gray-900 font-mono font-bold">{item.sku}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[item.status]}`}>{statusLabels[item.status]}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.abcClass === "A" ? "bg-green-200 text-green-800" : item.abcClass === "B" ? "bg-blue-200 text-blue-800" : "bg-gray-200 text-gray-700"}`}>{item.abcClass || "-"}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div>
                    <p className="text-gray-700 text-xs font-medium">Estoque</p>
                    <p className={`font-bold ${item.currentStock <= 0 ? "text-red-600" : "text-gray-900"}`}>{item.currentStock} un</p>
                  </div>
                  <div>
                    <p className="text-gray-700 text-xs font-medium">Vendas/dia</p>
                    <p className="font-bold text-gray-900">{item.avgDailySales}</p>
                  </div>
                  <div>
                    <p className="text-gray-700 text-xs font-medium">Cobertura</p>
                    <p className={`font-bold ${item.coverageDays <= 7 ? "text-red-600" : item.coverageDays <= 15 ? "text-yellow-600" : "text-gray-900"}`}>
                      {item.coverageDays >= 999 ? "∞" : `${item.coverageDays} dias`}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-700 text-xs font-medium">Ponto Repos.</p>
                    <p className="font-bold text-gray-900">{item.reorderPoint} un</p>
                  </div>
                  <div>
                    <p className="text-gray-700 text-xs font-medium">Valor Compra</p>
                    <p className="font-bold text-gray-900">{formatCurrency(item.purchaseCost)}</p>
                  </div>
                  <div>
                    <p className="text-gray-700 text-xs font-medium">Margem</p>
                    <p className={`font-bold ${item.marginPct >= 30 ? "text-green-600" : item.marginPct >= 15 ? "text-yellow-600" : "text-red-600"}`}>{formatPercent(item.marginPct)}</p>
                  </div>
                </div>

                {item.suggestedPurchase > 0 && (
                  <div className="flex justify-between items-center bg-white rounded-lg p-2 border">
                    <div>
                      <p className="text-sm text-red-700 font-bold">Comprar {item.suggestedPurchase} unidades</p>
                      <p className="text-xs text-gray-800 font-medium">Custo: {formatCurrency(item.suggestedPurchase * item.unitCost)}</p>
                    </div>
                    <button onClick={() => registerPurchase(item.sku, item.suggestedPurchase, item.unitCost)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium">
                      Comprar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: Tabela */}
          <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[1400px]">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <SortTh label="Status" field="status" sk={sk} sd={sd} onSort={handleSort} align="left" />
                  <SortTh label="ABC" field="abcClass" sk={sk} sd={sd} onSort={handleSort} align="left" />
                  <SortTh label="SKU" field="sku" sk={sk} sd={sd} onSort={handleSort} align="left" />
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Produto</th>
                  <SortTh label="Estoque" field="currentStock" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Vendas/dia" field="avgDailySales" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Cobertura" field="coverageDays" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Ponto Repos." field="reorderPoint" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Sugestao Compra" field="suggestedPurchase" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Capital" field="purchaseCost" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Margem" field="marginPct" sk={sk} sd={sd} onSort={handleSort} />
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Acao</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.sku} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[item.status]}`}>{statusLabels[item.status]}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.abcClass === "A" ? "bg-green-100 text-green-700" : item.abcClass === "B" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{item.abcClass || "-"}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-800">{item.sku}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-gray-900 font-medium">{item.title || "-"}</td>
                    <td className={`px-3 py-2 text-right font-bold ${item.currentStock <= 0 ? "text-red-600" : "text-gray-900"}`}>{item.currentStock}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{item.avgDailySales}</td>
                    <td className={`px-3 py-2 text-right font-medium ${item.coverageDays <= 7 ? "text-red-600" : item.coverageDays <= 15 ? "text-yellow-600" : "text-gray-900"}`}>
                      {item.coverageDays >= 999 ? "-" : `${item.coverageDays}d`}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900">{item.reorderPoint}</td>
                    <td className={`px-3 py-2 text-right font-bold ${item.suggestedPurchase > 0 ? "text-red-600" : "text-green-600"}`}>
                      {item.suggestedPurchase > 0 ? item.suggestedPurchase : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900">{formatCurrency(item.purchaseCost)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${item.marginPct >= 30 ? "text-green-600" : item.marginPct >= 15 ? "text-yellow-600" : "text-red-600"}`}>{formatPercent(item.marginPct)}</td>
                    <td className="px-3 py-2 text-center">
                      {item.suggestedPurchase > 0 && (
                        <button onClick={() => registerPurchase(item.sku, item.suggestedPurchase, item.unitCost)}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                          Comprar {item.suggestedPurchase}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
