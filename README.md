# FinDash - Dashboard Financeiro Multi-Plataforma

Dashboard financeiro para sellers de marketplace. Integra com Mercado Livre (e futuramente Shopee, TikTok Shop, Amazon) para exibir metricas de vendas, custos, tarifas e margem de lucro em tempo real.

## Stack (tudo GRATIS)

- **Next.js 14** - Frontend + Backend
- **PostgreSQL** (Neon) - Banco de dados na nuvem
- **Prisma** - ORM
- **Tailwind CSS** - Estilizacao
- **Recharts** - Graficos
- **Vercel** - Hospedagem

## Como Configurar (Passo a Passo)

### 1. Banco de Dados (Neon)

1. Acesse [neon.tech](https://neon.tech) e crie uma conta
2. Crie um novo projeto
3. Copie a **connection string**

### 2. App do Mercado Livre

1. Acesse [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br/devcenter)
2. Crie uma nova aplicacao
3. Configure o Redirect URI: `https://seu-dominio.vercel.app/api/auth/mercadolivre/callback`
4. Escopos: `read`, `write`, `offline_access`
5. Copie o **App ID** e **Secret Key**

### 3. Configurar Variaveis de Ambiente

```bash
cp .env.example .env
```

Preencha o `.env` com seus dados.

### 4. Instalar e Rodar

```bash
npm install
npx prisma migrate dev --name init
npm run dev
```

### 5. Deploy na Vercel

1. Acesse [vercel.com](https://vercel.com)
2. Importe este repositorio
3. Adicione as variaveis de ambiente
4. Deploy!

## Como Funciona

1. **Conectar** - OAuth do Mercado Livre
2. **Sincronizar** - Busca pedidos e produtos via API
3. **Armazenar** - Dados salvos no PostgreSQL
4. **Exibir** - Dashboard com metricas calculadas
5. **Filtrar** - Filtros de data funcionam com dados historicos
