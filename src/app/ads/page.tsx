"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import DateFilter from "@/components/DateFilter";

interface AdTotals {
  impressions: number; clicks: number; spend: number; revenue: number;
  orders: number; cpc: number; ctr: number; acos: number; roas: number;
  tacos: number; totalFaturamento: number;
}

interface CampaignData {
  campaignName: string; platform: string; campaignId: string;
  spend: number; revenue: number; clicks: number; impressions: number; orders: number;
}

interface SkuData {
  sku: string; spend: number; revenue: number; clicks: number; orders: number;
}

export default function AdsPage() {
  const [totals, setTotals] = useState<AdTotals | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [skuData, setSkuData] = useState<SkuData[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchAds = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/ads?${params.toString()}`);
      const data = await res.json();
      setTotals(data.totals || null);
      setCampaigns(data.byCampaign || []);
      setSkuData(data.bySku || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    fetchAds(from.toISOString().split("T")[0], now.toISOString().split("T")[0]);
  }, [fetchAds]);

  async function importAdsCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMsg("");
    try {
      let csvText: string;
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const XLSX = (await import("xlsx")).default;
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(firstSheet, { FS: "\t" });
      } else {
        csvText = await file.text();
      }
      const res = await fetch("/api/ads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, platform: "MERCADO_LIVRE" }),
      });
      const data = await res.json();
      if (data.success) {
        setImportMsg(`Importado! ${data.imported} campanhas/anuncios importados`);
        fetchAds();
      } else {
        setImportMsg(`Erro: ${data.error}`);
      }
    } catch (err) { setImportMsg(`Erro: ${err}`); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const t = totals || { impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0, cpc: 0, ctr: 0, acos: 0, roas: 0, tacos: 0, totalFaturamento: 0 };
  const marginContrib = t.totalFaturamento - t.spend;
  const marginPct = t.totalFaturamento > 0 ? (marginContrib / t.totalFaturamento) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Anuncios Patrocinados (ADS)</h1>
          <p className="text-sm text-gray-500">Metricas de publicidade ML, Shopee, TikTok</p>
        </div>
      </div>

      {/* Importar CSV de ADS */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-gray-700 mb-2">Importar Relatorio de ADS</h3>
        <p className="text-sm text-gray-500 mb-3">
          Exporte o relatorio de Product Ads do Mercado Livre (CSV ou XLSX) e envie aqui.
          O sistema detecta campanhas, impressoes, cliques, investimento, receita e vendas automaticamente.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" onChange={importAdsCSV} disabled={importing} className="text-sm" />
          {importing && <span className="text-sm text-blue-600">Importando...</span>}
          {importMsg && <span className={`text-sm ${importMsg.includes("Erro") ? "text-red-500" : "text-green-600"}`}>{importMsg}</span>}
        </div>
      </div>

      <DateFilter onFilter={(from, to) => fetchAds(from, to)} />

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <>
          {/* Cards gerais */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-500 uppercase">Faturamento Bruto</p>
              <p className="text-xl font-bold">{formatCurrency(t.totalFaturamento)}</p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-500 uppercase">Investimento Total</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(t.spend)}</p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-500 uppercase">Ticket Medio</p>
              <p className="text-xl font-bold">{formatCurrency(t.orders > 0 ? t.revenue / t.orders : 0)}</p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-500 uppercase">Margem Contribuicao</p>
              <p className={`text-xl font-bold ${marginContrib >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(marginContrib)}</p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-500 uppercase">Margem %</p>
              <p className={`text-xl font-bold ${marginPct >= 0 ? "text-green-600" : "text-red-600"}`}>{formatPercent(marginPct)}</p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-500 uppercase">ROAS</p>
              <p className="text-xl font-bold text-blue-600">{t.roas.toFixed(2)}x</p>
            </div>
          </div>

          {/* Anuncios Patrocinados */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-1 h-5 bg-blue-600 rounded"></span>
              Anuncios Patrocinados
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">Investimento</p>
                <p className="text-lg font-bold">{formatCurrency(t.spend)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">Receita</p>
                <p className="text-lg font-bold">{formatCurrency(t.revenue)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">Custo por Clique</p>
                <p className="text-lg font-bold">{formatCurrency(t.cpc)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">Vendas</p>
                <p className="text-lg font-bold">{t.orders}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">ACOS</p>
                <p className={`text-lg font-bold ${t.acos <= 15 ? "text-green-600" : t.acos <= 30 ? "text-yellow-600" : "text-red-600"}`}>
                  {formatPercent(t.acos)}
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">TACOS</p>
                <p className={`text-lg font-bold ${t.tacos <= 10 ? "text-green-600" : t.tacos <= 20 ? "text-yellow-600" : "text-red-600"}`}>
                  {formatPercent(t.tacos)}
                </p>
              </div>
            </div>
          </div>

          {/* Campanhas */}
          {campaigns.length > 0 && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-gray-800">Desempenho por Campanha</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Campanha</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Plataforma</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Investimento</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Receita</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Cliques</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Vendas</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">CPC</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">ACOS</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c, i) => {
                      const campCpc = c.clicks > 0 ? c.spend / c.clicks : 0;
                      const campAcos = c.revenue > 0 ? (c.spend / c.revenue) * 100 : 0;
                      const campRoas = c.spend > 0 ? c.revenue / c.spend : 0;
                      return (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{c.campaignName}</td>
                          <td className="px-4 py-2 text-gray-500">{c.platform}</td>
                          <td className="px-4 py-2 text-right text-red-600">{formatCurrency(c.spend)}</td>
                          <td className="px-4 py-2 text-right text-green-600">{formatCurrency(c.revenue)}</td>
                          <td className="px-4 py-2 text-right">{c.clicks}</td>
                          <td className="px-4 py-2 text-right">{c.orders}</td>
                          <td className="px-4 py-2 text-right">{formatCurrency(campCpc)}</td>
                          <td className={`px-4 py-2 text-right ${campAcos <= 15 ? "text-green-600" : "text-red-600"}`}>{formatPercent(campAcos)}</td>
                          <td className="px-4 py-2 text-right text-blue-600">{campRoas.toFixed(2)}x</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Por SKU */}
          {skuData.length > 0 && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-gray-800">Desempenho por Produto (SKU)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">SKU</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Investimento</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Receita</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Cliques</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Vendas</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">CPC</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">ACOS</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Lucro Ads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuData.map((s, i) => {
                      const skuCpc = s.clicks > 0 ? s.spend / s.clicks : 0;
                      const skuAcos = s.revenue > 0 ? (s.spend / s.revenue) * 100 : 0;
                      const lucro = s.revenue - s.spend;
                      return (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono">{s.sku}</td>
                          <td className="px-4 py-2 text-right text-red-600">{formatCurrency(s.spend)}</td>
                          <td className="px-4 py-2 text-right text-green-600">{formatCurrency(s.revenue)}</td>
                          <td className="px-4 py-2 text-right">{s.clicks}</td>
                          <td className="px-4 py-2 text-right">{s.orders}</td>
                          <td className="px-4 py-2 text-right">{formatCurrency(skuCpc)}</td>
                          <td className={`px-4 py-2 text-right ${skuAcos <= 15 ? "text-green-600" : "text-red-600"}`}>{formatPercent(skuAcos)}</td>
                          <td className={`px-4 py-2 text-right font-medium ${lucro >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(lucro)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Info quando nao tem dados */}
          {campaigns.length === 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
              <p className="text-blue-800 font-semibold mb-2">Sem dados de ADS</p>
              <p className="text-blue-600 text-sm">
                Importe o relatorio de Product Ads acima (CSV ou XLSX exportado do Mercado Livre).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
