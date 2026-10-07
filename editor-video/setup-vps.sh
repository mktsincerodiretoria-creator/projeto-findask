#!/bin/bash
# ===========================================================
# Editor de vídeo (Remotion) - Instalação na VPS (AlmaLinux 9)
# Fica separado do FindAsk: pasta /opt/editor-video, nenhuma porta aberta.
# O editor de corte roda pelo PM2 e só escuta dentro da VPS (127.0.0.1:3100).
# Pode rodar de novo a qualquer momento para atualizar.
# ===========================================================
set -e

REPO="https://github.com/mktsincerodiretoria-creator/projeto-findask.git"
BRANCH="${BRANCH:-main}"
BASE_DIR="/opt/editor-video"
APP_DIR="$BASE_DIR/editor-video"

echo ""
echo "=========================================="
echo "  Editor de vídeo - Instalação"
echo "=========================================="
echo ""

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (ou com sudo)."
  exit 1
fi

# 1. Node.js: só instala se não existir. Não troca uma versão que já funciona.
echo "[1/6] Verificando Node.js..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  dnf install -y nodejs > /dev/null 2>&1
  echo "  Node $(node -v) instalado"
else
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "  Node $(node -v) é antigo demais para o Remotion (precisa 18 ou mais)."
    echo "  Ele também é usado pelo FindAsk, então não vou trocar sozinho."
    echo "  Atualize o Node e rode este script de novo."
    exit 1
  fi
  echo "  Node $(node -v) já instalado - mantido"
fi
command -v git &> /dev/null || dnf install -y git > /dev/null 2>&1
echo "  Git $(git --version | cut -d' ' -f3) ok"

# 2. Bibliotecas que o navegador do Remotion precisa + fontes
echo "[2/6] Instalando bibliotecas do navegador e fontes..."
dnf install -y --setopt=strict=0 \
  mesa-libgbm libX11 libXrandr libdrm libXdamage libXfixes dbus-libs libXcomposite \
  alsa-lib nss dbus pango mesa-libEGL mesa-libGL libxkbcommon libxshmfence \
  at-spi2-atk cups-libs \
  google-noto-sans-fonts google-noto-emoji-color-fonts dejavu-sans-fonts > /dev/null 2>&1
echo "  Bibliotecas ok"

# 3. Baixar só a pasta do editor (não mexe em /opt/findask)
echo "[3/6] Baixando o editor (branch $BRANCH)..."
if [ -d "$BASE_DIR/.git" ]; then
  cd "$BASE_DIR"
  git fetch -q origin "$BRANCH"
  git checkout -q -B "$BRANCH" "origin/$BRANCH"
  echo "  Atualizado"
else
  git clone -q --filter=blob:none --sparse -b "$BRANCH" "$REPO" "$BASE_DIR"
  cd "$BASE_DIR"
  git sparse-checkout set editor-video
  echo "  Baixado"
fi

# 4. Pacotes e navegador
echo "[4/6] Instalando pacotes (1-2 min)..."
cd "$APP_DIR"
npm ci --no-audit --no-fund > /dev/null 2>&1
npx remotion browser ensure > /dev/null 2>&1
echo "  Pacotes ok"

# 5. Teste: renderiza 2 segundos com prioridade baixa (não atrapalha o FindAsk)
echo "[5/6] Teste de renderização..."
nice -n 19 npx remotion render Teste out/teste.mp4 --log=error
if [ -s out/teste.mp4 ]; then
  echo "  Teste ok: $APP_DIR/out/teste.mp4 ($(du -h out/teste.mp4 | cut -f1))"
else
  echo "  O teste falhou: o vídeo não foi gerado."
  exit 1
fi

# 6. Editor de corte sempre ligado (PM2), só acessível de dentro da VPS
echo "[6/6] Iniciando o editor de corte..."
command -v pm2 &> /dev/null || npm install -g pm2 > /dev/null 2>&1
pm2 delete editor-video > /dev/null 2>&1 || true
HOST=127.0.0.1 PORT=3100 pm2 start editor/server.mjs --name editor-video --cwd "$APP_DIR" > /dev/null 2>&1
pm2 save > /dev/null 2>&1
sleep 2
if curl -fs http://127.0.0.1:3100/api/videos > /dev/null; then
  echo "  Editor rodando"
else
  echo "  O editor não respondeu. Veja o motivo com: pm2 logs editor-video"
  exit 1
fi

echo ""
echo "=========================================="
echo "  EDITOR INSTALADO COM SUCESSO!"
echo "=========================================="
echo ""
echo "  Para abrir o editor de corte, no SEU computador rode:"
echo "    ssh -p 22022 -L 3100:localhost:3100 root@IP_DA_VPS"
echo "  Deixe essa janela aberta e acesse no navegador:"
echo "    http://localhost:3100"
echo ""
echo "  NÃO abra a porta 3100 no firewall: o editor não tem senha."
echo ""
echo "  Comandos úteis:"
echo "    pm2 logs editor-video      - ver erros"
echo "    pm2 restart editor-video   - reiniciar"
echo ""
