"use client";
import { useState } from "react";

interface SyncResult {
  accountId: string;
  nickname?: string;
  status: string;
  recordsSynced?: number;
  error?: string;
  partial?: boolean;
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
    setStatus("Sincronizando vendas...");
    setIsError(false);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 65000);

      const response = await fetch("/api/sync/mercadolivre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Verifica se a resposta e JSON
      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        const rawText = await response.text().catch(() => "");
        if (response.status === 504 || rawText.toLowerCase().includes("timeout")) {
          setIsError(true);
          setStatus("Timeout do servidor. Dados parciais foram salvos. Clique novamente para continuar.");
        } else {
          setIsError(true);
          setStatus(`Erro do servidor (${response.status}). Tente novamente.`);
        }
        return;
      }

      let data: { results?: SyncResult[]; error?: string };
      try {
        data = await response.json();
      } catch {
        setIsError(true);
        setStatus("Erro ao processar resposta do servidor.");
        return;
      }

      if (response.ok && data.results) {
        const results = data.results;
        const failed = results.filter((r) => r.status === "failed");
        const totalSynced = results.reduce((sum, r) => sum + (r.recordsSynced || 0), 0);

        if (failed.length > 0 && failed.length === results.length) {
          setIsError(true);
          setStatus(`Erro: ${failed.map((f) => f.error).join(", ")}`);
        } else if (results.length === 0) {
          setIsError(true);
          setStatus("Nenhuma conta ML ativa. Configure em Contas.");
        } else {
          const hasPartial = results.some((r) => r.partial);
          setIsError(false);
          const msg = `Sincronizado! ${totalSynced} registros.`;
          const partialMsg = hasPartial ? " Clique novamente para continuar sincronizando." : "";
          setStatus(failed.length > 0 ? `${msg} (${failed.length} conta(s) com erro)${partialMsg}` : `${msg}${partialMsg}`);
        }
        onSyncComplete?.();
      } else {
        setIsError(true);
        setStatus(`Erro: ${data.error || "Resposta inesperada."}`);
      }
    } catch (error) {
      setIsError(true);
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Timeout. Dados parciais salvos. Clique novamente para continuar.");
        onSyncComplete?.();
      } else if (error instanceof TypeError && error.message.includes("fetch")) {
        setStatus("Sem conexao com o servidor.");
      } else {
        setStatus(`Erro: ${error instanceof Error ? error.message : "desconhecido"}`);
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setStatus(null), 12000);
    }
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      <button
        onClick={handleSync}
        disabled={syncing}
        className={`px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all ${
          syncing
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-green-600 hover:bg-green-700 active:scale-95"
        }`}
      >
        {syncing ? (
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Sincronizando...
          </span>
        ) : (
          "Sincronizar Vendas"
        )}
      </button>
      {status && (
        <span
          className={`text-sm max-w-sm text-right ${
            isError ? "text-red-500" : "text-green-600"
          }`}
        >
          {status}
        </span>
      )}
    </div>
  );
}
