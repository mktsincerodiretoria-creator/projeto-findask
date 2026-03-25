"use client";

import { formatCurrency, formatPercent } from "@/lib/utils";

interface PlatformData {
  revenue: number;
  cost: number;
  tax: number;
  platformFee: number;
  shippingCost: number;
  discount: number;
  margin: number;
  totalOrders: number;
}

interface PlatformSummaryProps {
  platform: string;
  data: PlatformData;
  color: string;
  icon: string;
}

export default function PlatformSummary({ platform, data, color, icon }: PlatformSummaryProps) {
  const marginPercent = data.revenue > 0 ? (data.margin / data.revenue) * 100 : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icon}</span>
        <h3 className="font-semibold text-gray-800">{platform}</h3>
        <span className={`ml-auto text-lg font-bold ${color}`}>
          {formatCurrency(data.revenue)}
        </span>
      </div>

      <div className="text-xs text-gray-500 mb-1">
        Margem: {formatCurrency(data.margin)} ({formatPercent(marginPercent)})
      </div>
      <div className="text-xs text-gray-500">
        {data.totalOrders} vendas aprovadas
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Faturamento</span>
          <span className="font-medium">{formatCurrency(data.revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">(-) Custo</span>
          <span>{formatCurrency(data.cost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">(-) Imposto</span>
          <span>{formatCurrency(data.tax)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">(-) Tarifa</span>
          <span>{formatCurrency(data.platformFee)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">(-) Frete Vendedor</span>
          <span>{formatCurrency(data.shippingCost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">(-) Cupom/Desconto</span>
          <span>{formatCurrency(data.discount)}</span>
        </div>
        <div className="flex justify-between border-t pt-1 mt-1">
          <span className="font-semibold text-gray-700">Margem</span>
          <span className="font-semibold">{formatCurrency(data.margin)}</span>
        </div>
      </div>
    </div>
  );
}
