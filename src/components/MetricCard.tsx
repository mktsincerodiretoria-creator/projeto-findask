"use client";

import { formatCurrency, formatPercent } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: number;
  subtitle?: string;
  type?: "currency" | "percent" | "number";
  color?: string;
  icon?: string;
}

export default function MetricCard({
  title,
  value,
  subtitle,
  type = "currency",
  color = "text-gray-900",
  icon,
}: MetricCardProps) {
  const formatted =
    type === "currency"
      ? formatCurrency(value)
      : type === "percent"
      ? formatPercent(value)
      : value.toLocaleString("pt-BR");

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-lg">{icon}</span>}
        <h3 className="text-sm font-medium text-gray-500 uppercase">{title}</h3>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{formatted}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}
