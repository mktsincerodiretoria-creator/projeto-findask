"use client";

import { useState } from "react";

interface DateFilterProps {
  onFilter: (from: string, to: string) => void;
}

const presets = [
  { label: "Hoje", days: 0 },
  { label: "7 dias", days: 7 },
  { label: "15 dias", days: 15 },
  { label: "30 dias", days: 30 },
  { label: "60 dias", days: 60 },
  { label: "90 dias", days: 90 },
];

export default function DateFilter({ onFilter }: DateFilterProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activePreset, setActivePreset] = useState<number | null>(30);

  function applyPreset(days: number) {
    const now = new Date();
    const start = new Date();
    if (days === 0) {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(now.getDate() - days);
    }

    const fromStr = start.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];

    setFrom(fromStr);
    setTo(toStr);
    setActivePreset(days);
    onFilter(fromStr, toStr);
  }

  function applyCustom() {
    if (from && to) {
      setActivePreset(null);
      onFilter(from, to);
    }
  }

  return (
    <div className="bg-white rounded-lg border p-3 flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.days}
          onClick={() => applyPreset(p.days)}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            activePreset === p.days
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {p.label}
        </button>
      ))}

      <span className="text-gray-300 mx-1">|</span>

      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="border rounded px-2 py-1 text-sm"
      />
      <span className="text-gray-400 text-sm">ate</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="border rounded px-2 py-1 text-sm"
      />
      <button
        onClick={applyCustom}
        className="px-3 py-1 rounded text-sm bg-gray-800 text-white hover:bg-gray-700"
      >
        Filtrar
      </button>
    </div>
  );
}
