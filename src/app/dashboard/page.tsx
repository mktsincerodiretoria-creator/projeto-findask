"use client";

import { useState, useEffect, useCallback } from "react";
import MetricCard from "@/components/MetricCard";
import PlatformSummary from "@/components/PlatformSummary";
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
  byPlatform: Record<
    string,
    {
      revenue: number;
      cost: number;
      tax: number;
      platformFee: number;
      shippingCost: number;
      discount: number;
      margin: number;
      totalOrders: number;
      totalUnits: number;
    }
  >;
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

const emptyTotals = {
  revenue: 0,
  cost: 0,
  tax: 0,
  platformFee: 0,
  shippingCost: 0,
  discount: 0,
  margin: 0,
  totalOrders: 0,
  totalUnits: 0,
  avgTicket: 0,
  marginPercent: 0,
};

const platforms = [
  {
    key: "MERCADO_LIVRE",
    name: "Mercado Livre",
    icon: "🟡",
    color: "text-yellow-600",
  },
  { key: "SHOPEE", name: "Shopee", icon: "🧡", color: "text-orange-500" },
  {
    key: "TIKTOK_SHOP",
    name: "TikTok Shop",
    icon: "🎵",
    color: "text-gray-800",
  },
  { key: "AMAZON", name: "Amazon", icon: "📦", color: "text-orange-400" },
];

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const fetchMetrics = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await fetch(`/api/metrics?${params.toString()}`);
      const data = await res.json();
      setMetrics(data);
    } catch (error) {
      console.error("Error fetching metrics:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carrega ultimos 30 dias por padrao
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

  const totals = metrics?.totals || emptyTotals;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard Geral</h1>
          <p className="text-sm text-gray-500">
            {dateRange.from && dateRange.to
              ? `${new Date(dateRange.from).toLocaleDateString("pt-BR")} - ${new Date(dateRange.to).toLocaleDateString("pt-BR")}`
              : "Ultimos 30 dias"}
          </p>
        </div>
        <SyncButton onSyncComplete={() => fetchMetrics(dateRange.from, dateRange.to)} />
      </div>

      {/* Filtro de datas */}
      <DateFilter onFilter={handleFilter} />

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <span className="ml-3 text-gray-500">Carregando dados...</span>
        </div>
      ) : (
        <>
          {/* Metricas gerais */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard
              title="Faturamento"
              value={totals.revenue}
              subtitle="ML + Shopee + TikTok"
              icon="💰"
            />
            <MetricCard
              title="Custo"
              value={totals.cost}
              icon="📊"
            />
            <MetricCard
              title="Impostos"
              value={totals.tax}
              icon="🏛️"
            />
            <MetricCard
              title="Tarifas"
              value={totals.platformFee}
              icon="💳"
            />
            <MetricCard
              title="Frete Total"
              value={totals.shippingCost}
              icon="🚚"
            />
            <MetricCard
              title="Margem Total"
              value={totals.margin}
              subtitle={`${totals.marginPercent.toFixed(1)}%`}
              icon="📈"
              color={totals.margin >= 0 ? "text-green-600" : "text-red-600"}
            />
          </div>

          {/* Grafico */}
          <RevenueChart data={metrics?.daily || []} />

          {/* Resumo por plataforma */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              Resumo por Plataforma
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {platforms.map((p) => (
                <PlatformSummary
                  key={p.key}
                  platform={p.name}
                  icon={p.icon}
                  color={p.color}
                  data={
                    metrics?.byPlatform?.[p.key] || {
                      revenue: 0,
                      cost: 0,
                      tax: 0,
                      platformFee: 0,
                      shippingCost: 0,
                      discount: 0,
                      margin: 0,
                      totalOrders: 0,
                      totalUnits: 0,
                    }
                  }
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
