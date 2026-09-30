#!/usr/bin/env bash
# Instala o CorteFácil num servidor Linux (VPS) com https no seu domínio.
#
# Uso (como root, no servidor):
#   curl -fsSL https://raw.githubusercontent.com/mktsincerodiretoria-creator/projeto-findask/claude/video-editing-subtitles-che65w/editor-video/servidor/instalar-servidor.sh | bash -s editor.seudominio.com.br
#
# Rodar de novo atualiza o programa e mantém a senha e os projetos.
# Para trocar a senha: ... | bash -s editor.seudominio.com.br --nova-senha
set -euo pipefail

REPO="mktsincerodiretoria-creator/projeto-findask"
RAMO="claude/video-editing-subtitles-che65w"
CADDY_VERSAO="2.10.2"
DIR="${CF_DIR:-/opt/cortefacil}"
PORTA=8765

DOMINIO="${1:-}"
NOVA_SENHA="no"
[ "${2:-}" = "--nova-senha" ] && NOVA_SENHA="yes"

verde() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
erro() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "Rode como root (entre com: ssh root@IP-DO-SERVIDOR)."
if [ -z "$DOMINIO" ]; then
  read -rp "Qual endereço vai abrir o editor? (ex: editor.ndecom.com.br): " DOMINIO </dev/tty
fi
[[ "$DOMINIO" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || erro "Endereço inválido: '$DOMINIO'"

case "$(uname -m)" in
  x86_64|amd64) ARQ=amd64; ARQ_UV=x86_64; ARQ_FF=linux64 ;;
  aarch64|arm64) ARQ=arm64; ARQ_UV=aarch64; ARQ_FF=linuxarm64 ;;
  *) erro "Processador $(uname -m) não suportado." ;;
esac

# ------------------------------------------------------------------ pacotes básicos
verde "1/7 Preparando o sistema"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl tar xz-utils ca-certificates >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q curl tar xz ca-certificates >/dev/null
elif command -v yum >/dev/null; then
  yum install -y -q curl tar xz ca-certificates >/dev/null
fi
if ss -ltn 2>/dev/null | grep -qE ':(80|443) ' && ! systemctl is-active --quiet cortefacil-https 2>/dev/null; then
  erro "As portas 80/443 já estão em uso (servidor com cPanel/Apache?). Use um VPS limpo (Ubuntu) ou fale comigo."
fi
id cortefacil >/dev/null 2>&1 || useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin cortefacil
mkdir -p "$DIR"/{ferramentas,dados}

