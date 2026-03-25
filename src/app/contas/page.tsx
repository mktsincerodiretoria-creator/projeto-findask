"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SyncButton from "@/components/SyncButton";

interface AccountData {
  id: string;
  platform: string;
  platformId: string;
  nickname: string | null;
  email: string | null;
  isActive: boolean;
  tokenStatus: string;
  createdAt: string;
  ordersCount: number;
  productsCount: number;
  lastSync: {
    status: string;
    recordsSync: number;
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

const platformLabels: Record<string, { name: string; icon: string; color: string }> = {
  MERCADO_LIVRE: { name: "Mercado Livre", icon: "🟡", color: "bg-yellow-100 border-yellow-300" },
  SHOPEE: { name: "Shopee", icon: "🧡", color: "bg-orange-100 border-orange-300" },
  TIKTOK_SHOP: { name: "TikTok Shop", icon: "🎵", color: "bg-gray-100 border-gray-300" },
  AMAZON: { name: "Amazon", icon: "📦", color: "bg-orange-100 border-orange-300" },
};

function StatusMessages() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const mlConnected = searchParams.get("ml_connected");

  return (
    <>
      {error && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <p className="text-red-800 font-semibold">Erro ao conectar:</p>
          <p className="text-red-600 text-sm mt-1">{decodeURIComponent(error)}</p>
        </div>
      )}
      {mlConnected && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4">
          <p className="text-green-800 font-semibold">Mercado Livre conectado com sucesso!</p>
          <p className="text-green-600 text-sm mt-1">Agora clique em &quot;Sincronizar Vendas&quot; para importar seus dados.</p>
        </div>
      )}
    </>
  );
}

export default function ContasPage() {
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchAccounts() {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching accounts:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Contas Conectadas</h1>
      </div>

      <Suspense fallback={null}>
        <StatusMessages />
      </Suspense>

      {/* Botao para conectar ML */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-3">Conectar Marketplace</h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/auth/mercadolivre"
            className="inline-flex items-center gap-2 px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-lg transition-colors"
          >
            🟡 Conectar Mercado Livre
          </a>
          <button
            disabled
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-400 font-semibold rounded-lg cursor-not-allowed"
          >
            🧡 Shopee (em breve)
          </button>
          <button
            disabled
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-400 font-semibold rounded-lg cursor-not-allowed"
          >
            🎵 TikTok Shop (em breve)
          </button>
        </div>
      </div>

      {/* Lista de contas */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <span className="ml-3 text-gray-500">Carregando contas...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <p className="text-gray-500 text-lg mb-2">Nenhuma conta conectada</p>
          <p className="text-gray-400 text-sm">
            Clique em &quot;Conectar Mercado Livre&quot; acima para comecar.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {accounts.map((account) => {
            const p = platformLabels[account.platform] || {
              name: account.platform,
              icon: "📱",
              color: "bg-gray-100 border-gray-300",
            };

            return (
              <div
                key={account.id}
                className={`rounded-lg border-2 p-5 ${p.color}`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{p.icon}</span>
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          account.tokenStatus === "valid"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {account.tokenStatus === "valid" ? "Conectado" : "Token Expirado"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {account.nickname || account.email || account.platformId}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm text-gray-500">
                      <span>{account.ordersCount} pedidos</span>
                      <span>{account.productsCount} produtos</span>
                      {account.lastSync && (
                        <span>
                          Ultimo sync:{" "}
                          {new Date(account.lastSync.startedAt).toLocaleString("pt-BR")} -{" "}
                          {account.lastSync.status}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <SyncButton
                      accountId={account.id}
                      onSyncComplete={fetchAccounts}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
