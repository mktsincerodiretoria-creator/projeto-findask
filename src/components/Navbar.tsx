"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { name: "Dashboard", href: "/dashboard", color: "bg-blue-600" },
  { name: "Mercado Livre", href: "/dashboard/mercadolivre", color: "bg-yellow-500" },
  { name: "Shopee", href: "/dashboard/shopee", color: "bg-orange-500" },
  { name: "Amazon", href: "/dashboard/amazon", color: "bg-amber-600" },
  { name: "TikTok Shop", href: "/dashboard/tiktok", color: "bg-gray-800" },
  { name: "Estoque", href: "/estoque", color: "bg-teal-600" },
  { name: "Mensagens IA", href: "/mensagens", color: "bg-green-600" },
  { name: "Custos/SKU", href: "/custos", color: "bg-red-600" },
  { name: "Contas", href: "/contas", color: "bg-purple-600" },
  { name: "Config", href: "/configuracoes", color: "bg-gray-600" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="w-full px-4">
        <div className="flex items-center justify-between h-14">
          <Link href="/dashboard" className="font-bold text-xl">
            <span className="text-blue-400">Fin</span>
            <span className="text-green-400">Dash</span>
          </Link>

          {/* Desktop tabs */}
          <div className="hidden md:flex gap-1 overflow-x-auto ml-6">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "px-3 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors",
                  pathname === tab.href
                    ? `${tab.color} text-white`
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                )}
              >
                {tab.name}
              </Link>
            ))}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-gray-800"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-gray-900 border-t border-gray-800 px-4 pb-4">
          <div className="grid grid-cols-2 gap-2 pt-2">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "px-3 py-2.5 rounded-lg text-sm font-medium text-center transition-colors",
                  pathname === tab.href
                    ? `${tab.color} text-white`
                    : "text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700"
                )}
              >
                {tab.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
