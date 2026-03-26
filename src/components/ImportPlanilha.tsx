"use client";

import { useState, useRef } from "react";

interface ImportResult {
  success: boolean;
  platform: string;
  imported: number;
  updated: number;
  skipped: number;
  total: number;
  columnsDetected: Record<string, boolean>;
  error?: string;
}

interface ImportPlanilhaProps {
  platform?: string;
  onImportComplete?: () => void;
}

export default function ImportPlanilha({ platform, onImportComplete }: ImportPlanilhaProps) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setResult(null);
    setError("");

    try {
      const csvText = await file.text();

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, platform }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResult(data);
        onImportComplete?.();
      } else {
        setError(data.error || "Erro ao importar");
      }
    } catch (err) {
      setError("Erro de conexao: " + String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="font-semibold text-gray-700 mb-2">Importar Planilha da Plataforma</h3>
      <p className="text-sm text-gray-500 mb-3">
        Exporte o CSV/Excel do Mercado Turbo, Shopee, ou da propria plataforma e envie aqui.
        O sistema detecta automaticamente as colunas (SKU, Faturamento, Custo, Imposto, Tarifa, Frete, etc).
      </p>

      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.tsv"
          onChange={handleUpload}
          disabled={uploading}
          className="text-sm"
        />
        {uploading && (
          <span className="text-sm text-blue-600 flex items-center gap-2">
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            Importando...
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-green-700 font-semibold">
            Importado com sucesso! ({result.platform})
          </p>
          <div className="text-sm text-green-600 mt-1 space-y-0.5">
            <p>{result.imported} novos pedidos importados</p>
            <p>{result.updated} pedidos atualizados</p>
            {result.skipped > 0 && <p>{result.skipped} linhas ignoradas</p>}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Colunas detectadas:{" "}
            {Object.entries(result.columnsDetected)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
