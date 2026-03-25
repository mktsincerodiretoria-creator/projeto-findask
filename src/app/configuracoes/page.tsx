"use client";

import { useState, useEffect } from "react";

export default function ConfiguracoesPage() {
  const [taxRate, setTaxRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.tax_rate) setTaxRate(data.tax_rate);
      });
  }, []);

  async function saveTaxRate() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tax_rate: taxRate }),
      });
      if (res.ok) {
        setMessage("Imposto salvo com sucesso!");
      } else {
        setMessage("Erro ao salvar");
      }
    } catch {
      setMessage("Erro de conexao");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 3000);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Configuracoes</h1>

      {/* Imposto - Simples Nacional */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-1">Imposto (Simples Nacional)</h2>
        <p className="text-sm text-gray-500 mb-4">
          Informe o percentual de imposto que voce paga. Esse valor sera aplicado sobre o faturamento de cada venda.
        </p>

        <div className="flex items-center gap-3">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              placeholder="Ex: 6.00"
              className="px-4 py-2 w-32 text-lg outline-none"
            />
            <span className="bg-gray-100 px-3 py-2 text-gray-600 font-medium">%</span>
          </div>

          <button
            onClick={saveTaxRate}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>

          {message && (
            <span className={`text-sm ${message.includes("sucesso") ? "text-green-600" : "text-red-500"}`}>
              {message}
            </span>
          )}
        </div>

        <div className="mt-4 bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
          <strong>Exemplo:</strong> Se voce paga 6% de Simples Nacional, uma venda de R$ 100,00 tera R$ 6,00 descontado como imposto.
        </div>
      </div>
    </div>
  );
}
