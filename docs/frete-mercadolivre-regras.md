# Regras de cobrança de frete do Mercado Livre (vendedor) — pesquisa out/2026

> Fonte: trechos indexados de páginas oficiais do ML e de blogs especializados (as páginas do ML não puderam ser abertas diretamente do ambiente de pesquisa).
> Etiquetas: **[OFICIAL]** página/doc do ML · **[TERCEIROS]** blogs/consultorias · **[INCERTO]** divergente ou não confirmado.
> Regra de ouro para o auditor: **o valor "esperado" deve vir da API** (`/users/{id}/shipping_options/free`), não de tabela copiada de blog.

## 1. Modalidades e quem paga

| `logistic_type` | Quem paga |
|---|---|
| `cross_docking` (Coleta), `drop_off` / `xd_drop_off` (Agência/Correios) | Vendedor paga o "Custo dos Envios" (tabela peso × faixa de preço × reputação), descontado da venda. |
| `fulfillment` (Full) | Mesma tabela de envio + tarifas próprias do Full (armazenagem, retirada). |
| `self_service` (Flex) | Vendedor entrega; não paga tabela de envio. Itens < R$79 mantêm tarifa fixa por unidade (≈ R$6,25–7,75) [TERCEIROS]. |
| ME1 / `custom` | Vendedor define o frete; ML não cobra tabela ME2 [OFICIAL]. |

**Desde 02/03/2026** o Custo dos Envios é cobrado em toda venda ME2/Full, inclusive quando o comprador paga o frete [TERCEIROS citando ajuda 40538].

## 2. Frete grátis

- 06/06/2025: frete grátis ao comprador passou de R$79 → **R$19** (exceto internacional R$79 e supermercado R$199).
- Até fev/2026: itens R$12,50–79 pagavam custo fixo (≈ R$6,25 / 6,50 / 6,75); abaixo de R$12,50, 50% do preço.
- **A partir de 02/03/2026** (Full, Coleta, Agência): custo fixo substituído por **custo variável** — 29 faixas de peso × 8 faixas de preço × reputação. Flex manteve tarifa fixa.

| Preço | Frete grátis | Vendedor paga |
|---|---|---|
| < R$19 | Comprador paga (grátis opcional, pago pelo vendedor) | linha "até R$18,99", a partir de ≈ R$5,65 |
| R$19 – 78,99 | ML oferece (só produto novo) | linha da faixa, a partir de ≈ R$6,55 |
| ≥ R$79 | Obrigatório, pago pelo vendedor | tabela com desconto por reputação, a partir de ≈ R$12,35 |

Produto usado: frete grátis opcional, pago pelo vendedor.

## 3. Tabela de custo de envio

- **Faixas de preço (8):** até 18,99 · 19–48,99 · 49–78,99 · 79–99,99 · 100–119,99 · 120–149,99 · 150–199,99 · ≥200.
- **Faixas de peso (29):** até 0,3 kg · 0,3–0,5 · 0,5–1 · 1–1,5 · 1,5–2 · 2–3 … 25–30 kg … até >150 kg.
- **Tabelas oficiais por reputação:**
  - Verde / MercadoLíder / sem reputação: https://www.mercadolivre.com.br/ajuda/custos-envio-reputacao-verde-mercado-lider_40538
  - Amarela e Laranja/Vermelha: ajudas 40545 / 40547 [INCERTO qual é qual].

Valores coletados (R$, verde/sem reputação, vigência 02/03/2026) [TERCEIROS, divergências de R$0,30–0,60 entre fontes]:

| Peso | <19 | 19–48,99 | 49–78,99 | 79–99,99 | ≥200 |
|---|---|---|---|---|---|
| até 0,3 kg | 5,65 | 6,55 | 7,75 | 12,35 | 21,65 |
| 0,3–0,5 kg | – | 6,95 | – | 13,25–13,85 | – |
| 0,5–1 kg | – | – | – | 13,85 | – |
| 1–2 kg | – | – | 8,15 | 14,15 / 14,45 | – |
| 8–9 kg | 6,95 | – | – | – | 50,75 |
| 25–30 kg | 7,75 | – | – | – | 106,95 |
| >150 kg | – | – | – | – | 262,85 |

