"use client";

import { useState } from "react";

interface SyncButtonProps {
  accountId?: string;
  onSyncComplete?: () => void;
}

export default function SyncButton({ accountId, onSyncComplete }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setStatus("Sincronizando...");

    try {
      const response = await fetch("/api/sync/mercadolivre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });

      const data = await response.json();

      if (response.ok) {
        const totalSynced = data.results?.reduce(
          (sum: number, r: { recordsSynced?: number }) => sum + (r.recordsSynced || 0),
          0
        );
        setStatus(`Sincronizado! ${totalSynced} registros atualizados.`);
        onSyncComplete?.();
      } else {
        setStatus(`Erro: ${data.error || "Falha na sincronizacao"}`);
      }
    } catch (error) {
      setStatus(`Erro de conexao: ${error instanceof Error ? error.message : "desconhecido"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setStatus(null), 5000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={syncing}
        className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
          syncing
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-green-600 hover:bg-green-700"
        }`}
      >
        {syncing ? "Sincronizando..." : "Sincronizar Vendas"}
      </button>

      {status && (
        <span
          className={`text-sm ${
            status.startsWith("Erro") ? "text-red-500" : "text-green-600"
          }`}
        >
          {status}
        </span>
      )}
    </div>
  );
}
