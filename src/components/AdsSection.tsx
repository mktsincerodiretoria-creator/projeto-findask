"use client";

import { useState, useRef } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface AdsTotals {
  spend: number; revenue: number; clicks: number; impressions: number;
  orders: number; cpc: number; acos: number; tacos: number; roas: number;
}

interface CampaignData {
  campaignName: string; spend: number; revenue: number; clicks: number;
  impressions: number; orders: number;
}

interface AdsSectionProps {
  platform: string;
  platformLabel: string;
  borderColor: string;
  totals: AdsTotals;
  campaigns: CampaignData[];
  onImportComplete: () => void;
}

export default function AdsSection({ platform, platformLabel, borderColor, totals, campaigns, onImportComplete }: AdsSectionProps) {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setImporting(true); setMsg("");
    try {
      let csvText: string;
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const XLSX = (await import("xlsx")).default;
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        csvText = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t" });
      } else { csvText = await file.text(); }
      const res = await fetch("/api/ads/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText, platform }) });
      const data = await res.json();
      if (data.success) { setMsg(`${data.imported} campanhas importadas`); onImportComplete(); }
      else setMsg(`Erro: ${data.error}`);
    } catch (err) { setMsg(`Erro: ${err}`); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; setTimeout(() => setMsg(""), 8000); }
  }

  return (
    <div className={`border-t-2 ${borderColor} pt-6`}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900">Anuncios Patrocinados - {platformLabel}</h2>
        <div className="flex items-center gap-3">
          <label className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 cursor-pointer">
            Importar CSV ADS
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" className="hidden" disabled={importing} onChange={handleImport} />
          </label>
          {importing && <span className="text-sm text-blue-600">Importando...</span>}
          {msg && <span className={`text-sm ${msg.includes("Erro") ? "text-red-500" : "text-green-600"}`}>{msg}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">Investimento</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totals.spend)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">Receita Ads</p>
          <p className="text-lg font-bold text-green-600">{formatCurrency(totals.revenue)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">Custo por Clique</p>
          <p className="text-lg font-bold">{formatCurrency(totals.cpc)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">Vendas Ads</p>
          <p className="text-lg font-bold">{totals.orders}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">ACOS</p>
          <p className={`text-lg font-bold ${totals.acos <= 15 ? "text-green-600" : totals.acos <= 30 ? "text-yellow-600" : "text-red-600"}`}>{formatPercent(totals.acos)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <p className="text-xs text-gray-500">TACOS</p>
          <p className={`text-lg font-bold ${totals.tacos <= 10 ? "text-green-600" : totals.tacos <= 20 ? "text-yellow-600" : "text-red-600"}`}>{formatPercent(totals.tacos)}</p>
        </div>
      </div>

      {campaigns.length > 0 && (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Campanha</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Investimento</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Receita</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Cliques</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Vendas</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">CPC</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">ACOS</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => {
                const cCpc = c.clicks > 0 ? c.spend / c.clicks : 0;
                const cAcos = c.revenue > 0 ? (c.spend / c.revenue) * 100 : 0;
                const cRoas = c.spend > 0 ? c.revenue / c.spend : 0;
                return (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium max-w-[250px] truncate">{c.campaignName}</td>
                    <td className="px-3 py-2 text-right text-red-600">{formatCurrency(c.spend)}</td>
                    <td className="px-3 py-2 text-right text-green-600">{formatCurrency(c.revenue)}</td>
                    <td className="px-3 py-2 text-right">{c.clicks}</td>
                    <td className="px-3 py-2 text-right">{c.orders}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(cCpc)}</td>
                    <td className={`px-3 py-2 text-right ${cAcos <= 15 ? "text-green-600" : "text-red-600"}`}>{formatPercent(cAcos)}</td>
                    <td className="px-3 py-2 text-right text-blue-600">{cRoas.toFixed(2)}x</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
