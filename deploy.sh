#!/bin/bash
# ===========================================================
# FindAsk - Deploy Automatico para VPS AlmaLinux 9
# ===========================================================
set -e

echo ""
echo "=========================================="
echo "  FindAsk - Instalacao Automatica"
echo "=========================================="
echo ""

# 1. Instalar Node.js 20
echo "[1/7] Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  dnf install -y nodejs > /dev/null 2>&1
fi
echo "  Node $(node -v) instalado"

# 2. Instalar PM2 e Git
echo "[2/7] Instalando PM2 e dependencias..."
npm install -g pm2 > /dev/null 2>&1
dnf install -y git nginx firewalld > /dev/null 2>&1
echo "  PM2 e Nginx instalados"

# 3. Clonar repositorio
echo "[3/7] Baixando FindAsk..."
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

# 4. Criar .env se nao existe
echo "[4/7] Configurando ambiente..."
if [ ! -f "$APP_DIR/.env" ]; then
  cat > $APP_DIR/.env << 'ENVEOF'
DATABASE_URL="postgresql://neondb_owner:npg_vL1kqgIw2MJd@ep-rough-paper-a5gq21dg-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
ML_CLIENT_ID="806129346603829"
ML_CLIENT_SECRET=""
ML_REDIRECT_URI="http://143.95.172.45/api/auth/mercadolivre/callback"
SHOPEE_PARTNER_ID="2032249"
SHOPEE_PARTNER_KEY="shpk4252474d7365594b5864726b6b59774b4158536278687547506e4f6e5145"
SHOPEE_REDIRECT_URI="http://143.95.172.45/api/auth/shopee/callback"
TIKTOK_APP_KEY="6je2c7c8691ic"
TIKTOK_APP_SECRET=""
TIKTOK_REDIRECT_URI="http://143.95.172.45/api/auth/tiktok/callback"
ANTHROPIC_API_KEY=""
ENVEOF
  echo "  .env criado (editar depois com: nano /opt/findask/.env)"
else
  echo "  .env ja existe"
fi

# 5. Build
echo "[5/7] Instalando pacotes e buildando (pode demorar 2-3 min)..."
npm install --legacy-peer-deps > /dev/null 2>&1
npx prisma generate > /dev/null 2>&1
npm run build > /dev/null 2>&1
echo "  Build concluido"

# 6. Nginx
echo "[6/7] Configurando Nginx..."
cat > /etc/nginx/conf.d/findask.conf << 'NGINXEOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
NGINXEOF
rm -f /etc/nginx/conf.d/default.conf 2>/dev/null
nginx -t > /dev/null 2>&1
systemctl enable nginx > /dev/null 2>&1
systemctl restart nginx
echo "  Nginx configurado"

# 7. PM2
echo "[7/7] Iniciando FindAsk..."
cd $APP_DIR
pm2 delete findask 2>/dev/null || true
pm2 start npm --name "findask" -- start > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

# Firewall
systemctl enable firewalld > /dev/null 2>&1
systemctl start firewalld > /dev/null 2>&1
firewall-cmd --permanent --add-service=http > /dev/null 2>&1
firewall-cmd --permanent --add-service=https > /dev/null 2>&1
firewall-cmd --permanent --add-port=22022/tcp > /dev/null 2>&1
firewall-cmd --reload > /dev/null 2>&1

echo ""
echo "=========================================="
echo "  FINDASK INSTALADO COM SUCESSO!"
echo "=========================================="
echo ""
echo "  Acesse: http://143.95.172.45"
echo ""
echo "  IMPORTANTE: Edite as chaves secretas:"
echo "    nano /opt/findask/.env"
echo ""
echo "  Comandos uteis:"
echo "    pm2 logs findask     - ver logs"
echo "    pm2 restart findask  - reiniciar"
echo ""
echo "  Para atualizar:"
echo "    cd /opt/findask && git pull && npm run build && pm2 restart findask"
echo ""
