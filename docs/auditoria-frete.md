# Agente de auditoria de frete (Mercado Livre)

Confere o frete que o Mercado Livre cobrou do vendedor em cada venda e aponta
cobranças acima do que o próprio ML cobra em vendas equivalentes.

## Como rodar

```bash
npm run auditar-frete -- "MELI ALTA MercadoTurbo_Financeiro_....xlsx" "MELI CJ ....xlsx" --saida auditoria-frete.xlsx
```

Aceita os relatórios `MercadoTurbo_Financeiro_..._CALCULO_RESUMO` em `.xlsx` ou `.csv`.
Pode juntar várias contas: o nome da conta vem do nome do arquivo (`MELI <CONTA> MercadoTurbo...`).

## O que ele verifica

Os relatórios não trazem peso nem medidas, então a conferência é por **consistência**:
pela regra do ML (ver `frete-mercadolivre-regras.md`), o frete do vendedor depende do
peso cobrado (maior entre real e cúbico A×L×C/6000), da faixa de preço e da reputação.
Mesmo produto + mesma conta + mesma logística + mesma faixa de preço ⇒ deveria pagar o mesmo frete.

| Verificação | Confiança | Exemplo |
|---|---|---|
| Venda acima do frete habitual do próprio anúncio | Alta | anúncio paga R$8,65 em quase todas as vendas e R$16,45 em algumas |
| Frete do anúncio mudou de patamar (re-medição do pacote) | Alta | R$49,35 até 09/10, R$106,85 desde 10/10 |
| Mesmo SKU paga menos em outro anúncio da mesma conta | Média | medidas cadastradas diferentes entre anúncios |
| Envio com várias unidades acima de N envios separados | Média | 2 unidades cobradas R$29,50 vs 2 × R$6,85 |
| Mesmo SKU com frete muito diferente entre contas | Informativo | pode ser reputação ou medidas diferentes |
| Frete ≥ 30% do preço | Informativo | rever embalagem (peso cúbico) |
| Venda cancelada com frete | Informativo | conferir estorno no extrato |

Só vale como referência um valor de frete que se repetiu em pelo menos 2 vendas
de 1 unidade (carrinhos com itens diferentes ficam de fora).

## Planilha gerada

`Resumo`, `Alertas` (venda a venda: cobrado × esperado × diferença), `SKU divergente`,
`Entre contas`, `Anuncios`, `Frete alto`, `Canceladas c frete` e `Contestacao`
(texto pronto para o atendimento do ML, por anúncio).

## Como corrigir

A API do ML não permite contestar cobrança nem mudar medidas em ME2 (quem define é o ML).
O caminho é o atendimento: abrir chamado com o texto da aba `Contestacao`, pedindo nova
medição e estorno, e anexar foto da caixa com trena e balança.
