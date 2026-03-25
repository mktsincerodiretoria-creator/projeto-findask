"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { name: "Dashboard", href: "/dashboard", color: "bg-blue-600" },
  { name: "Mercado Livre", href: "/dashboard/mercadolivre", color: "bg-yellow-500" },
  { name: "Shopee", href: "/dashboard/shopee", color: "bg-orange-500" },
  { name: "Amazon", href: "/dashboard/amazon", color: "bg-amber-600" },
  { name: "TikTok Shop", href: "/dashboard/tiktok", color: "bg-gray-800" },
  { name: "Custos/SKU", href: "/custos", color: "bg-red-600" },
  { name: "Contas", href: "/contas", color: "bg-purple-600" },
  { name: "Config", href: "/configuracoes", color: "bg-gray-600" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14">
          <Link href="/dashboard" className="font-bold text-xl mr-8">
            <span className="text-blue-400">Fin</span>
            <span className="text-green-400">Dash</span>
          </Link>

          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors",
                  pathname === tab.href
                    ? `${tab.color} text-white`
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                )}
              >
                {tab.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
