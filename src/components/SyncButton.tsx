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

          // Verificar se a resposta e JSON antes de fazer parse
          const contentType = response.headers.get("content-type") || "";
              let data: { results?: SyncResult[]; error?: string } = {};

          if (contentType.includes("application/json")) {
                    try {
                                data = await response.json();
                    } catch {
                                const rawText = await response.text().catch(() => "");
                                setIsError(true);
                                setStatus(`Erro ao processar resposta do servidor. Status: ${response.status}`);
                                console.error("Resposta invalida (nao e JSON):", rawText.substring(0, 200));
                                return;
                    }
          } else {
                    // Servidor retornou algo que nao e JSON (ex: timeout do Vercel, erro HTML)
                const rawText = await response.text().catch(() => "");
                    if (response.status === 504 || rawText.toLowerCase().includes("timeout") || rawText.toLowerCase().includes("function")) {
                                setIsError(true);
                                setStatus("Timeout: a sincronizacao demorou demais. Tente sincronizar por periodos menores ou aguarde e tente novamente.");
                    } else {
                                setIsError(true);
                                setStatus(`Erro do servidor (${response.status}). Verifique as configuracoes da conta Mercado Livre.`);
                    }
                    console.error("Resposta nao-JSON do servidor:", rawText.substring(0, 200));
                    return;
          }

          if (response.ok && data.results) {
                    const results: SyncResult[] = data.results;
                    const failed = results.filter((r) => r.status === "failed");
                    const totalSynced = results.reduce(
                                (sum, r) => sum + (r.recordsSynced || 0),
                                0
                              );

                if (failed.length > 0) {
                            setIsError(true);
                            setStatus(`Erro na sincronizacao: ${failed.map((f) => f.error).join(", ")}`);
                } else if (results.length === 0) {
                            setIsError(true);
                            setStatus("Nenhuma conta Mercado Livre ativa encontrada. Configure em Contas.");
                } else {
                            setIsError(false);
                            setStatus(`Sincronizado! ${totalSynced} registros atualizados.`);
                }
                    onSyncComplete?.();
          } else {
                    setIsError(true);
                    setStatus(`Erro: ${data.error || "Resposta inesperada do servidor."}`);
          }
      } catch (error) {
              setIsError(true);
              if (error instanceof TypeError && error.message.includes("fetch")) {
                        setStatus("Erro de conexao: sem internet ou servidor indisponivel.");
              } else {
                        setStatus(`Erro: ${error instanceof Error ? error.message : "desconhecido"}`);
              }
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
