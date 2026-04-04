"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import MetricCard from "@/components/MetricCard";
import DateFilter from "@/components/DateFilter";
import SyncButton from "@/components/SyncButton";
import RevenueChart from "@/components/RevenueChart";
import ImportPlanilha from "@/components/ImportPlanilha";
import StoreFilter from "@/components/StoreFilter";

// ======= TYPES =======
interface OrderItem {
  title: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sku: string | null;
  unitCost: number;
  totalCost: number;
  hasCost: boolean;
}
interface OrderData {
  id: string;
  platformOrderId: string;
  totalAmount: number;
  platformFee: number;
  sellerShippingCost: number;
  shippingCost: number;
  discount: number;
  orderDate: string;
  productCost: number;
  calculatedTax: number;
  taxRate: number;
  margin: number;
  marginPercent: number;
  items: OrderItem[];
}
interface MetricsData {
  totals: {
    revenue: number; cost: number; tax: number; platformFee: number;
    shippingCost: number; discount: number; margin: number;
    totalOrders: number; totalUnits: number; avgTicket: number; marginPercent: number;
  };
  daily: Array<{
    date: string; platform: string; revenue: number; platformFee: number;
    shippingCost: number; tax: number; margin: number;
  }>;
}
interface FlatRow {
  orderId: string; orderNumber: string; title: string; sku: string; date: string; dateObj: Date;
  unitPrice: number; quantity: number; revenue: number; cost: number;
  hasCost: boolean; tax: number; fee: number; freteVend: number;
  freteComp: number; margin: number; mc: number;
}

type SortKey = keyof FlatRow;
type SortDir = "asc" | "desc";

function SortHeader({ label, field, sortKey, sortDir, onSort, align = "right" }: {
  label: string; field: SortKey; sortKey: SortKey; sortDir: SortDir;
  onSort: (k: SortKey) => void; align?: "left" | "right" | "center";
}) {
  const active = sortKey === field;
  const arrow = active ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : " \u25B4\u25BE";
  const ta = align === "left" ? "text-left" : align === "center" ? "text-center" : "text-right";
  return (
    <th className={`${ta} px-3 py-2 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100`} onClick={() => onSort(field)}>
      {label}<span className={`text-xs ml-0.5 ${active ? "text-blue-600" : "text-gray-400"}`}>{arrow}</span>
    </th>
  );
}

