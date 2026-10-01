#!/bin/bash
# ===========================================================
# FindAsk - Deploy para VPS com EasyPanel (AlmaLinux 9)
# Roda na porta 4000 para nao conflitar com EasyPanel (3000/80)
# ===========================================================
set -e

echo ""
echo "=========================================="
echo "  FindAsk - Instalacao Automatica"
echo "=========================================="
echo ""

# 1. Instalar Node.js 20
echo "[1/6] Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  dnf install -y nodejs > /dev/null 2>&1
fi
echo "  Node $(node -v) instalado"

# 2. Instalar PM2 e Git
echo "[2/6] Instalando PM2..."
npm install -g pm2 > /dev/null 2>&1
dnf install -y git > /dev/null 2>&1
echo "  PM2 instalado"

# 3. Clonar repositorio
echo "[3/6] Baixando FindAsk..."
APP_DIR="/opt/findask"
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR && git pull origin main > /dev/null 2>&1
  echo "  Repositorio atualizado"
else
  rm -rf $APP_DIR 2>/dev/null
  git clone https://github.com/mktsincerodiretoria-creator/projeto-findask.git $APP_DIR > /dev/null 2>&1
  echo "  Repositorio clonado"
fi
cd $APP_DIR

# 4. Criar .env interativo
echo "[4/6] Configurando variaveis de ambiente..."
if [ ! -f "$APP_DIR/.env" ]; then
  cat > $APP_DIR/.env << 'ENVEOF'
# Edite este arquivo com: nano /opt/findask/.env
# Cole suas chaves reais no lugar de COLE_AQUI

DATABASE_URL="COLE_AQUI"
ML_CLIENT_ID="COLE_AQUI"
ML_CLIENT_SECRET="COLE_AQUI"
ML_REDIRECT_URI="http://143.95.172.45:4000/api/auth/mercadolivre/callback"
SHOPEE_PARTNER_ID="COLE_AQUI"
SHOPEE_PARTNER_KEY="COLE_AQUI"
SHOPEE_REDIRECT_URI="http://143.95.172.45:4000/api/auth/shopee/callback"
TIKTOK_APP_KEY="COLE_AQUI"
TIKTOK_APP_SECRET="COLE_AQUI"
TIKTOK_REDIRECT_URI="http://143.95.172.45:4000/api/auth/tiktok/callback"
ANTHROPIC_API_KEY="COLE_AQUI"
PORT=4000
ENVEOF
  echo "  .env criado"
  echo ""
  echo "  >>> EDITE AGORA com: nano /opt/findask/.env <<<"
  echo "  >>> Cole suas chaves reais e salve (Ctrl+O, Enter, Ctrl+X) <<<"
  echo ""
else
  echo "  .env ja existe"
fi

# 5. Build
echo "[5/6] Instalando pacotes e buildando (2-3 min)..."
npm install --legacy-peer-deps > /dev/null 2>&1
npx prisma generate > /dev/null 2>&1
npm run build > /dev/null 2>&1
echo "  Build concluido"

# 6. PM2 na porta 4000
echo "[6/6] Iniciando FindAsk na porta 4000..."
cd $APP_DIR
pm2 delete findask 2>/dev/null || true
PORT=4000 pm2 start npm --name "findask" -- start > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

# Abrir porta 4000 no firewall
firewall-cmd --permanent --add-port=4000/tcp > /dev/null 2>&1 || true
firewall-cmd --permanent --add-port=22022/tcp > /dev/null 2>&1 || true
firewall-cmd --reload > /dev/null 2>&1 || true

echo ""
echo "=========================================="
echo "  FINDASK INSTALADO COM SUCESSO!"
echo "=========================================="
echo ""
echo "  Acesse: http://143.95.172.45:4000"
echo ""
echo "  PROXIMO PASSO:"
echo "    1. nano /opt/findask/.env"
echo "    2. Cole suas chaves reais"
echo "    3. pm2 restart findask"
echo ""
echo "  Comandos uteis:"
echo "    pm2 logs findask     - ver logs"
echo "    pm2 restart findask  - reiniciar"
echo "    pm2 status           - ver status"
echo ""
