"use client";

import { useState } from "react";

interface SyncResult {
  accountId: string;
  nickname?: string;
  status: string;
  recordsSynced?: number;
  error?: string;
}

interface SyncButtonProps {
  accountId?: string;
  onSyncComplete?: () => void;
}

export default function SyncButton({ accountId, onSyncComplete }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSync() {
    setSyncing(true);
    setStatus("Sincronizando...");
    setIsError(false);

    try {
      const response = await fetch("/api/sync/mercadolivre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });

      const data = await response.json();

      if (response.ok && data.results) {
        const results: SyncResult[] = data.results;
        const failed = results.filter((r) => r.status === "failed");
        const totalSynced = results.reduce(
          (sum, r) => sum + (r.recordsSynced || 0),
          0
        );

        if (failed.length > 0) {
          setIsError(true);
          setStatus(`Erro na sync: ${failed.map((f) => f.error).join(", ")}`);
        } else {
          setStatus(`Sincronizado! ${totalSynced} registros atualizados.`);
        }
        onSyncComplete?.();
      } else {
        setIsError(true);
        setStatus(`Erro: ${data.error || JSON.stringify(data)}`);
      }
    } catch (error) {
      setIsError(true);
      setStatus(`Erro de conexao: ${error instanceof Error ? error.message : "desconhecido"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setStatus(null), 15000);
    }
  }

  return (
    <div className="flex flex-col gap-2">
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
          className={`text-sm max-w-md break-words ${
            isError ? "text-red-500" : "text-green-600"
          }`}
        >
          {status}
        </span>
      )}
    </div>
  );
}
