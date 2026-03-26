"use client";

import ImportPlanilha from "@/components/ImportPlanilha";

export default function AmazonPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Amazon</h1>

      <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 text-center">
        <p className="text-orange-800 text-lg font-semibold mb-2">Integracao Amazon - Em breve</p>
        <p className="text-orange-600 text-sm">
          Enquanto a integracao direta nao esta disponivel, voce pode importar a planilha de vendas abaixo.
        </p>
      </div>

      <ImportPlanilha platform="AMAZON" />

      <div className="border-t-2 border-orange-400 pt-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Vendas - Amazon</h2>
        <div className="bg-white rounded-lg border p-8 text-center">
          <p className="text-gray-400">Importe a planilha acima para ver as vendas da Amazon.</p>
        </div>
      </div>
    </div>
  );
}
