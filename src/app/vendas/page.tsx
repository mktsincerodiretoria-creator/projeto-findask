"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import DateFilter from "@/components/DateFilter";

interface OrderItem {
  id: string;
  platformItemId: string;
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
  status: string;
  totalAmount: number;
  platformFee: number;
  sellerShippingCost: number;
  shippingCost: number;
  discount: number;
  orderDate: string;
  buyerNickname: string | null;
  productCost: number;
  calculatedTax: number;
  taxRate: number;
  margin: number;
  marginPercent: number;
  items: OrderItem[];
  account: { platform: string; nickname: string | null };
}

// Linha achatada para ordenacao
interface FlatRow {
  orderId: string;
  title: string;
  sku: string;
  date: string;
  dateObj: Date;
  unitPrice: number;
  quantity: number;
  revenue: number;
  cost: number;
  hasCost: boolean;
  tax: number;
  fee: number;
  freteVend: number;
  freteComp: number;
  margin: number;
  mc: number;
}

type SortKey = keyof FlatRow;
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right" | "center";
}) {
  const active = sortKey === field;
  const arrow = active ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : " \u25B4\u25BE";
  const textAlign = align === "left" ? "text-left" : align === "center" ? "text-center" : "text-right";
  return (
    <th
      className={`${textAlign} px-3 py-2 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className={`text-xs ml-0.5 ${active ? "text-blue-600" : "text-gray-400"}`}>{arrow}</span>
    </th>
  );
}

export default function VendasPage() {
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [taxRate, setTaxRate] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("dateObj");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchOrders = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();
      setOrders(data.orders || []);
      setTaxRate(data.taxRate || 0);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    fetchOrders(from.toISOString().split("T")[0], now.toISOString().split("T")[0]);
  }, [fetchOrders]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Achata orders em rows e aplica ordenacao
  const rows: FlatRow[] = useMemo(() => {
    const flat: FlatRow[] = [];
    for (const order of orders) {
      const itemCount = order.items.length || 1;
      for (const item of order.items) {
        flat.push({
          orderId: order.id,
          title: item.title,
          sku: item.sku || "",
          date: new Date(order.orderDate).toLocaleDateString("pt-BR"),
          dateObj: new Date(order.orderDate),
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          revenue: item.totalPrice,
          cost: item.totalCost,
          hasCost: item.hasCost,
          tax: item.totalPrice * (order.taxRate / 100),
          fee: order.platformFee / itemCount,
          freteVend: order.sellerShippingCost / itemCount,
          freteComp: order.shippingCost / itemCount,
          margin: order.margin / itemCount,
          mc: order.marginPercent,
        });
      }
    }

    flat.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (aVal instanceof Date && bVal instanceof Date) {
        return sortDir === "asc" ? aVal.getTime() - bVal.getTime() : bVal.getTime() - aVal.getTime();
      }
      return sortDir === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });

    return flat;
  }, [orders, sortKey, sortDir]);

  // Totais
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.cost,
      tax: acc.tax + r.tax,
      fee: acc.fee + r.fee,
      freteVend: acc.freteVend + r.freteVend,
      margin: acc.margin + r.margin,
    }),
    { revenue: 0, cost: 0, tax: 0, fee: 0, freteVend: 0, margin: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendas Detalhadas</h1>
          <p className="text-sm text-gray-500">
            {rows.length} vendas |{" "}
            Imposto: {taxRate}%{" "}
            {taxRate === 0 && (
              <a href="/configuracoes" className="text-blue-600 underline">(configurar)</a>
            )}
          </p>
        </div>
      </div>

      <DateFilter onFilter={(from, to) => fetchOrders(from, to)} />

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">Faturamento</p>
          <p className="text-lg font-bold">{formatCurrency(totals.revenue)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Custo</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.cost)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Imposto ({taxRate}%)</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.tax)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Tarifa ML</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.fee)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Frete Vendedor</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.freteVend)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">= Margem</p>
          <p className={`text-lg font-bold ${totals.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(totals.margin)}
          </p>
        </div>
      </div>

      {/* Tabela com ordenacao */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <span className="ml-3 text-gray-500">Carregando vendas...</span>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
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
                  <td className="px-3 py-2 max-w-[200px] truncate" title={row.title}>{row.title}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.sku || <span className="text-orange-500">Sem SKU</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.unitPrice)}</td>
                  <td className="px-3 py-2 text-center">{row.quantity}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(row.revenue)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.hasCost ? formatCurrency(row.cost) : <span className="text-orange-500 text-xs">Sem custo</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.tax)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.fee)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.freteVend)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.freteComp)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${row.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrency(row.margin)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${row.mc >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatPercent(row.mc)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-gray-500">
                    Nenhuma venda encontrada no periodo selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
