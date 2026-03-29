"use client";

import { useState, useEffect, useCallback } from "react";
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
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

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

  async function syncAds() {
    setSyncing(true); setSyncMsg("");
    try {
      const res = await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "MERCADO_LIVRE" }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncMsg(`Erro: ${data.error}`);
      } else {
        setSyncMsg(`Sincronizado! ${data.totalSynced} metricas importadas`);
        fetchAds();
      }
    } catch (e) { setSyncMsg(`Erro: ${e}`); }
    finally { setSyncing(false); setTimeout(() => setSyncMsg(""), 10000); }
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
        <div className="flex gap-3 items-center">
          <button onClick={syncAds} disabled={syncing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400">
            {syncing ? "Sincronizando..." : "Sincronizar ADS ML"}
          </button>
          {syncMsg && <span className={`text-sm ${syncMsg.includes("Erro") ? "text-red-500" : "text-green-600"}`}>{syncMsg}</span>}
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
              <p className="text-blue-600 text-sm mb-4">
                Clique em &quot;Sincronizar ADS ML&quot; para importar os dados de anuncios do Mercado Livre.
                Para Shopee e TikTok Ads, a integracao sera adicionada em breve.
              </p>
              <p className="text-blue-500 text-xs">
                Nota: Precisa da permissao &quot;Publicidade de um produto&quot; ativada no app do ML.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
