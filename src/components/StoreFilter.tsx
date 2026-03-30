"use client";

import { useState, useEffect } from "react";

interface AccountOption {
  id: string;
  nickname: string | null;
  platformId: string;
}

interface StoreFilterProps {
  platform: string;
  onFilterChange: (accountId: string | null) => void;
}

export default function StoreFilter({ platform, onFilterChange }: StoreFilterProps) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selected, setSelected] = useState<string>("all");

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const filtered = data.filter((a: { platform: string }) => a.platform === platform);
          setAccounts(filtered);
        }
      });
  }, [platform]);

  function handleChange(value: string) {
    setSelected(value);
    onFilterChange(value === "all" ? null : value);
  }

  if (accounts.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700">Loja:</label>
      <select
        value={selected}
        onChange={(e) => handleChange(e.target.value)}
        className="border rounded-lg px-3 py-1.5 text-sm bg-white font-medium text-gray-900"
      >
        <option value="all">Todas as lojas ({accounts.length})</option>
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id}>
            {acc.nickname || acc.platformId}
          </option>
        ))}
      </select>
    </div>
  );
}
