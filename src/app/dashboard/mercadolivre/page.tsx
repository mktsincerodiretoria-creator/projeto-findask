"use client";

import { useState, useEffect, useCallback } from "react";
import MetricCard from "@/components/MetricCard";
import RevenueChart from "@/components/RevenueChart";
import DateFilter from "@/components/DateFilter";
import SyncButton from "@/components/SyncButton";

interface Metrics {
  totals: {
    revenue: number;
    cost: number;
    tax: number;
    platformFee: number;
    shippingCost: number;
    discount: number;
    margin: number;
    totalOrders: number;
    totalUnits: number;
    avgTicket: number;
    marginPercent: number;
  };
  daily: Array<{
    date: string;
    platform: string;
    revenue: number;
    platformFee: number;
    shippingCost: number;
    tax: number;
    margin: number;
  }>;
}

export default function MercadoLivrePage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const fetchMetrics = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ platform: "MERCADO_LIVRE" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await fetch(`/api/metrics?${params.toString()}`);
      const data = await res.json();
      setMetrics(data);
    } catch (error) {
      console.error("Error fetching ML metrics:", error);
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
    fetchMetrics(fromStr, toStr);
  }, [fetchMetrics]);

  function handleFilter(from: string, to: string) {
    setDateRange({ from, to });
    fetchMetrics(from, to);
  }

  const t = metrics?.totals || {
    revenue: 0, cost: 0, tax: 0, platformFee: 0,
    shippingCost: 0, discount: 0, margin: 0,
    totalOrders: 0, totalUnits: 0, avgTicket: 0, marginPercent: 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            🟡 Mercado Livre
          </h1>
          <p className="text-sm text-gray-500">
            {dateRange.from && dateRange.to
              ? `${new Date(dateRange.from).toLocaleDateString("pt-BR")} - ${new Date(dateRange.to).toLocaleDateString("pt-BR")}`
              : "Ultimos 30 dias"}
          </p>
        </div>
        <SyncButton onSyncComplete={() => fetchMetrics(dateRange.from, dateRange.to)} />
      </div>

      <DateFilter onFilter={handleFilter} />

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
          <span className="ml-3 text-gray-500">Carregando dados do Mercado Livre...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Faturamento" value={t.revenue} icon="💰" />
            <MetricCard title="Vendas" value={t.totalOrders} type="number" icon="🛒" />
            <MetricCard title="Ticket Medio" value={t.avgTicket} icon="🎫" />
            <MetricCard
              title="Margem"
              value={t.margin}
              subtitle={`${t.marginPercent.toFixed(1)}% do faturamento`}
              icon="📈"
              color={t.margin >= 0 ? "text-green-600" : "text-red-600"}
            />
          </div>

          {/* Detalhamento de custos */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-700 mb-3">Detalhamento de Custos</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard title="(-) Custo Produtos" value={t.cost} icon="📦" />
              <MetricCard title="(-) Impostos" value={t.tax} icon="🏛️" />
              <MetricCard title="(-) Tarifa ML" value={t.platformFee} icon="💳" />
              <MetricCard title="(-) Frete Vendedor" value={t.shippingCost} icon="🚚" />
              <MetricCard title="(-) Descontos" value={t.discount} icon="🏷️" />
              <MetricCard
                title="= Margem Liquida"
                value={t.margin}
                icon="✅"
                color={t.margin >= 0 ? "text-green-600" : "text-red-600"}
              />
            </div>
          </div>

          <RevenueChart data={metrics?.daily || []} />
        </>
      )}
    </div>
  );
}
