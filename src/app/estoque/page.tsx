"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface StockItemData {
  sku: string;
  title: string;
  totalSold: number;
  avgDaily: number;
  avgWeekly: number;
  avgBiweekly: number;
  avgMonthly: number;
  suggestedPurchase: number;
  unitCost: number;
  purchaseCost: number;
  salePrice: number;
  marginPerUnit: number;
  marginPct: number;
  marginEstimated: number;
  revenue30d: number;
  abcClass: string;
  platforms: string[];
}

interface Totals {
  totalSkus: number;
  totalSold30d: number;
  totalSuggested: number;
  totalPurchaseCost: number;
  totalMarginEstimated: number;
  totalRevenue30d: number;
  classA: number;
  classB: number;
  classC: number;
}

type SortKey = keyof Pick<StockItemData,
  "sku" | "title" | "totalSold" | "avgDaily" | "avgWeekly" | "avgBiweekly" |
  "avgMonthly" | "suggestedPurchase" | "unitCost" | "purchaseCost" |
  "salePrice" | "marginPct" | "marginEstimated" | "abcClass" | "revenue30d"
>;
type SortDir = "asc" | "desc";

function SortTh({ label, field, sk, sd, onSort, align = "right" }: {
  label: string; field: SortKey; sk: SortKey; sd: SortDir; onSort: (k: SortKey) => void; align?: string;
}) {
  const a = sk === field;
  return (
    <th
      className={`${align === "left" ? "text-left" : "text-right"} px-2 py-2 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 text-xs`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className={`ml-0.5 ${a ? "text-blue-600" : "text-gray-400"}`}>
        {a ? (sd === "asc" ? " ▲" : " ▼") : " ▴▾"}
      </span>
    </th>
  );
}

export default function EstoquePage() {
  const [items, setItems] = useState<StockItemData[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [sk, setSk] = useState<SortKey>("revenue30d");
  const [sd, setSd] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [orderCodes, setOrderCodes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stock");
      const data = await res.json();
      setItems(data.items || []);
      setTotals(data.totals || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  function handleSort(key: SortKey) {
    if (sk === key) setSd(sd === "asc" ? "desc" : "asc");
    else { setSk(key); setSd("desc"); }
  }

  const filtered = useMemo(() => {
    let list = [...items];
    if (filter === "A") list = list.filter(i => i.abcClass === "A");
    if (filter === "B") list = list.filter(i => i.abcClass === "B");
    if (filter === "C") list = list.filter(i => i.abcClass === "C");

    list.sort((a, b) => {
      const av = a[sk] ?? "";
      const bv = b[sk] ?? "";
      if (typeof av === "number" && typeof bv === "number") return sd === "asc" ? av - bv : bv - av;
      return sd === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return list;
  }, [items, sk, sd, filter]);

  async function syncFromSales() {
    setSyncing(true); setMsg("");
    try {
      const res = await fetch("/api/stock/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setMsg(`${data.created} novos SKUs + ${data.updated} atualizados!`);
        fetchStock();
      } else { setMsg(`Erro: ${data.error}`); }
    } catch (e) { setMsg(`Erro: ${e}`); }
    finally { setSyncing(false); setTimeout(() => setMsg(""), 8000); }
  }

  function toggleSelect(sku: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(i => i.sku)));
    }
  }

  // Exportar Pedido de Compra para Excel (.xlsx via CSV)
  function exportOrder() {
    const itemsToExport = filtered.filter(i => selected.has(i.sku));
    if (itemsToExport.length === 0) {
      setMsg("Selecione pelo menos 1 produto para gerar o pedido.");
      setTimeout(() => setMsg(""), 5000);
      return;
    }

    // Gera CSV com BOM para Excel abrir corretamente
    const header = "SKU;Produto;Qtd Comprar;Custo Unitario;Capital Total;Cod Pedido";
    const rows = itemsToExport.map(i => {
      const code = orderCodes[i.sku] || "";
      return `${i.sku};${i.title};${i.suggestedPurchase};${i.unitCost.toFixed(2).replace(".", ",")};${i.purchaseCost.toFixed(2).replace(".", ",")};${code}`;
    });

    const totalCapital = itemsToExport.reduce((s, i) => s + i.purchaseCost, 0);
    rows.push(`;;;;;;`);
    rows.push(`TOTAL;;;${itemsToExport.reduce((s, i) => s + i.suggestedPurchase, 0)};;${totalCapital.toFixed(2).replace(".", ",")};`);

    const csv = "\uFEFF" + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedido_compra_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setMsg(`Pedido exportado com ${itemsToExport.length} produtos!`);
    setTimeout(() => setMsg(""), 5000);
  }

  const t = totals || { totalSkus: 0, totalSold30d: 0, totalSuggested: 0, totalPurchaseCost: 0, totalMarginEstimated: 0, totalRevenue30d: 0, classA: 0, classB: 0, classC: 0 };

  const selectedCount = selected.size;
  const selectedCapital = filtered.filter(i => selected.has(i.sku)).reduce((s, i) => s + i.purchaseCost, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Gestao de Compras</h1>
        <div className="flex gap-2">
          <button onClick={syncFromSales} disabled={syncing}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:bg-gray-400">
            {syncing ? "Sincronizando..." : "Sincronizar com Vendas"}
          </button>
        </div>
      </div>

      {/* Dashboard Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-700 font-medium">SKUs Vendidos (30d)</p>
          <p className="text-xl font-bold text-gray-900">{t.totalSkus}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-700 font-medium">Vendas 30d (un)</p>
          <p className="text-xl font-bold text-gray-900">{t.totalSold30d}</p>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-3">
          <p className="text-xs text-blue-700 font-medium">Faturamento 30d</p>
          <p className="text-lg font-bold text-blue-700">{formatCurrency(t.totalRevenue30d)}</p>
        </div>
        <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-3">
          <p className="text-xs text-indigo-700 font-medium">Capital Compra</p>
          <p className="text-lg font-bold text-indigo-700">{formatCurrency(t.totalPurchaseCost)}</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-3">
          <p className="text-xs text-green-700 font-medium">Margem Estimada</p>
          <p className="text-lg font-bold text-green-700">{formatCurrency(t.totalMarginEstimated)}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-3">
          <p className="text-xs text-yellow-700 font-medium">Classe A</p>
          <p className="text-xl font-bold text-yellow-700">{t.classA}</p>
          <p className="text-xs text-gray-500">B: {t.classB} | C: {t.classC}</p>
        </div>
      </div>

      {/* Filtros + Acoes */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {[
            { key: "all", label: "Todos" },
            { key: "A", label: "Curva A" },
            { key: "B", label: "Curva B" },
            { key: "C", label: "Curva C" },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded text-sm font-medium ${filter === f.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="text-sm text-gray-600">
              {selectedCount} selecionado(s) | {formatCurrency(selectedCapital)}
            </span>
          )}
          <button onClick={exportOrder}
            className="px-4 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 flex items-center gap-1.5">
            📋 Gerar Pedido de Compra
          </button>
        </div>
        {msg && <span className={`text-sm w-full ${msg.includes("Erro") ? "text-red-500" : "text-green-600"}`}>{msg}</span>}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
          Nenhum produto encontrado. Clique em &quot;Sincronizar com Vendas&quot;.
        </div>
      ) : (
        <>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((item) => (
              <div key={item.sku} className="rounded-lg border bg-white p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={selected.has(item.sku)}
                      onChange={() => toggleSelect(item.sku)}
                      className="mt-1 h-4 w-4 rounded border-gray-300" />
                    <div>
                      <p className="font-bold text-gray-900">{item.title || item.sku}</p>
                      <p className="text-sm text-gray-900 font-mono font-bold">{item.sku}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.abcClass === "A" ? "bg-green-200 text-green-800" : item.abcClass === "B" ? "bg-blue-200 text-blue-800" : "bg-gray-200 text-gray-700"}`}>
                    {item.abcClass}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div>
                    <p className="text-gray-500 text-xs">Vendido 30d</p>
                    <p className="font-bold text-gray-900">{item.totalSold} un</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Media/dia</p>
                    <p className="font-bold text-gray-900">{item.avgDaily}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Sugestao</p>
                    <p className="font-bold text-indigo-600">{item.suggestedPurchase} un</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Custo SKU</p>
                    <p className="font-bold text-gray-900">{formatCurrency(item.unitCost)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Capital</p>
                    <p className="font-bold text-orange-600">{formatCurrency(item.purchaseCost)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Margem</p>
                    <p className={`font-bold ${item.marginPct >= 30 ? "text-green-600" : item.marginPct >= 15 ? "text-yellow-600" : "text-red-600"}`}>
                      {formatPercent(item.marginPct)}
                    </p>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Cod. Pedido</label>
                  <input type="text" placeholder="Ex: PED-001"
                    value={orderCodes[item.sku] || ""}
                    onChange={e => setOrderCodes(prev => ({ ...prev, [item.sku]: e.target.value }))}
                    className="border rounded px-2 py-1 w-full text-sm mt-0.5" />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Tabela */}
          <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[1600px]">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-center w-8">
                    <input type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300" />
                  </th>
                  <SortTh label="SKU" field="sku" sk={sk} sd={sd} onSort={handleSort} align="left" />
                  <th className="text-left px-2 py-2 font-medium text-gray-600 text-xs">Produto</th>
                  <SortTh label="ABC" field="abcClass" sk={sk} sd={sd} onSort={handleSort} align="left" />
                  <SortTh label="Vendido 30d" field="totalSold" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Med. Diaria" field="avgDaily" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Med. Semanal" field="avgWeekly" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Med. Quinzenal" field="avgBiweekly" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Med. Mensal" field="avgMonthly" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Sugestao Compra" field="suggestedPurchase" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Custo SKU" field="unitCost" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Capital Compra" field="purchaseCost" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Preco Venda" field="salePrice" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Margem Est." field="marginEstimated" sk={sk} sd={sd} onSort={handleSort} />
                  <SortTh label="Margem %" field="marginPct" sk={sk} sd={sd} onSort={handleSort} />
                  <th className="text-left px-2 py-2 font-medium text-gray-600 text-xs whitespace-nowrap">Cod. Pedido</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.sku} className={`border-t hover:bg-gray-50 ${selected.has(item.sku) ? "bg-blue-50" : ""}`}>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={selected.has(item.sku)}
                        onChange={() => toggleSelect(item.sku)}
                        className="h-4 w-4 rounded border-gray-300" />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-gray-800">{item.sku}</td>
                    <td className="px-2 py-2 max-w-[180px] truncate text-gray-900 font-medium text-xs">{item.title || "-"}</td>
                    <td className="px-2 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.abcClass === "A" ? "bg-green-100 text-green-700" : item.abcClass === "B" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                        {item.abcClass}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-gray-900">{item.totalSold}</td>
                    <td className="px-2 py-2 text-right text-gray-900">{item.avgDaily}</td>
                    <td className="px-2 py-2 text-right text-gray-900">{item.avgWeekly}</td>
                    <td className="px-2 py-2 text-right text-gray-900">{item.avgBiweekly}</td>
                    <td className="px-2 py-2 text-right text-gray-900">{item.avgMonthly}</td>
                    <td className="px-2 py-2 text-right font-bold text-indigo-600">{item.suggestedPurchase}</td>
                    <td className="px-2 py-2 text-right text-gray-900">{formatCurrency(item.unitCost)}</td>
                    <td className={`px-2 py-2 text-right font-bold ${item.purchaseCost > 0 ? "text-orange-600" : "text-gray-400"}`}>
                      {formatCurrency(item.purchaseCost)}
                    </td>
                    <td className="px-2 py-2 text-right text-gray-900">{formatCurrency(item.salePrice)}</td>
                    <td className={`px-2 py-2 text-right font-medium ${item.marginEstimated > 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(item.marginEstimated)}
                    </td>
                    <td className={`px-2 py-2 text-right font-medium ${item.marginPct >= 30 ? "text-green-600" : item.marginPct >= 15 ? "text-yellow-600" : "text-red-600"}`}>
                      {formatPercent(item.marginPct)}
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="text" placeholder="PED-001"
                        value={orderCodes[item.sku] || ""}
                        onChange={e => setOrderCodes(prev => ({ ...prev, [item.sku]: e.target.value }))}
                        className="border rounded px-2 py-1 w-24 text-xs" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 font-bold">
                <tr className="border-t-2">
                  <td className="px-2 py-2" colSpan={4}>TOTAL ({filtered.length} SKUs)</td>
                  <td className="px-2 py-2 text-right">{filtered.reduce((s, i) => s + i.totalSold, 0)}</td>
                  <td className="px-2 py-2 text-right">{(filtered.reduce((s, i) => s + i.avgDaily, 0)).toFixed(1)}</td>
                  <td className="px-2 py-2 text-right">{(filtered.reduce((s, i) => s + i.avgWeekly, 0)).toFixed(0)}</td>
                  <td className="px-2 py-2 text-right">{(filtered.reduce((s, i) => s + i.avgBiweekly, 0)).toFixed(0)}</td>
                  <td className="px-2 py-2 text-right">{(filtered.reduce((s, i) => s + i.avgMonthly, 0)).toFixed(0)}</td>
                  <td className="px-2 py-2 text-right text-indigo-600">{filtered.reduce((s, i) => s + i.suggestedPurchase, 0)}</td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2 text-right text-orange-600">{formatCurrency(filtered.reduce((s, i) => s + i.purchaseCost, 0))}</td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2 text-right text-green-600">{formatCurrency(filtered.reduce((s, i) => s + i.marginEstimated, 0))}</td>
                  <td className="px-2 py-2" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