export default function MercadoLivrePage() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [taxRate, setTaxRate] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("dateObj");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [returns, setReturns] = useState<{count:number;totalAmount:number;orders:Array<{platformOrderId:string;status:string;totalAmount:number;orderDate:string;items:Array<{title:string;sku:string|null;quantity:number}>}>}>({count:0,totalAmount:0,orders:[]});
  const [adsTotals, setAdsTotals] = useState<{spend:number;revenue:number;clicks:number;impressions:number;orders:number;cpc:number;acos:number;tacos:number;roas:number}>({spend:0,revenue:0,clicks:0,impressions:0,orders:0,cpc:0,acos:0,tacos:0,roas:0});
  const [adsCampaigns, setAdsCampaigns] = useState<Array<{campaignName:string;spend:number;revenue:number;clicks:number;impressions:number;orders:number}>>([]);
  const [importingAds, setImportingAds] = useState(false);
  const [adsMsg, setAdsMsg] = useState("");
  const adsFileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async (from?: string, to?: string, accId?: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ platform: "MERCADO_LIVRE" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const ordParams = new URLSearchParams();
      if (from) ordParams.set("from", from);
      if (to) ordParams.set("to", to);
      if (accId) {
        ordParams.set("accountId", accId);
      } else {
        ordParams.set("platform", "MERCADO_LIVRE");
      }

      const adsParams = new URLSearchParams({ platform: "MERCADO_LIVRE" });
      if (from) adsParams.set("from", from);
      if (to) adsParams.set("to", to);

      // Usa allSettled para que falha de uma API nao afete as outras
      const [metricsResult, ordersResult, adsResult] = await Promise.allSettled([
        fetch(`/api/metrics?${params.toString()}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/orders?${ordParams.toString()}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/ads?${adsParams.toString()}`).then(r => r.ok ? r.json() : null),
      ]);

      const metricsData = metricsResult.status === "fulfilled" ? metricsResult.value : null;
      const ordersData = ordersResult.status === "fulfilled" ? ordersResult.value : null;
      const adsData = adsResult.status === "fulfilled" ? adsResult.value : null;

      if (metricsData) setMetrics(metricsData);
      if (ordersData) {
        setOrders(ordersData.orders || []);
        setTaxRate(ordersData.taxRate || 0);
        if (ordersData.returns) setReturns(ordersData.returns);
      }
      if (adsData) {
        if (adsData.totals) setAdsTotals(adsData.totals);
        if (adsData.byCampaign) setAdsCampaigns(adsData.byCampaign);
      }
    } catch (e) {
      console.error("Error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const f = from.toISOString().split("T")[0];
    const t = now.toISOString().split("T")[0];
    setDateRange({ from: f, to: t });
    fetchData(f, t);
  }, [fetchData]);

  // handleFilter removido - inline no DateFilter
  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const rows: FlatRow[] = useMemo(() => {
    const flat: FlatRow[] = [];
    for (const order of orders) {
      const n = order.items.length || 1;
      for (const item of order.items) {
        flat.push({
          orderId: order.id, orderNumber: order.platformOrderId, title: item.title, sku: item.sku || "",
          date: new Date(order.orderDate).toLocaleDateString("pt-BR"),
          dateObj: new Date(order.orderDate),
          unitPrice: item.unitPrice, quantity: item.quantity, revenue: item.totalPrice,
          cost: item.totalCost, hasCost: item.hasCost,
          tax: item.totalPrice * (order.taxRate / 100),
          fee: order.platformFee / n, freteVend: order.sellerShippingCost / n,
          freteComp: order.shippingCost / n, margin: order.margin / n, mc: order.marginPercent,
        });
      }
    }
    flat.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av instanceof Date && bv instanceof Date) return sortDir === "asc" ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
      if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return flat;
  }, [orders, sortKey, sortDir]);

  const salesTotals = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost, tax: a.tax + r.tax, fee: a.fee + r.fee, freteVend: a.freteVend + r.freteVend, margin: a.margin + r.margin }), { revenue: 0, cost: 0, tax: 0, fee: 0, freteVend: 0, margin: 0 });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mercado Livre</h1>
          <p className="text-sm text-gray-500">
            {dateRange.from && dateRange.to ? `${new Date(dateRange.from).toLocaleDateString("pt-BR")} - ${new Date(dateRange.to).toLocaleDateString("pt-BR")}` : "Ultimos 30 dias"}
          </p>
        </div>
        <SyncButton onSyncComplete={() => fetchData(dateRange.from, dateRange.to, selectedAccount)} />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <DateFilter onFilter={(from, to) => { setDateRange({ from, to }); fetchData(from, to, selectedAccount); }} />
        <StoreFilter platform="MERCADO_LIVRE" onFilterChange={(accId) => { setSelectedAccount(accId); fetchData(dateRange.from, dateRange.to, accId); }} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
          <span className="ml-3 text-gray-500">Carregando dados do Mercado Livre...</span>
        </div>
      ) : (
        <>
          {/* ===== DASHBOARD (usando daily_metrics para totais precisos) ===== */}
          {(() => {
            const t = metrics?.totals;
            const revenue = t?.revenue ?? salesTotals.revenue;
            const margin = t?.margin ?? salesTotals.margin;
            const totalOrders = t?.totalOrders ?? rows.length;
            const cost = t?.cost ?? salesTotals.cost;
            const platformFee = t?.platformFee ?? salesTotals.fee;
            const shippingCost = t?.shippingCost ?? salesTotals.freteVend;
            const tax = t?.tax ?? salesTotals.tax;
            const discount = t?.discount ?? 0;
            const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
            const avgTicket = totalOrders > 0 ? revenue / totalOrders : 0;
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Faturamento" value={revenue} icon="💰" />
                  <MetricCard title="Vendas" value={totalOrders} type="number" icon="🛒" />
                  <MetricCard title="Ticket Medio" value={avgTicket} icon="🎫" />
                  <MetricCard title="Margem" value={margin} subtitle={`${marginPct.toFixed(1)}% do faturamento`} icon="📈" color={margin >= 0 ? "text-green-600" : "text-red-600"} />
                </div>

                <div className="bg-white rounded-lg border p-4">
                  <h3 className="font-semibold text-gray-700 mb-3">Detalhamento de Custos</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <MetricCard title="(-) Custo Produtos" value={cost} icon="📦" />
                    <MetricCard title={`(-) Impostos (${taxRate}%)`} value={tax} icon="🏛️" />
                    <MetricCard title="(-) Tarifa ML" value={platformFee} icon="💳" />
                    <MetricCard title="(-) Frete Vendedor" value={shippingCost} icon="🚚" />
                    <MetricCard title="(-) Descontos" value={discount} icon="🏷️" />
                    <MetricCard title="= Margem Liquida" value={margin} icon="✅" color={margin >= 0 ? "text-green-600" : "text-red-600"} />
                  </div>
                </div>
              </>
            );
          })()}

          <RevenueChart data={metrics?.daily || []} />

          {/* ===== ADS / ANUNCIOS PATROCINADOS ===== */}
          <div className="border-t-2 border-blue-400 pt-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">Anuncios Patrocinados (ADS)</h2>
              <div className="flex items-center gap-3">
                <label className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 cursor-pointer">
                  Importar CSV ADS
                  <input ref={adsFileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" className="hidden" disabled={importingAds}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setImportingAds(true); setAdsMsg("");
                      try {
                        let csvText: string;
                        if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
                          const XLSX = (await import("xlsx")).default;
                          const buf = await file.arrayBuffer();
                          const wb = XLSX.read(buf, { type: "array" });
                          csvText = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t" });
                        } else { csvText = await file.text(); }
                        const res = await fetch("/api/ads/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText, platform: "MERCADO_LIVRE" }) });
                        const data = await res.json();
                        if (data.success) { setAdsMsg(`${data.imported} campanhas importadas`); fetchData(dateRange.from, dateRange.to); }
                        else setAdsMsg(`Erro: ${data.error}`);
                      } catch (err) { setAdsMsg(`Erro: ${err}`); }
                      finally { setImportingAds(false); if (adsFileRef.current) adsFileRef.current.value = ""; }
                    }}
                  />
                </label>
                {importingAds && <span className="text-sm text-blue-600">Importando...</span>}
                {adsMsg && <span className={`text-sm ${adsMsg.includes("Erro") ? "text-red-500" : "text-green-600"}`}>{adsMsg}</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">Investimento</p>
                <p className="text-lg font-bold text-red-600">{formatCurrency(adsTotals.spend)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">Receita Ads</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(adsTotals.revenue)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">Custo por Clique</p>
                <p className="text-lg font-bold">{formatCurrency(adsTotals.cpc)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">Vendas Ads</p>
                <p className="text-lg font-bold">{adsTotals.orders}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">ACOS</p>
                <p className={`text-lg font-bold ${adsTotals.acos <= 15 ? "text-green-600" : adsTotals.acos <= 30 ? "text-yellow-600" : "text-red-600"}`}>{formatPercent(adsTotals.acos)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">TACOS</p>
                <p className={`text-lg font-bold ${adsTotals.tacos <= 10 ? "text-green-600" : adsTotals.tacos <= 20 ? "text-yellow-600" : "text-red-600"}`}>{formatPercent(adsTotals.tacos)}</p>
              </div>
            </div>

            {adsCampaigns.length > 0 && (
              <div className="bg-white rounded-lg border overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Campanha</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Investimento</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Receita</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Cliques</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Vendas</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">CPC</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">ACOS</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adsCampaigns.map((c, i) => {
                      const cCpc = c.clicks > 0 ? c.spend / c.clicks : 0;
                      const cAcos = c.revenue > 0 ? (c.spend / c.revenue) * 100 : 0;
                      const cRoas = c.spend > 0 ? c.revenue / c.spend : 0;
                      return (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium max-w-[250px] truncate">{c.campaignName}</td>
                          <td className="px-3 py-2 text-right text-red-600">{formatCurrency(c.spend)}</td>
                          <td className="px-3 py-2 text-right text-green-600">{formatCurrency(c.revenue)}</td>
                          <td className="px-3 py-2 text-right">{c.clicks}</td>
                          <td className="px-3 py-2 text-right">{c.orders}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(cCpc)}</td>
                          <td className={`px-3 py-2 text-right ${cAcos <= 15 ? "text-green-600" : "text-red-600"}`}>{formatPercent(cAcos)}</td>
                          <td className="px-3 py-2 text-right text-blue-600">{cRoas.toFixed(2)}x</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Importar planilha de vendas */}
          <ImportPlanilha platform="MERCADO_LIVRE" onImportComplete={() => fetchData(dateRange.from, dateRange.to)} />

          {/* ===== VENDAS (na mesma aba) ===== */}
          <div className="border-t-2 border-yellow-400 pt-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Vendas - Mercado Livre</h2>
            <p className="text-sm text-gray-500 mb-4">
              {metrics?.totals?.totalOrders ?? rows.length} vendas{orders.length >= 300 ? ` (tabela: ultimas ${orders.length})` : ""} | Imposto: {taxRate}%
              {taxRate === 0 && <a href="/configuracoes" className="text-blue-600 underline ml-1">(configurar)</a>}
            </p>

            {/* Resumo vendas */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">Faturamento</p>
                <p className="text-lg font-bold">{formatCurrency(salesTotals.revenue)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">(-) Custo</p>
                <p className="text-lg font-bold text-red-600">{formatCurrency(salesTotals.cost)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">(-) Imposto</p>
                <p className="text-lg font-bold text-red-600">{formatCurrency(salesTotals.tax)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">(-) Tarifa</p>
                <p className="text-lg font-bold text-red-600">{formatCurrency(salesTotals.fee)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">(-) Frete Vend</p>
                <p className="text-lg font-bold text-red-600">{formatCurrency(salesTotals.freteVend)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <p className="text-xs text-gray-500">= Margem</p>
                <p className={`text-lg font-bold ${salesTotals.margin >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(salesTotals.margin)}</p>
              </div>
            </div>

            {/* Tabela */}
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm min-w-[1400px]">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <SortHeader label="N. Pedido" field="orderNumber" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader label="Anuncio" field="title" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader label="SKU" field="sku" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader label="Data" field="dateObj" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader label="Valor Unit." field="unitPrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Qtde" field="quantity" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortHeader label="Faturamento" field="revenue" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Custo (-)" field="cost" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Imposto (-)" field="tax" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Tarifa (-)" field="fee" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Frete Vend (-)" field="freteVend" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Frete Comp" field="freteComp" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Margem" field="margin" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="MC %" field="mc" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.orderId}-${idx}`} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{row.orderNumber}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate" title={row.title}>{row.title}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.sku || <span className="text-orange-500">Sem SKU</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.unitPrice)}</td>
                      <td className="px-3 py-2 text-center">{row.quantity}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(row.revenue)}</td>
                      <td className="px-3 py-2 text-right">{row.hasCost ? formatCurrency(row.cost) : <span className="text-orange-500 text-xs">Sem custo</span>}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.tax)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.fee)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.freteVend)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.freteComp)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${row.margin >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(row.margin)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${row.mc >= 0 ? "text-green-600" : "text-red-600"}`}>{formatPercent(row.mc)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={14} className="px-3 py-8 text-center text-gray-500">Nenhuma venda no periodo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ===== DEVOLUCOES E CANCELAMENTOS ===== */}
          {returns.count > 0 && (
            <div className="border-t-2 border-red-400 pt-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Devolucoes e Cancelamentos</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-red-50 rounded-lg border border-red-200 p-3">
                  <p className="text-xs text-red-700 font-medium">Total Devolvido/Cancelado</p>
                  <p className="text-xl font-bold text-red-700">{returns.count} pedidos</p>
                </div>
                <div className="bg-red-50 rounded-lg border border-red-200 p-3">
                  <p className="text-xs text-red-700 font-medium">Valor Perdido</p>
                  <p className="text-xl font-bold text-red-700">{formatCurrency(returns.totalAmount)}</p>
                </div>
                <div className="bg-red-50 rounded-lg border border-red-200 p-3">
                  <p className="text-xs text-red-700 font-medium">% do Faturamento</p>
                  <p className="text-xl font-bold text-red-700">{formatPercent((metrics?.totals?.revenue || salesTotals.revenue) > 0 ? (returns.totalAmount / ((metrics?.totals?.revenue || salesTotals.revenue) + returns.totalAmount)) * 100 : 0)}</p>
                </div>
              </div>

              <div className="bg-white rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-red-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-red-700">N. Pedido</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Produto</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">SKU</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Data</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Status</th>
                      <th className="text-right px-3 py-2 font-medium text-red-700">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.orders.map((o, i) => (
                      <tr key={i} className="border-t hover:bg-red-50">
                        <td className="px-3 py-2 font-mono text-xs">{o.platformOrderId}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{o.items[0]?.title || "-"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{o.items[0]?.sku || "-"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(o.orderDate).toLocaleDateString("pt-BR")}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{o.status}</span></td>
                        <td className="px-3 py-2 text-right font-medium text-red-600">{formatCurrency(o.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