# ------------------------------------------------------------------ programa
verde "2/7 Baixando o CorteFácil"
TMP="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$RAMO" | tar -xz -C "$TMP"
mkdir -p "$DIR/app"
cp -a "$TMP"/*/editor-video/. "$DIR/app/"
rm -rf "$TMP" "$DIR/app/testes" "$DIR/app/dist"

# ------------------------------------------------------------------ ffmpeg
if [ ! -x "$DIR/ferramentas/ffmpeg/bin/ffmpeg" ]; then
  verde "3/7 Instalando o ffmpeg"
  TMP="$(mktemp -d)"
  curl -fsSL "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${ARQ_FF}-gpl.tar.xz" | tar -xJ -C "$TMP"
  rm -rf "$DIR/ferramentas/ffmpeg"
  mv "$TMP"/ffmpeg-* "$DIR/ferramentas/ffmpeg"
  rm -rf "$TMP"
else
  verde "3/7 ffmpeg já instalado"
fi

# ------------------------------------------------------------------ Python + pacotes
verde "4/7 Instalando o Python e os componentes (alguns minutos)"
if [ ! -x "$DIR/ferramentas/uv" ]; then
  curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-${ARQ_UV}-unknown-linux-gnu.tar.gz" \
    | tar -xz -C "$DIR/ferramentas" --strip-components=1
fi
export UV_PYTHON_INSTALL_DIR="$DIR/ferramentas/python"
[ -x "$DIR/venv/bin/python" ] || "$DIR/ferramentas/uv" venv -q -p 3.12 "$DIR/venv"
"$DIR/ferramentas/uv" pip install -q --python "$DIR/venv/bin/python" -r "$DIR/app/requirements.txt"

# ------------------------------------------------------------------ senha
verde "5/7 Configurando a senha de acesso"
ENV=/etc/cortefacil.env
SENHA=""
[ -f "$ENV" ] && [ "$NOVA_SENHA" = "no" ] && SENHA="$(grep '^CF_SENHA=' "$ENV" | cut -d= -f2-)"
if [ -z "$SENHA" ]; then
  SENHA="$(tr -dc 'a-km-zA-HJ-NP-Z2-9' </dev/urandom | head -c 10)"
fi
cat > "$ENV" <<EOF
CF_SENHA=$SENHA
EDITOR_DADOS=$DIR/dados
PORTA=$PORTA
UV_PYTHON_INSTALL_DIR=$DIR/ferramentas/python
PATH=$DIR/ferramentas/ffmpeg/bin:/usr/local/bin:/usr/bin:/bin
EOF
chmod 600 "$ENV"
chown -R cortefacil:cortefacil "$DIR"

# ------------------------------------------------------------------ serviço do editor
verde "6/7 Ligando o editor"
cat > /etc/systemd/system/cortefacil.service <<EOF
[Unit]
Description=CorteFacil - editor inteligente de video
After=network-online.target

[Service]
User=cortefacil
WorkingDirectory=$DIR/app
EnvironmentFile=$ENV
# Depois de uma atualização pelo botão, instala pacotes novos (se houver) antes de abrir.
ExecStartPre=$DIR/ferramentas/uv pip install -q --python $DIR/venv/bin/python -r $DIR/app/requirements.txt
ExecStart=$DIR/venv/bin/python $DIR/app/iniciar.py --sem-navegador
# O botão "Atualizar" encerra com código 42; o systemd abre de novo já atualizado.
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------------------------ https (Caddy)
verde "7/7 Ligando o https para $DOMINIO"
if [ ! -x /usr/local/bin/caddy ]; then
  TMP="$(mktemp -d)"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSAO}/caddy_${CADDY_VERSAO}_linux_${ARQ}.tar.gz" | tar -xz -C "$TMP"
  install -m 755 "$TMP/caddy" /usr/local/bin/caddy
  rm -rf "$TMP"
fi
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:$PORTA
}
EOF
cat > /etc/systemd/system/cortefacil-https.service <<EOF
[Unit]
Description=CorteFacil - https (Caddy)
After=network-online.target

[Service]
Environment=HOME=/var/lib/caddy
ExecStartPre=/bin/mkdir -p /var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Libera as portas da web no firewall do próprio servidor (as imagens da Oracle/OCI vêm fechadas).
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd -q --permanent --add-service=http --add-service=https && firewall-cmd -q --reload
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
if command -v iptables >/dev/null; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport $p -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
fi

if [ "${CF_SEM_SYSTEMD:-}" = "1" ]; then
  verde "Teste: pulando o systemd"
else
  systemctl daemon-reload
  systemctl enable -q cortefacil cortefacil-https
  systemctl restart cortefacil cortefacil-https
fi

IP="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<EOF

$(printf '\033[1;32m')===============================================================
  CorteFácil instalado!
===============================================================$(printf '\033[0m')

  Endereço:  https://$DOMINIO
  Senha:     $SENHA        (anote!)

  Se ainda não fez: na HostGator, em cPanel > Zone Editor, crie um
  registro do tipo A com o nome do endereço acima apontando para:
      $IP
  O https liga sozinho alguns minutos depois que o domínio apontar.

  Ver se está rodando:   systemctl status cortefacil
  Ver os avisos:         journalctl -u cortefacil -u cortefacil-https -f
EOF
