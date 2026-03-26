"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import MetricCard from "@/components/MetricCard";
import DateFilter from "@/components/DateFilter";
import SyncButton from "@/components/SyncButton";
import RevenueChart from "@/components/RevenueChart";
import ImportPlanilha from "@/components/ImportPlanilha";

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
  const [sortKey, setSortKey] = useState<SortKey>("dateObj");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchData = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ platform: "MERCADO_LIVRE" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const ordParams = new URLSearchParams();
      if (from) ordParams.set("from", from);
      if (to) ordParams.set("to", to);
      ordParams.set("platform", "MERCADO_LIVRE");

      const [metricsRes, ordersRes] = await Promise.all([
        fetch(`/api/metrics?${params.toString()}`),
        fetch(`/api/orders?${ordParams.toString()}`),
      ]);
      const [metricsData, ordersData] = await Promise.all([metricsRes.json(), ordersRes.json()]);
      setMetrics(metricsData);
      setOrders(ordersData.orders || []);
      setTaxRate(ordersData.taxRate || 0);
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

  function handleFilter(from: string, to: string) {
    setDateRange({ from, to });
    fetchData(from, to);
  }
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
        <SyncButton onSyncComplete={() => fetchData(dateRange.from, dateRange.to)} />
      </div>

      <DateFilter onFilter={handleFilter} />

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
          <span className="ml-3 text-gray-500">Carregando dados do Mercado Livre...</span>
        </div>
      ) : (
        <>
          {/* ===== DASHBOARD (usando dados das vendas, nao daily_metrics) ===== */}
          {(() => {
            const marginPct = salesTotals.revenue > 0 ? (salesTotals.margin / salesTotals.revenue) * 100 : 0;
            const avgTicket = rows.length > 0 ? salesTotals.revenue / rows.length : 0;
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Faturamento" value={salesTotals.revenue} icon="💰" />
                  <MetricCard title="Vendas" value={rows.length} type="number" icon="🛒" />
                  <MetricCard title="Ticket Medio" value={avgTicket} icon="🎫" />
                  <MetricCard title="Margem" value={salesTotals.margin} subtitle={`${marginPct.toFixed(1)}% do faturamento`} icon="📈" color={salesTotals.margin >= 0 ? "text-green-600" : "text-red-600"} />
                </div>

                <div className="bg-white rounded-lg border p-4">
                  <h3 className="font-semibold text-gray-700 mb-3">Detalhamento de Custos</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <MetricCard title="(-) Custo Produtos" value={salesTotals.cost} icon="📦" />
                    <MetricCard title={`(-) Impostos (${taxRate}%)`} value={salesTotals.tax} icon="🏛️" />
                    <MetricCard title="(-) Tarifa ML" value={salesTotals.fee} icon="💳" />
                    <MetricCard title="(-) Frete Vendedor" value={salesTotals.freteVend} icon="🚚" />
                    <MetricCard title="(-) Descontos" value={0} icon="🏷️" />
                    <MetricCard title="= Margem Liquida" value={salesTotals.margin} icon="✅" color={salesTotals.margin >= 0 ? "text-green-600" : "text-red-600"} />
                  </div>
                </div>
              </>
            );
          })()}

          <RevenueChart data={metrics?.daily || []} />

          {/* Importar planilha */}
          <ImportPlanilha platform="MERCADO_LIVRE" onImportComplete={() => fetchData(dateRange.from, dateRange.to)} />

          {/* ===== VENDAS (na mesma aba) ===== */}
          <div className="border-t-2 border-yellow-400 pt-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Vendas - Mercado Livre</h2>
            <p className="text-sm text-gray-500 mb-4">
              {rows.length} vendas | Imposto: {taxRate}%
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
        </>
      )}
    </div>
  );
}
