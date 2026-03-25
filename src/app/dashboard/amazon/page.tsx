"use client";

import MetricCard from "@/components/MetricCard";

export default function AmazonPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Amazon</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Faturamento" value={0} icon="💰" />
        <MetricCard title="Vendas" value={0} type="number" icon="🛒" />
        <MetricCard title="Ticket Medio" value={0} icon="🎫" />
        <MetricCard title="Margem" value={0} icon="📈" />
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 text-center">
        <p className="text-orange-800 text-lg font-semibold mb-2">Integracao Amazon - Em breve</p>
        <p className="text-orange-600 text-sm">
          A integracao com a Amazon sera implementada. Dashboard e vendas aparecerão aqui.
        </p>
      </div>

      <div className="border-t-2 border-orange-400 pt-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Vendas - Amazon</h2>
        <div className="bg-white rounded-lg border p-8 text-center">
          <p className="text-gray-400">As vendas da Amazon aparecerão aqui apos a integracao.</p>
        </div>
      </div>
    </div>
  );
}
