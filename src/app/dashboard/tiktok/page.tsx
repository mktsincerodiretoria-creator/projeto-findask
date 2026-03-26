"use client";

import ImportPlanilha from "@/components/ImportPlanilha";

export default function TikTokPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">TikTok Shop</h1>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <p className="text-gray-800 text-lg font-semibold mb-2">Integracao TikTok Shop - Em breve</p>
        <p className="text-gray-600 text-sm">
          Enquanto a integracao direta nao esta disponivel, voce pode importar a planilha de vendas abaixo.
        </p>
      </div>

      <ImportPlanilha platform="TIKTOK_SHOP" />

      <div className="border-t-2 border-gray-400 pt-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Vendas - TikTok Shop</h2>
        <div className="bg-white rounded-lg border p-8 text-center">
          <p className="text-gray-400">Importe a planilha acima para ver as vendas do TikTok Shop.</p>
        </div>
      </div>
    </div>
  );
}
