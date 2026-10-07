# Editor de vídeo

Projeto separado do app Next.js. Ele tem as próprias dependências, e a pasta fica fora do `tsconfig.json` da raiz.

- **Editor de corte** (`editor/`): abre no navegador, com timeline com zoom, corte no ponto exato, exclusão de trechos e exportação em MP4.
- **Remotion** (`src/`): composições em código para animações, legendas e afins.

## Editor de corte

```bash
npm install
npm run editor   # http://localhost:3100
```

### Como cortar um trecho

1. Coloque a agulha vermelha no início do trecho e clique em **Cortar** (tecla `S`).
2. Coloque a agulha no fim do trecho e clique em **Cortar** de novo.
3. Clique no pedaço do meio (ele fica amarelo) e aperte **Excluir trecho** (tecla `Delete`).
4. Clique em **Exportar vídeo** e depois em **Baixar vídeo**.

Os cortes são salvos sozinhos. Ao reabrir o vídeo, eles continuam lá.

| Ação | Atalho |
|---|---|
| Tocar / pausar | `Espaço` |
| Cortar na agulha | `S` |
| Excluir trecho selecionado | `Delete` |
| Zoom na timeline | `Ctrl` + roda do mouse, `+` / `-`, ou a barra de zoom |
| Mostrar o vídeo inteiro | `0` ou **Ajustar** |
| Andar 1 quadro / 1 segundo | `←` `→` / `Shift` + `←` `→` |
| Ir ao corte anterior / seguinte | `↑` / `↓` |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Shift+Z` |

Pastas, que não vão para o Git:

- `videos/`: vídeos de origem. Coloque os arquivos aqui ou use **Enviar vídeo**.
- `projetos/`: cortes de cada vídeo, em JSON com os trechos mantidos em segundos.
- `out/`: vídeos exportados (`<nome>-editado.mp4`).

A exportação usa o FFmpeg (`ffmpeg-static`), corta no quadro exato e mantém a taxa de quadros do original. Ela roda com prioridade baixa e usa metade dos núcleos.

## Remotion

```bash
npm run studio   # http://localhost:3101
npm run render   # gera out/teste.mp4
```

## Instalar na VPS (AlmaLinux 9)

```bash
curl -fsSL https://raw.githubusercontent.com/mktsincerodiretoria-creator/projeto-findask/main/editor-video/setup-vps.sh | bash
```

O script instala em `/opt/editor-video`, separado do FindAsk, e mantém o Node.js que já existe. Ele deixa o editor de corte ligado pelo PM2 (`editor-video`), escutando só em `127.0.0.1:3100`, e não abre nenhuma porta.

Para usar o editor, abra um túnel SSH do seu computador:

```bash
ssh -p 22022 -L 3100:localhost:3100 root@IP_DA_VPS
```

Depois acesse http://localhost:3100. Não abra a porta 3100 no firewall: o editor não tem senha.

## Ambiente em nuvem (Claude Code)

Neste ambiente a rede bloqueia o download do navegador do Remotion. Para renderizar, use o navegador já instalado:

```bash
npx remotion render Teste out/teste.mp4 \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
```