Laranja/vermelha, R$79–99,99: 24,70 (≤0,3 kg), 27,70 (0,5–1), 28,30 (1–1,5), 28,90 (1,5–2).

**Descontos por reputação:**
- ≥ R$79: verde até **50%**, amarela até **40%**, laranja/vermelha **0%** (12,35 = 50% de 24,70 ✔).
- < R$79: exemplo 0,3–0,5 kg / R$19–48,99 → verde 6,95, amarela 7,94, laranja 9,93 ⇒ ≈ 30% / 20% (inferência).
- Na API: `discounts[].rate` sobre `promoted_amount` (ex.: 200 com rate 0.4 → `list_cost` 120) [OFICIAL].

## 4. Peso

- **Peso cobrado = maior entre peso real e peso cúbico.**
- **Peso cúbico = A × L × C (cm) / 6000** (kg). Enquadra-se na faixa de peso da tabela.
- Valem as medidas da **embalagem final**.
- Limites [INCERTO]: ME2 ≈ 30 kg; soma dos lados 200 cm (Correios) / 260 cm (Full); Full "extragrande" desde 20/05/2026: > 20 kg, lado > 80 cm ou > 125 L. ME1: até 500 cm/500 kg [OFICIAL].

## 5. Medição pelo ML e contestação

- Transportadoras medem; ML recalcula e **cobra a diferença** do vendedor = **"shipping compensation"** [OFICIAL, doc compensations].
  - API: `senders[].compensations[]` → `amount`, `reason` (ex.: `incorrect_dimensions`), `comment`; medidas **declaradas × validadas**, `dimension_by`.
  - Path exato no MLB [INCERTO] (Global Selling usa `/marketplace/shipments/{id}/...`).
- Painel: filtro "Com alteração no custo de envio" em Anúncios; medidas corrigidas ficam **travadas**.
- Contestação: pedir **nova medição via Ajuda/Contato** (ajuda 4413). Prazo oficial não encontrado [INCERTO]. Guardar provas: foto da embalagem com fita métrica e balança + ID do envio.

## 6. Endpoints para o auditor

| Endpoint | Uso |
|---|---|
| `GET /shipments/{id}` (`x-format-new: true`) | `logistic_type`, `mode`, dimensões do pacote |
| `GET /shipments/{id}/costs` | `gross_amount`, `receiver{cost,discounts}`, `senders[{cost,discounts,compensations}]` |
| `GET /users/{id}/shipping_options/free?dimensions=AxLxC,peso_g&item_price=&listing_type_id=&mode=me2&condition=new&logistic_type=&free_shipping=true&verbose=true` | **Custo esperado** (`list_cost`, `cost`, `discount`) |
| `GET /items/{id}` → `shipping.dimensions` (`"10x10x10,500"`) | Medidas declaradas |
| `GET /orders/{id}` | `shipping.id`, `pack_id` |
| `GET /billing/integration/monthly/periods` + `/periods/key/{KEY}/group/ML/details` | Cobrança faturada (envio = `CXD`, bônus = `BXD` [INCERTO]) |

Em ME2 as dimensões são definidas pelo ML e não podem ser alteradas via API; em Full, pela operação [OFICIAL].

## 7. Outras cobranças

- **Devoluções**: etiqueta reversa gerada pelo ML; quem paga por motivo [INCERTO].
- **Full**: armazenagem diária (+7,6% em 2026), retirada (+5%), coleta (até +10%), estoque > 6 meses, excesso de espaço.
- **Produto pesado**: tabelas regionais próprias (ajuda 3922).

## Lógica proposta do auditor

1. Para cada venda: ler `/shipments/{id}/costs` → **cobrado** (`senders[].cost`).
2. Calcular **esperado** com `/users/{id}/shipping_options/free` usando medidas declaradas, preço, `listing_type_id`, `logistic_type`, `condition`.
3. Conferir peso cúbico (A×L×C/6000) vs peso real → faixa de peso correta.
4. Se houver `compensations`: comparar declarado × validado.
5. Cruzar com billing (`CXD`).
6. Divergência acima da tolerância → marcar venda, montar dossiê de contestação (pedido, envio, medidas, valores, diferença).
