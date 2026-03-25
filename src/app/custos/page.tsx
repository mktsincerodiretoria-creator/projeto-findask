"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { formatCurrency } from "@/lib/utils";

interface ProductCostData {
  id: string;
  sku: string;
  title: string | null;
  cost: number;
}

type SortKey = "sku" | "title" | "cost";
type SortDir = "asc" | "desc";

function SortHeader({ label, field, sortKey, sortDir, onSort, align = "left" }: {
  label: string; field: SortKey; sortKey: SortKey; sortDir: SortDir;
  onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sortKey === field;
  const arrow = active ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : " \u25B4\u25BE";
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} px-4 py-2 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100`}
      onClick={() => onSort(field)}
    >
      {label}<span className={`text-xs ml-0.5 ${active ? "text-blue-600" : "text-gray-400"}`}>{arrow}</span>
    </th>
  );
}

export default function CustosPage() {
  const [costs, setCosts] = useState<ProductCostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSku, setNewSku] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newCost, setNewCost] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function fetchCosts() {
    try {
      const res = await fetch("/api/product-costs");
      const data = await res.json();
      setCosts(Array.isArray(data) ? data : []);
    } catch {
      console.error("Error fetching costs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchCosts(); }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = useMemo(() => {
    return [...costs].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [costs, sortKey, sortDir]);

  function toggleSelect(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((c) => c.sku)));
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Excluir ${selected.size} item(ns)?`)) return;
    setDeleting(true);
    try {
      for (const sku of Array.from(selected)) {
        await fetch("/api/product-costs", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku }),
        });
      }
      setSelected(new Set());
      setMessage(`${selected.size} item(ns) excluido(s)`);
      fetchCosts();
    } catch {
      setMessage("Erro ao excluir");
    } finally {
      setDeleting(false);
      setTimeout(() => setMessage(""), 3000);
    }
  }

  async function addCost() {
    if (!newSku || !newCost) { setMessage("SKU e custo sao obrigatorios"); return; }
    try {
      const res = await fetch("/api/product-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: newSku, title: newTitle || null, cost: parseFloat(newCost) }),
      });
      if (res.ok) { setNewSku(""); setNewTitle(""); setNewCost(""); setMessage("Custo salvo!"); fetchCosts(); }
      else setMessage("Erro ao salvar");
    } catch { setMessage("Erro de conexao"); }
    setTimeout(() => setMessage(""), 3000);
  }

  async function deleteCost(sku: string) {
    try {
      await fetch("/api/product-costs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku }) });
      fetchCosts();
    } catch { console.error("Error deleting cost"); }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("Processando planilha...");
    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());
      const items: { sku: string; title?: string; cost: number }[] = [];
      const separator = lines[0]?.includes(";") ? ";" : ",";
      const startIndex = lines[0]?.toLowerCase().includes("sku") ? 1 : 0;
      const parseMoney = (val: string) => parseFloat(val.replace(/R\$\s*/gi, "").replace(/\./g, "").replace(",", ".").trim());

      for (let i = startIndex; i < lines.length; i++) {
        const cols = lines[i].split(separator).map((c) => c.trim().replace(/"/g, ""));
        if (cols.length >= 2) {
          const sku = cols[0];
          let cost: number; let title: string | undefined;
          if (cols.length >= 3) { title = cols[1] || undefined; cost = parseMoney(cols[2] || "0"); }
          else { cost = parseMoney(cols[1] || "0"); }
          if (sku && !isNaN(cost) && cost > 0) items.push({ sku, title, cost });
        }
      }
      if (items.length === 0) { setMessage("Nenhum item valido encontrado"); setUploading(false); return; }
      const res = await fetch("/api/product-costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) });
      const result = await res.json();
      setMessage(`Importado! ${result.created || 0} novos, ${result.updated || 0} atualizados`);
      fetchCosts();
    } catch { setMessage("Erro ao processar planilha"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; setTimeout(() => setMessage(""), 5000); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Custo dos Produtos (por SKU)</h1>

      {/* Upload CSV */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-2">Importar Planilha</h2>
        <p className="text-sm text-gray-500 mb-3">CSV com colunas: <strong>SKU, Titulo (opcional), Custo</strong> — Aceita formato R$ XX,XX</p>
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={handleCsvUpload} disabled={uploading} className="text-sm" />
          {uploading && <span className="text-sm text-blue-600">Processando...</span>}
        </div>
      </div>

      {/* Adicionar manual */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-3">Adicionar Custo Manual</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">SKU *</label>
            <input type="text" value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="Ex: MB321" className="border rounded px-3 py-2 w-40" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Titulo</label>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Nome do produto" className="border rounded px-3 py-2 w-64" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Custo (R$) *</label>
            <input type="number" step="0.01" value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="0.00" className="border rounded px-3 py-2 w-32" />
          </div>
          <button onClick={addCost} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">Adicionar</button>
        </div>
        {message && (
          <p className={`mt-2 text-sm ${message.includes("Erro") || message.includes("obrigatorio") ? "text-red-500" : "text-green-600"}`}>{message}</p>
        )}
      </div>

      {/* Tabela com ordenacao e selecao em lote */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Custos Cadastrados ({costs.length})</h2>
          {selected.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:bg-gray-400"
            >
              {deleting ? "Excluindo..." : `Excluir ${selected.size} selecionado(s)`}
            </button>
          )}
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Carregando...</div>
        ) : costs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nenhum custo cadastrado.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <SortHeader label="SKU" field="sku" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Titulo" field="title" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Custo" field="cost" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <th className="text-center px-4 py-2 font-medium text-gray-600">Acao</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className={`border-t hover:bg-gray-50 ${selected.has(c.sku) ? "bg-blue-50" : ""}`}>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.sku)}
                      onChange={() => toggleSelect(c.sku)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono">{c.sku}</td>
                  <td className="px-4 py-2 text-gray-600">{c.title || "-"}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.cost)}</td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => deleteCost(c.sku)} className="text-red-500 hover:text-red-700 text-xs">Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
