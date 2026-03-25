"use client";

import { useState, useEffect, useCallback } from "react";
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

export default function VendasPage() {
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [taxRate, setTaxRate] = useState(0);
  const [, setDateRange] = useState({ from: "", to: "" });

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
    const fromStr = from.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];
    setDateRange({ from: fromStr, to: toStr });
    fetchOrders(fromStr, toStr);
  }, [fetchOrders]);

  function handleFilter(from: string, to: string) {
    setDateRange({ from, to });
    fetchOrders(from, to);
  }

  // Totais
  const totals = orders.reduce(
    (acc, o) => ({
      revenue: acc.revenue + o.totalAmount,
      productCost: acc.productCost + o.productCost,
      tax: acc.tax + o.calculatedTax,
      platformFee: acc.platformFee + o.platformFee,
      shipping: acc.shipping + o.sellerShippingCost,
      margin: acc.margin + o.margin,
    }),
    { revenue: 0, productCost: 0, tax: 0, platformFee: 0, shipping: 0, margin: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendas Detalhadas</h1>
          <p className="text-sm text-gray-500">
            {orders.length} vendas |{" "}
            Imposto: {taxRate}%{" "}
            {taxRate === 0 && (
              <a href="/configuracoes" className="text-blue-600 underline">
                (configurar)
              </a>
            )}
          </p>
        </div>
      </div>

      <DateFilter onFilter={handleFilter} />

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">Faturamento</p>
          <p className="text-lg font-bold">{formatCurrency(totals.revenue)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Custo</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.productCost)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Imposto ({taxRate}%)</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.tax)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Tarifa ML</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.platformFee)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">(-) Frete Vendedor</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.shipping)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">= Margem</p>
          <p className={`text-lg font-bold ${totals.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(totals.margin)}
          </p>
        </div>
      </div>

      {/* Tabela de vendas */}
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
                <th className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">Anuncio</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">SKU</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Data</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Valor</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">Qtde</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Faturamento</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Custo (-)</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Imposto (-)</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Tarifa (-)</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Frete Vend (-)</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Frete Comp</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 text-green-700">Margem</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 text-green-700">MC %</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) =>
                order.items.map((item, idx) => (
                  <tr
                    key={`${order.id}-${idx}`}
                    className="border-t hover:bg-gray-50"
                  >
                    <td className="px-3 py-2 max-w-[200px] truncate" title={item.title}>
                      {item.title}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {item.sku || (
                        <span className="text-orange-500">Sem SKU</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(order.orderDate).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.totalPrice)}</td>
                    <td className="px-3 py-2 text-right">
                      {item.hasCost ? (
                        formatCurrency(item.totalCost)
                      ) : (
                        <span className="text-orange-500 text-xs">Sem custo</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(item.totalPrice * (order.taxRate / 100))}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(order.platformFee / order.items.length)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(order.sellerShippingCost / order.items.length)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(order.shippingCost / order.items.length)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${order.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(order.margin / order.items.length)}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${order.marginPercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatPercent(order.marginPercent)}
                    </td>
                  </tr>
                ))
              )}
              {orders.length === 0 && (
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
