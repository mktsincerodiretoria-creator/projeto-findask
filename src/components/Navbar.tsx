"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const menuGroups = [
  {
    label: "Visao Geral",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: "📊" },
    ],
  },
  {
    label: "Marketplaces",
    items: [
      { name: "Mercado Livre", href: "/dashboard/mercadolivre", icon: "🟡" },
      { name: "Shopee", href: "/dashboard/shopee", icon: "🧡" },
      { name: "Amazon", href: "/dashboard/amazon", icon: "📦" },
      { name: "TikTok Shop", href: "/dashboard/tiktok", icon: "🎵" },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { name: "Closer IA", href: "/mensagens", icon: "💬" },
      { name: "Gestao de Compras", href: "/estoque", icon: "🛒" },
      { name: "Custos / SKU", href: "/custos", icon: "💰" },
    ],
  },
  {
    label: "Configuracoes",
    items: [
      { name: "Contas", href: "/contas", icon: "🔗" },
      { name: "Config", href: "/configuracoes", icon: "⚙️" },
    ],
  },
];

export default function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-56 bg-gray-900 text-white z-50 overflow-y-auto">
        <div className="p-4 border-b border-gray-800">
          <Link href="/dashboard" className="font-bold text-xl block">
            <span className="text-blue-400">Fin</span>
            <span className="text-green-400">Dash</span>
          </Link>
          <p className="text-xs text-gray-500 mt-1">Dashboard Multi-Plataforma</p>
        </div>

        <nav className="flex-1 py-2">
          {menuGroups.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {group.label}
              </p>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors mx-2 rounded-lg",
                    pathname === item.href
                      ? "bg-blue-600 text-white font-medium"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  )}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.name}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <p className="text-xs text-gray-600">FinDash v1.0</p>
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <nav className="md:hidden bg-gray-900 text-white sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 h-14">
          <Link href="/dashboard" className="font-bold text-xl">
            <span className="text-blue-400">Fin</span>
            <span className="text-green-400">Dash</span>
          </Link>
          <button onClick={() => setMenuOpen(!menuOpen)} className="p-2 rounded-lg hover:bg-gray-800">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
        {menuOpen && (
          <div className="bg-gray-900 border-t border-gray-800 px-4 pb-4">
            {menuGroups.map((group) => (
              <div key={group.label} className="mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider py-1">{group.label}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        pathname === item.href
                          ? "bg-blue-600 text-white"
                          : "text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700"
                      )}
                    >
                      <span>{item.icon}</span>
                      {item.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>
    </>
  );
}
