"use client";

import { useState, useEffect, useCallback } from "react";
import MetricCard from "@/components/MetricCard";
import PlatformSummary from "@/components/PlatformSummary";
import RevenueChart from "@/components/RevenueChart";
import DateFilter from "@/components/DateFilter";
import SyncButton from "@/components/SyncButton";

interface OrderItem {
  totalPrice: number;
  sku: string | null;
  unitCost: number;
  totalCost: number;
  hasCost: boolean;
}
interface OrderData {
  id: string;
  totalAmount: number;
  platformFee: number;
  sellerShippingCost: number;
  shippingCost: number;
  orderDate: string;
  productCost: number;
  calculatedTax: number;
  taxRate: number;
  margin: number;
  marginPercent: number;
  items: OrderItem[];
  account: { platform: string };
}
interface MetricsData {
  daily: Array<{
    date: string; platform: string; revenue: number; platformFee: number;
    shippingCost: number; tax: number; margin: number;
  }>;
}

const platforms = [
  { key: "MERCADO_LIVRE", name: "Mercado Livre", icon: "🟡", color: "text-yellow-600" },
  { key: "SHOPEE", name: "Shopee", icon: "🧡", color: "text-orange-500" },
  { key: "TIKTOK_SHOP", name: "TikTok Shop", icon: "🎵", color: "text-gray-800" },
  { key: "AMAZON", name: "Amazon", icon: "📦", color: "text-orange-400" },
];

export default function DashboardPage() {
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [taxRate, setTaxRate] = useState(0);

  const fetchData = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const [ordersRes, metricsRes] = await Promise.all([
        fetch(`/api/orders?${params.toString()}`),
        fetch(`/api/metrics?${params.toString()}`),
      ]);
      const [ordersData, metricsData] = await Promise.all([ordersRes.json(), metricsRes.json()]);
      setOrders(ordersData.orders || []);
      setTaxRate(ordersData.taxRate || 0);
      setMetrics(metricsData);
    } catch (error) {
      console.error("Error:", error);
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

  // Calcula totais a partir dos pedidos reais
  const totals = orders.reduce(
    (acc, o) => ({
      revenue: acc.revenue + o.totalAmount,
      cost: acc.cost + o.productCost,
      tax: acc.tax + o.calculatedTax,
      fee: acc.fee + o.platformFee,
      freteVend: acc.freteVend + o.sellerShippingCost,
      margin: acc.margin + o.margin,
    }),
    { revenue: 0, cost: 0, tax: 0, fee: 0, freteVend: 0, margin: 0 }
  );

  // Agrupa por plataforma
  const byPlatform: Record<string, {
    revenue: number; cost: number; tax: number; platformFee: number;
    shippingCost: number; discount: number; margin: number; totalOrders: number;
  }> = {};

  for (const order of orders) {
    const p = order.account?.platform || "MERCADO_LIVRE";
    if (!byPlatform[p]) {
      byPlatform[p] = { revenue: 0, cost: 0, tax: 0, platformFee: 0, shippingCost: 0, discount: 0, margin: 0, totalOrders: 0 };
    }
    byPlatform[p].revenue += order.totalAmount;
    byPlatform[p].cost += order.productCost;
    byPlatform[p].tax += order.calculatedTax;
    byPlatform[p].platformFee += order.platformFee;
    byPlatform[p].shippingCost += order.sellerShippingCost;
    byPlatform[p].margin += order.margin;
    byPlatform[p].totalOrders += 1;
  }

  const marginPct = totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard Geral</h1>
          <p className="text-sm text-gray-500">
            {dateRange.from && dateRange.to
              ? `${new Date(dateRange.from).toLocaleDateString("pt-BR")} - ${new Date(dateRange.to).toLocaleDateString("pt-BR")}`
              : "Ultimos 30 dias"}
          </p>
        </div>
        <SyncButton onSyncComplete={() => fetchData(dateRange.from, dateRange.to)} />
      </div>

      <DateFilter onFilter={handleFilter} />

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <span className="ml-3 text-gray-500">Carregando dados...</span>
        </div>
      ) : (
        <>
          {/* Metricas gerais - dados reais das vendas */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard title="Faturamento" value={totals.revenue} subtitle="ML + Shopee + TikTok" icon="💰" />
            <MetricCard title="(-) Custo" value={totals.cost} icon="📦" />
            <MetricCard title={`(-) Impostos (${taxRate}%)`} value={totals.tax} icon="🏛️" />
            <MetricCard title="(-) Tarifas" value={totals.fee} icon="💳" />
            <MetricCard title="(-) Frete Vendedor" value={totals.freteVend} icon="🚚" />
            <MetricCard
              title="= Margem"
              value={totals.margin}
              subtitle={`${marginPct.toFixed(1)}%`}
              icon="📈"
              color={totals.margin >= 0 ? "text-green-600" : "text-red-600"}
            />
          </div>

          <RevenueChart data={metrics?.daily || []} />

          {/* Resumo por plataforma */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Resumo por Plataforma</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {platforms.map((p) => (
                <PlatformSummary
                  key={p.key}
                  platform={p.name}
                  icon={p.icon}
                  color={p.color}
                  data={byPlatform[p.key] || {
                    revenue: 0, cost: 0, tax: 0, platformFee: 0,
                    shippingCost: 0, discount: 0, margin: 0, totalOrders: 0,
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
