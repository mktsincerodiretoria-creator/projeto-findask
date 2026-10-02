# Editor de vídeo (Remotion)

Projeto Remotion separado do app Next.js. Ele tem as próprias dependências, e a pasta fica fora do `tsconfig.json` da raiz.

## Uso

```bash
cd editor-video
npm install
npm run studio   # abre o editor visual no navegador
npm run render   # gera out/teste.mp4
```

Os vídeos e imagens de origem ficam em `public/`. Use-os com `staticFile("nome.mp4")`.

## Ambiente em nuvem (Claude Code)

Neste ambiente a rede bloqueia o download do navegador do Remotion. Use o navegador já instalado:

```bash
npx remotion render Teste out/teste.mp4 \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
```

No seu computador isso não é necessário, porque o Remotion baixa o navegador sozinho.

## Instalar na VPS (AlmaLinux 9)

```bash
curl -fsSL https://raw.githubusercontent.com/mktsincerodiretoria-creator/projeto-findask/main/editor-video/setup-vps.sh | bash
```

Instala em `/opt/editor-video`, separado do FindAsk. Mantém o Node.js que já existe e não abre nenhuma porta. Para usar o editor visual, abra um túnel SSH do seu computador até a porta 3100.
