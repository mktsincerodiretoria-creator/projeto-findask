"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface DailyData {
  date: string;
  platform: string;
  revenue: number;
  platformFee: number;
  shippingCost: number;
  tax: number;
  margin: number;
}

interface RevenueChartProps {
  data: DailyData[];
}

export default function RevenueChart({ data }: RevenueChartProps) {
  // Agrupa por data para exibir no grafico
  const chartData = data.reduce(
    (acc, item) => {
      const dateKey = new Date(item.date).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      });

      if (!acc[dateKey]) {
        acc[dateKey] = {
          date: dateKey,
          Custo: 0,
          Imposto: 0,
          Tarifa: 0,
          Frete: 0,
          Margem: 0,
        };
      }

      acc[dateKey].Custo = (acc[dateKey].Custo as number) + (item.revenue - item.margin);
      acc[dateKey].Imposto = (acc[dateKey].Imposto as number) + item.tax;
      acc[dateKey].Tarifa = (acc[dateKey].Tarifa as number) + item.platformFee;
      acc[dateKey].Frete = (acc[dateKey].Frete as number) + item.shippingCost;
      acc[dateKey].Margem = (acc[dateKey].Margem as number) + item.margin;

      return acc;
    },
    {} as Record<string, Record<string, string | number>>
  );

  const chartArray = Object.values(chartData);

  if (chartArray.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-6 flex items-center justify-center h-64">
        <p className="text-gray-400">Sem dados para exibir</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">
        COMPARATIVO POR PLATAFORMA
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartArray}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip
            formatter={(value) =>
              new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(Number(value))
            }
          />
          <Legend />
          <Bar dataKey="Custo" stackId="a" fill="#ef4444" />
          <Bar dataKey="Imposto" stackId="a" fill="#f97316" />
          <Bar dataKey="Tarifa" stackId="a" fill="#eab308" />
          <Bar dataKey="Frete" stackId="a" fill="#3b82f6" />
          <Bar dataKey="Margem" stackId="a" fill="#22c55e" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
