# Vídeos do Caio — instalação e operação no Claude Code / cloud

Documento preparado em 06/11/2026. Destino assumido: Claude Code em Linux. Se o produto chamado “Cloud Code” for outro, os comandos Python continuam aplicáveis; o mecanismo de instruções persistentes pode mudar.

## 1. O que este pacote entrega

Integração real com a API Runway para gerar vídeos, acompanhar tarefas, baixar MP4 e importar clipes em Remotion. Inclui o cliente Python efetivamente utilizado, seus testes, exemplos sem dados pessoais, componentes Remotion e instruções de edição.

O ZIP é a forma recomendada de instalação. Não inclui chave, credenciais Windows, imagens pessoais, vídeo de referência, vídeos gerados, histórico de conversas nem projeto completo dos vídeos antigos. Envie os materiais necessários separadamente ao ambiente autorizado.

O Markdown também contém ao final os arquivos de texto do pacote, permitindo reconstruí-lo se você transferir somente este documento. Os anexos são código para revisão e instalação; não execute gerações pagas ao simplesmente ler o guia.

## 2. Estado comprovado e limites

- Login, chave e consulta de saldo da API foram validados no computador Windows.
- Gen-4.5: geração real de 5 segundos concluída. Custo estimado de 60 créditos/US$ 0,60. Alterou rosto, gestos das mãos e intensificou o zoom.
- Hailuo 3 via Runway: geração real de 5 segundos concluída com três imagens de referência (caminhão e dois quadros faciais). Custo estimado de 56 créditos/US$ 0,56. Melhor estabilidade, mas identidade ainda não perfeita.
- Uma tentativa com imagens grandes recebeu HTTP 413, sem ID de tarefa; o saldo de 940 créditos foi conferido antes do reenvio. Não repetir essa exceção sem evidência equivalente.
- A versão de Hailuo retornou vídeo 768×1024, 24 fps e áudio. A entrega foi remuxada sem áudio, preservando os pixels.
- Não houve validação ponta a ponta em Linux/cloud nem render Remotion desses dois testes. O pacote possui testes locais, não uma certificação do ambiente de destino.
- O cliente suporta somente `gen4.5`, `gen4_turbo` e `hailuo3`. Não suporta Veo, edição facial especializada, máscara automática, voz clonada ou restauração perfeita. Disponibilidade de outros modelos no portal não significa integração implementada.

## 3. Ferramentas necessárias

Obrigatórias: Python 3.10+ e acesso HTTPS. O cliente usa somente a biblioteca padrão; não precisa de pip, SDK Runway, GPU local nem pacote de IA local.

Para inspecionar, extrair quadros e remover áudio: FFmpeg e ffprobe. Pillow é opcional para painéis de comparação. O arquivo de vídeo é gerado nos servidores do provedor.

Para montagem Remotion: Node compatível com o projeto (`^20.19.0 || ^22.13.0 || >=24`), npm, Chrome Headless Shell e bibliotecas Linux. Versões utilizadas: Remotion e @remotion/media/@remotion/cli 4.0.538; React/React DOM 19.2.3. Preserve o lockfile quando migrar um projeto existente.

Instalação básica em Debian/Ubuntu, em terminal autorizado:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv ffmpeg ca-certificates unzip
python3 --version
ffmpeg -version
ffprobe -version
```

Se não houver sudo, use os pacotes fornecidos pelo ambiente ou uma imagem Docker adequada. Não desative TLS ou políticas de rede para contornar falhas. Para render, prefira Debian Bookworm ou Ubuntu 22.04+; não use Alpine. O Dockerfile opcional incluído contém Node 22, Python, FFmpeg e dependências do navegador.

## 4. Instalação do pacote

Extraia o ZIP, abra a pasta `runway-cloud` no terminal e permaneça nessa pasta ao executar os exemplos. Caminhos Linux diferenciam maiúsculas de minúsculas.

```bash
cd /caminho/para/runway-cloud
python3 scripts/runway_video.py --workspace "$PWD" doctor
python3 -m unittest discover -s scripts -p 'test_runway_video.py'
```

O `config.json` distribuído tem orçamento ZERO e nenhuma autorização. O pacote não reutiliza autorizações de gastos da sessão Windows. `doctor` apenas verifica presença de arquivos/chave; NÃO autentica a conta.

## 5. Configurar a chave com segurança

O usuário deve obter uma chave em https://dev.runwayml.com/ e inseri-la no gerenciador de segredos do ambiente cloud como `RUNWAYML_API_SECRET`. Disponibilize-a somente ao processo que executa o cliente.

Não copiar `.secrets/runway.dpapi`: a proteção DPAPI é vinculada ao usuário Windows e não funciona no Linux. Não incluir chaves em Markdown, chats, Git, comandos literais, Dockerfile, logs, capturas ou variáveis de frontend. Uma chave foi compartilhada na conversa de origem; recomenda-se substituí-la antes de configurar o cloud. A nova chave deve ficar apenas no gerenciador de segredos.

Alternativa para terminal Bash interativo privado, sem gravar a chave no histórico:

```bash
read -r -s -p 'Chave Runway: ' RUNWAYML_API_SECRET
printf '\n'
export RUNWAYML_API_SECRET
python3 scripts/check_connection.py
# Ao encerrar a sessão:
# unset RUNWAYML_API_SECRET
```

Não use `set -x`, `env` ou prints do segredo. A chave permite consumir créditos da conta. Créditos/planos do site são separados da API. Comprar créditos e habilitar recarga automática são ações separadas, que dependem do usuário.

## 6. Rede e persistência no cloud

Permitir HTTPS para `api.dev.runwayml.com`. Downloads de resultados usam URLs temporárias de armazenamento retornadas pela própria API. Se a rede bloquear o host retornado, solicitar liberação específica; não publicar o vídeo ou usar um proxy público para contornar isso. O guia público usa também `docs.dev.runwayml.com`.

Persistir `jobs/`, manifestos, config e arquivos de saída num volume privado. Ambiente efêmero que perde o registro da tarefa pode provocar repetição de cobrança. Um worker por workspace: o lock é um arquivo local e não é um mecanismo de coordenação distribuída. Nunca incorporar segredos à imagem Docker.

## 7. Preparar materiais e manifestos

Coloque a foto em `assets/caminhao.jpg`. Para referências extras, coloque `assets/rosto-frontal.png` e `assets/rosto-expressao.png`. Esses arquivos não estão no pacote. Os dois JSONs em `manifests/` mostram os campos usados.

No cliente atual, `image` é resolvido relativamente ao manifesto; `references` é resolvido relativamente ao diretório de execução. Por isso execute os comandos na raiz do pacote ou use caminhos absolutos nas referências. Não reutilize caminhos `C:/Users/...` no cloud.

Limites conservadores do cliente: cada imagem até 3,5 MB; PNG, JPG ou WebP para a principal; referências extras em PNG. Base64 aumenta o tamanho em cerca de 33%; várias imagens abaixo do limite individual ainda podem exceder o limite total do request. Reduza cópias de envio, preservando os originais.

Exemplos (substitua os arquivos e os tempos conforme inspeção real):

```bash
ffmpeg -ss 4 -i assets/referencia.mp4 -frames:v 1 -update 1 assets/rosto-frontal.png
ffmpeg -i assets/rosto-frontal.png -vf 'scale=640:-1' -frames:v 1 -update 1 assets/rosto-frontal-envio.png
ffmpeg -i assets/caminhao.jpg -vf 'scale=832:-1' -q:v 2 -frames:v 1 -update 1 assets/caminhao-envio.jpg
```

Revise nitidez, olhos, boca e ausência de obstruções antes de usar quadros. Não escolha referência só pelo horário do exemplo. Para Hailuo, usamos modo referências: todos os itens de `promptImage` têm `uri`, sem `position`. Não misture referências com `first/last` nessa modalidade. A primeira referência orienta a cena; as duas seguintes orientam somente o rosto. Não são uma garantia de identidade nem um primeiro quadro fixado.

## 8. Orçamento e geração

Tabela consultada em 06/11/2026, sujeita a mudança:

| Modelo | Estimativa implementada |
|---|---|
| Gen-4.5 | 12 créditos/segundo |
| Gen-4 Turbo | 5 créditos/segundo |
| Hailuo 3 em 768p | 10 créditos/segundo + 2 por imagem enviada |

US$ 0,01/crédito, antes de impostos. Não confundir preço por segundo com duração disponível. Este cliente limita os manifestos a 5 ou 10 segundos e restringe Hailuo a 768p. Confirme a tabela oficial antes de gastar; atualize `pricing_checked` somente depois de verificar preços. O cliente bloqueia tabela com mais de 30 dias.

Sequência obrigatória:

1. Confirmar objetivo, materiais e autorização de envio ao Runway, incluindo referências pessoais novas.
2. Executar `plan` sem rede e conferir os arquivos, ID, modelo, duração e custo.
3. Registrar um limite numérico efetivamente autorizado. Não copiar uma autorização fictícia do exemplo.
4. Executar `submit` UMA vez, acompanhar com `sync`, inspecionar e entregar.

```bash
python3 scripts/runway_video.py --workspace "$PWD" plan manifests/hailuo-referencias.json

# SOMENTE após autorização real do usuário: exemplo de teto US$ 1 em workspace novo.
python3 scripts/runway_video.py --workspace "$PWD" budget --usd 1 --note 'Substituir pela autorização real e escopo do usuário'
python3 scripts/runway_video.py --workspace "$PWD" submit manifests/hailuo-referencias.json --approve-upload
python3 scripts/runway_video.py --workspace "$PWD" sync teste-hailuo-01 --wait 45
```

O teto é cumulativo nesse workspace, não por chamada. Inclui reservas de tarefas anteriores e não representa o saldo real da conta. Não controla outros programas, outros workspaces, câmbio ou cobrança no portal. Em nova tentativa, usar novo ID e conferir orçamento; não gerar versões extras automaticamente por insatisfação.

## 9. Recuperação e erros

- `PENDING`/`RUNNING`: continuar `sync`, sem `submit` novo.
- `SUCCEEDED`: `sync` baixa o MP4 e registra hash. Copiar a saída para armazenamento privado durável.
- `UNKNOWN`/`SUBMITTING`: NÃO reenviar. POST pode ter sido recebido antes da falha de conexão. Conferir portal/logs e recuperar ID remoto; usar `attach ID-LOCAL --task-id ID-REMOTO`, depois `sync`.
- `FAILED`/`CANCELED`: não presumir reembolso nem zerar reserva; conferir cobrança no provedor.
- HTTP 401: credencial incorreta/revogada ou configuração errada. Nunca imprimir a chave ao diagnosticar.
- HTTP 413: payload excessivo. O cliente atual registra erros de POST genericamente como UNKNOWN; não interpreta sozinho “rejeitado sem cobrança”. Verificar inexistência de tarefa e consumo antes de ajustar reserva e criar novo ID. Manter evidência no registro.
- HTTP 429/5xx: não repetir POST automaticamente. Consultas GET podem ser retomadas.
- `client.lock`: só remover depois de confirmar que nenhum processo está trabalhando nesse workspace.
- Download interrompido: `sync` retoma o fluxo de consulta/download; não gera outro vídeo.
- Ausência da chave no container: conferir injeção do segredo na execução, nunca embutir no build.

## 10. Revisão e entrega

Conferir metadados e reproduzir o vídeo completo. Contato de quadros é complemento, não prova de fluidez. Comparar rosto original, referências e rosto gerado; revisar olhos, nariz, boca, barba, cabelo, mãos, dedos, pernas, roupas, cenário, iluminação e intensidade de zoom.

```bash
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json jobs/teste-hailuo-01/output.mp4
ffmpeg -i jobs/teste-hailuo-01/output.mp4 -vf 'fps=1,scale=384:-1,tile=5x1' -frames:v 1 -update 1 jobs/teste-hailuo-01/revisao.jpg
ffmpeg -i jobs/teste-hailuo-01/output.mp4 -map 0:v:0 -c:v copy -an -movflags +faststart jobs/teste-hailuo-01/entrega-sem-audio.mp4
```

Não afirmar “rosto perfeito”, “restauração exata” ou “integração validada ponta a ponta” sem evidência. Uma nova geração reconstrói o rosto; não recupera pixels ausentes. Manter face frontal e movimento pequeno tende a reduzir a necessidade de inventar ângulos. Se persistirem mudanças, reportar limites e oferecer animação apenas da câmera sobre a foto original como alternativa que preserva os pixels.

Entregar MP4 local utilizável, com duração, custo estimado/confirmado claramente separados e limitações observadas. Não usar link temporário do provedor como única entrega.

## 11. Remotion opcional

A pasta `remotion/` contém um projeto mínimo para a composição `VideoIACinematico`, não todos os vídeos antigos. Para migrar o projeto completo, transferir separadamente código, package.json, lockfile e assets autorizados. Não copiar node_modules do Windows.

```bash
cd remotion
npm install
npx remotion browser ensure
cd ..
python3 scripts/runway_video.py --workspace "$PWD" import teste-hailuo-01 --project "$PWD/remotion"
cd remotion
npx remotion compositions src/index.ts
npx remotion render src/index.ts VideoIACinematico out/previa.mp4 --codec=h264 --concurrency=1
```

Após a primeira instalação, conservar o package-lock.json e usar `npm ci`. O npm/render depende da rede e das bibliotecas de Chromium; o Dockerfile opcional documenta dependências Debian. `npm run dev` abre o Studio; no cloud use encaminhamento privado/autenticado, não exponha arquivos pessoais publicamente.

`AiVideoLayer` silencia os clipes e usa `objectFit="contain"`: uma cena 3:4 em canvas 9:16 terá faixas. Não recortar automaticamente rosto/pés para preencher. A composição assume a mesma base de fps para a timeline; padronize todos os manifestos antes de misturar clipes. A importação usa duração solicitada, que pode diferir alguns frames do MP4: conferir ffprobe e limites de sequência. MP4 é opaco, sem alfa. Recorte/máscara do apresentador não está implementado.

## 12. Preferências permanentes do Caio

- Mercado Livre: AMARELO predominante. Shopee: LARANJA predominante. Quando juntos, manter cada identidade, inclusive brilhos e entradas. Não usar verde como identidade dessas plataformas.
- Temas genéricos seguem a direção aprovada, sem inventar uma plataforma.
- Elementos auxiliares: fundo transparente quando apropriado, aspecto 3D moderno e pouca escrita. Sincronizar com a fala real, preservando voz e gravação.
- Para Reels 1080×1920, área essencial conservadora: x=80..880 e y=320..1440. Margens: topo 320, base 480, esquerda 80, direita 200. Escalar proporcionalmente em outro 9:16.
- Incluir caixa completa, sombra/brilho relevante, overshoot, rotação e todo o trajeto de entrada/saída. Entradas nascem dentro da área segura.
- Proteger também rosto, mãos relevantes e legendas. Se faltar espaço, usar cena de apoio ou reorganizar layout.
- Usar `getReelsSafeRect`, `assertReelsSafeBounds` e `ReelsSafeAreaGuide`; guia só na inspeção, nunca no export final.
- Padrão baseado em captura do usuário, não especificação oficial do Instagram. Legenda expandida pode cobrir mais área.
- Não reutilizar x55/y80 de Video1101. Não refazer entregas antigas sem pedido.
- Efeitos sonoros abaixo da voz, audíveis e sem saturação. Referência antiga de redução de 10% é relativa à mixagem aprovada, não regra universal de volume.

## 13. Instruções para o agente Claude Code

O pacote inclui `CLAUDE.md`. Se já existir outro no destino, integrar as instruções sem sobrescrever preferências anteriores. Não precisa de plugin Runway ou MCP para este cliente REST. Ferramentas internas do Codex (image_gen, browser, execução e visualização de imagens) não são transferidas por este MD: usar equivalentes disponíveis no destino ou informar a limitação.

Prompt inicial sugerido:

> Leia GUIA-CLOUD.md e CLAUDE.md. Instale e valide as dependências neste ambiente. Execute testes e doctor. Consulte autenticação e saldo sem revelar segredos. Não gere conteúdo pago até eu autorizar materiais, destino e limite. Preserve meus arquivos. Depois prepare um plano com os materiais que eu enviar e revise visualmente cada resultado antes de entregar.

## 14. Fontes oficiais e manutenção

- Preços: https://docs.dev.runwayml.com/guides/pricing/
- API: https://docs.dev.runwayml.com/api/
- Entradas, base64 e tamanhos: https://docs.dev.runwayml.com/assets/inputs/
- Saídas: https://docs.dev.runwayml.com/assets/outputs/
- Esquema SDK utilizado para Hailuo: https://github.com/runwayml/sdk-python/blob/main/src/runwayml/types/image_to_video_create_params.py
- Créditos do site versus API: https://help.runwayml.com/hc/en-us/articles/50683115755155-Runway-API-FAQs
- Remotion/Linux: https://www.remotion.dev/docs/docker
- Instruções Claude Code: https://code.claude.com/docs/en/settings

Não atualizar modelos, dependências ou preços silenciosamente. Registrar alterações e validar os caminhos novos sem gerar cobrança desnecessária.

## 15. Docker opcional e reconstrução por um único MD

O Dockerfile não instala o Claude Code: execute-o no ambiente de agente que você já usa. Ele fornece o runtime de vídeo. Para builds reproduzíveis, conserve um lockfile após a instalação e substitua npm install por npm ci.

```bash
docker build -t caio-runway .
docker run --rm -e RUNWAYML_API_SECRET -v "$PWD:/app" caio-runway python3 scripts/check_connection.py
```

Esse exemplo monta todo o pacote para persistir jobs. A montagem substitui /app: para render dentro desse container, instale as dependências Remotion no volume Linux ou use volumes separados para jobs/assets. Não monte node_modules Windows. Não passe o valor literal da chave em -e: a variável deve vir do gerenciador de segredos/ambiente.

### Arquivos incorporados

Se receber apenas este MD, crie os arquivos abaixo nos caminhos relativos indicados, preservando quebras de linha e sem alterar o código. Não sobrescreva configurações existentes com orçamento ativo. Depois execute testes. Os arquivos não contêm credenciais.

#### Arquivo: .dockerignore

```text
.secrets
.env
.env.*
jobs
assets
**/node_modules
**/out
**/__pycache__
```

#### Arquivo: .gitignore

```text
.secrets/
.env
.env.*
!.env.example
jobs/
assets/*
node_modules/
remotion/out/
__pycache__/
*.pyc
*.lock
```

#### Arquivo: CLAUDE.md

```markdown
# Vídeos do Caio
Leia GUIA-CLOUD.md antes de operar. Execute na raiz deste pacote.
Use scripts/runway_video.py; não gere outra implementação por padrão.
Credencial apenas em RUNWAYML_API_SECRET, nunca em chat, Git ou logs.
O pacote começa com orçamento zero. Exigir autorização real de materiais, envio ao Runway e teto numérico antes de submit. Não inferir gasto ilimitado de saldo disponível.
Execute plan antes de submit. Registre orçamento cumulativo. Uma submissão por ID; preserve jobs em volume persistente. UNKNOWN/SUBMITTING exige reconciliação, nunca reenvio automático.
Não prometa identidade perfeita. Compare com referências, revele limitações, revise vídeo e quadros antes de entregar.
Use amarelo para Mercado Livre, laranja para Shopee. Em 1080x1920: área essencial x80..880/y320..1440, incluindo movimentos e brilhos, protegendo rosto e legendas. Guia apenas na prévia.
Não refaça entregas anteriores sem pedido. Não trate testes simulados como validação de API ou render no cloud.
```

#### Arquivo: config.json

```json
{
  "budget_usd": 0,
  "budget_authorization": null,
  "pricing_checked": "2026-11-06",
  "pricing_source": "https://docs.dev.runwayml.com/guides/pricing/",
  "usd_per_credit": 0.01,
  "credits_per_second": {
    "gen4.5": 12,
    "gen4_turbo": 5,
    "hailuo3": 10
  }
}
```

#### Arquivo: Dockerfile

```text
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN cd remotion && npm install && npx remotion browser ensure
CMD ["python3", "scripts/runway_video.py", "--workspace", "/app", "doctor"]
```

#### Arquivo: manifests/gen45.json

```json
{
  "id": "teste-gen45-01",
  "image": "../assets/caminhao.jpg",
  "model": "gen4.5",
  "duration": 5,
  "ratio": "832:1104",
  "prompt": "Subtle natural breathing and a tiny leg swing. Keep the same face frontal, the same clothing, hand gestures and background. Nearly stationary handheld camera. No speaking.",
  "timeline": {
    "from_frame": 0,
    "fps": 24
  }
}
```

#### Arquivo: manifests/hailuo-referencias.json

```json
{
  "id": "teste-hailuo-01",
  "image": "../assets/caminhao.jpg",
  "model": "hailuo3",
  "duration": 5,
  "ratio": "3:4",
  "prompt": "Image 1 defines the truck scene, clothing, pose and composition. Images 2 and 3 define only the exact face of this same adult man. Keep face nearly frontal, tiny leg swing and subtle breathing, nearly stationary camera. Preserve the original single raised index finger on each hand. Preserve facial proportions, beard, hairline and skin texture. Do not copy the indoor background, microphone or black shirt from face references. No speaking.",
  "timeline": {
    "from_frame": 0,
    "fps": 24
  },
  "references": [
    "assets/rosto-frontal.png",
    "assets/rosto-expressao.png"
  ]
}
```

#### Arquivo: remotion/package.json

```json
{
  "name": "caio-cloud-preview",
  "private": true,
  "version": "1.0.0",
  "engines": {
    "node": "^20.19.0 || ^22.13.0 || >=24"
  },
  "scripts": {
    "dev": "remotion studio src/index.ts"
  },
  "dependencies": {
    "@remotion/cli": "4.0.538",
    "@remotion/media": "4.0.538",
    "remotion": "4.0.538",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/react": "19.2.7"
  }
}
```

#### Arquivo: remotion/src/ai-video-manifest.json

```json
[]
```

#### Arquivo: remotion/src/AiVideoLayer.tsx

```tsx
import {Video} from '@remotion/media';
import {AbsoluteFill, Composition, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import manifest from './ai-video-manifest.json';

export type AiClip = {id: string; src: string; fps: number; from: number; durationInFrames: number};
const clips: AiClip[] = manifest;

const Clip: React.FC<{clip: AiClip}> = ({clip}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: interpolate(frame,
    [0, 5, clip.durationInFrames - 6, clip.durationInFrames - 1], [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
    <Video src={staticFile(clip.src)} muted objectFit="contain" style={{width: '100%', height: '100%'}} />
  </AbsoluteFill>;
};

// Reuse inside a speaking-video composition; its original voice remains underneath.
// Generated MP4s are opaque. This is a cutaway layer, not automatic person matting.
export const AiVideoLayer: React.FC<{items?: AiClip[]}> = ({items = clips}) => <>
  {items.map(clip => <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames}>
    <Clip clip={clip}/>
  </Sequence>)}
</>;

const Preview: React.FC = () => <AbsoluteFill style={{backgroundColor: '#10121a'}}>
  <AiVideoLayer/>
  {clips.length === 0 ? <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', color: '#eee', fontSize: 42, fontFamily: 'Arial', textAlign: 'center', padding: 100}}>
    Nenhum clipe importado.<br/>A prévia aparece aqui após geração e download.
  </AbsoluteFill> : null}
</AbsoluteFill>;

export const CompositionCinematico: React.FC = () => <Composition id="VideoIACinematico" component={Preview}
  width={1080} height={1920} fps={clips[0]?.fps ?? 30}
  durationInFrames={Math.max(150, ...clips.map(c => c.from + c.durationInFrames))}/>;
```

#### Arquivo: remotion/src/index.ts

```typescript
import {registerRoot} from 'remotion';
import {CompositionCinematico} from './AiVideoLayer';
registerRoot(CompositionCinematico);
```

#### Arquivo: remotion/src/ReelsSafeArea.tsx

```tsx
import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';

// Caio's conservative preset from his Instagram screenshot, 2026-11-01.
// Not an official Instagram specification. Applies to future 9:16 edits only.
export const REELS_SAFE_MARGINS = {top: 320, bottom: 480, left: 80, right: 200} as const;
export type SafeRect = {left: number; top: number; width: number; height: number};

export const getReelsSafeRect = (width = 1080, height = 1920): SafeRect => ({
  left: width * 80 / 1080,
  top: height * 320 / 1920,
  width: width * 800 / 1080,
  height: height * 1120 / 1920,
});

// Pass the full swept bounding box (including maximum scale, rotation,
// movement and meaningful glow/shadow), not merely the resting image box.
export const assertReelsSafeBounds = (
  name: string, bounds: SafeRect, width = 1080, height = 1920,
): void => {
  const safe = getReelsSafeRect(width, height);
  const values = [bounds.left, bounds.top, bounds.width, bounds.height, width, height];
  if (values.some(v => !Number.isFinite(v)) || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0 ||
    bounds.left < safe.left || bounds.top < safe.top ||
    bounds.left + bounds.width > safe.left + safe.width ||
    bounds.top + bounds.height > safe.top + safe.height) {
    throw new Error(`${name}: elemento/animação fora da área segura de Reels. Reposicione ou reduza antes de exportar.`);
  }
};

// Explicit opt-in for layout review only; never mounted in existing videos.
// Remove or set enabled=false for final export. This guide does not detect faces.
export const ReelsSafeAreaGuide: React.FC<{enabled?: boolean}> = ({enabled = false}) => {
  const {width, height} = useVideoConfig();
  if (!enabled) return null;
  const safe = getReelsSafeRect(width, height);
  return <AbsoluteFill style={{pointerEvents: 'none', zIndex: 9999}}>
    <div style={{position: 'absolute', ...safe, border: '3px dashed #ffd54a',
      boxShadow: '0 0 0 9999px rgba(220,35,55,0.28)', boxSizing: 'border-box'}}>
      <div style={{backgroundColor: '#191919', color: '#ffd54a', padding: 12,
        fontFamily: 'Arial', fontSize: 24}}>GUIA • manter elemento e animação dentro desta área</div>
    </div>
  </AbsoluteFill>;
};
```

#### Arquivo: scripts/check_connection.py

```python
"""Read-only authentication and balance check; never prints secrets."""
import os
import sys
from runway_video import api
key = os.environ.get("RUNWAYML_API_SECRET", "").strip()
if not key:
    sys.exit("Configure RUNWAYML_API_SECRET no gerenciador de segredos.")
try:
    result = api(key, "GET", "/organization")
    print({"authenticated": True, "creditBalance": result.get("creditBalance")})
except ValueError as error:
    sys.exit(str(error))
```

#### Arquivo: scripts/runway_video.py

```python
"""Runway image-to-video client. No network until submit/sync; no POST retry."""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

API = 'https://api.dev.runwayml.com/v1'
RATIOS = {'1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672'}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, path)


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier(value):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', value):
        raise ValueError('ID inválido: use letras, números, hífen e sublinhado (até 80).')
    return value


@contextmanager
def locked(workspace):
    folder = workspace / 'jobs'
    folder.mkdir(parents=True, exist_ok=True)
    lock = folder / 'client.lock'
    try:
        handle = lock.open('x')
    except FileExistsError:
        raise ValueError('Cliente ocupado ou lock de processo interrompido. Confira jobs/client.lock.')
    try:
        handle.write(str(os.getpid()))
        handle.close()
        yield
    finally:
        lock.unlink(missing_ok=True)


def credential(workspace):
    value = os.environ.get('RUNWAYML_API_SECRET', '').strip()
    if value:
        return value
    path = workspace / '.secrets' / 'runway.dpapi'
    if os.name == 'nt' and path.exists():
        env = os.environ.copy()
        env['CAIO_RUNWAY_SECRET_FILE'] = str(path)
        result = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
            "$s=Get-Content -LiteralPath $env:CAIO_RUNWAY_SECRET_FILE | ConvertTo-SecureString; "
            "$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); "
            "try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} "
            "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"],
            env=env, capture_output=True, text=True, timeout=20)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        raise ValueError('Não foi possível abrir a credencial protegida para este usuário Windows.')
    raise ValueError('Chave ausente. Execute configurar-chave.ps1 localmente.')


def api(key, method, endpoint, body=None):
    request = Request(API + endpoint, method=method, headers={
        'Authorization': 'Bearer ' + key,
        'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json',
        'User-Agent': 'CaioVideoIntegration/1.0'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(request, timeout=90) as response:
            return json.load(response)
    except HTTPError as error:
        # Never emit response bodies, which might echo request data or tokens.
        raise ValueError(f'Runway HTTP {error.code}. Verifique conta, saldo e parâmetros no portal.') from None
    except (URLError, TimeoutError):
        raise ValueError('Falha de conexão com Runway; nenhuma repetição automática foi feita.') from None


def total_reserved(workspace):
    return round(sum(float(read(p).get('reserved_usd', 0))
                     for p in (workspace / 'jobs').glob('*/job.json')), 6)


def plan(workspace, manifest):
    config = read(workspace / 'config.json')
    manifest = Path(manifest).resolve()
    spec = read(manifest)
    identifier(spec['id'])
    if spec['model'] not in ('gen4.5', 'gen4_turbo', 'hailuo3'):
        raise ValueError('Modelo não suportado nesta integração.')
    if type(spec['duration']) is not int or spec['duration'] not in (5, 10):
        raise ValueError('Use duração de 5 ou 10 segundos.')
    if spec['ratio'] not in (RATIOS if spec['model'] != 'hailuo3' else {'3:4', '9:16', '16:9'}):
        raise ValueError('Proporção não suportada.')
    if not isinstance(spec['prompt'], str) or not 1 <= len(spec['prompt'].strip()) <= 1000:
        raise ValueError('Prompt precisa ter de 1 a 1000 caracteres.')
    timeline = spec.get('timeline', {'from_frame': 0, 'fps': 30})
    if type(timeline.get('from_frame')) is not int or timeline['from_frame'] < 0:
        raise ValueError('from_frame deve ser inteiro não negativo.')
    if type(timeline.get('fps')) is not int or timeline['fps'] not in (24, 25, 30, 60):
        raise ValueError('fps precisa ser 24, 25, 30 ou 60.')
    spec['timeline'] = timeline
    image = (manifest.parent / spec['image']).resolve()
    raw = image.read_bytes()
    if len(raw) > 3500000 or not raw:
        raise ValueError('Imagem deve ter até 3,5 MB para envio base64. Prepare uma cópia menor.')
    mime = ('image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else
            'image/jpeg' if raw.startswith(b'\xff\xd8\xff') else
            'image/webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None)
    if not mime:
        raise ValueError('Imagem precisa ser PNG, JPEG ou WebP válido.')
    credit_rate = float(config['credits_per_second'][spec['model']])
    usd_rate = float(config['usd_per_credit'])
    if not all(math.isfinite(n) and n > 0 for n in (credit_rate, usd_rate)):
        raise ValueError('Tabela de preços inválida.')
    references = spec.get('references', [])
    if references and spec['model'] != 'hailuo3':
        raise ValueError('Referencias extras requerem hailuo3.')
    reference_hashes = []
    for ref in references:
        content = Path(ref).read_bytes()
        if not content.startswith(b'\x89PNG\r\n\x1a\n') or len(content) > 3500000:
            raise ValueError('Referencia deve ser PNG ate 3,5 MB.')
        reference_hashes.append(hashlib.sha256(content).hexdigest())
    extra_credits = 2 * (1 + len(references)) if spec['model'] == 'hailuo3' else 0
    cost = round((spec['duration'] * credit_rate + extra_credits) * usd_rate, 6)
    fingerprint = hashlib.sha256(json.dumps({
        'references_sha256': reference_hashes, 'spec': spec, 'image_sha256': hashlib.sha256(raw).hexdigest()
    }, sort_keys=True).encode()).hexdigest()
    return spec, raw, mime, {
        'id': spec['id'], 'image': str(image), 'model': spec['model'],
        'duration_seconds': spec['duration'], 'estimated_usd': cost,
        'reserved_workspace_usd': total_reserved(workspace),
        'budget_usd': config['budget_usd'], 'pricing_checked': config['pricing_checked'],
        'fingerprint': fingerprint, 'network_used': False,
        'output_has_alpha': False,
    }


def submit(workspace, manifest, approved):
    if not approved:
        raise ValueError('Falta --approve-upload após autorização do envio da imagem ao Runway.')
    with locked(workspace):
        spec, raw, mime, summary = plan(workspace, manifest)
        config = read(workspace / 'config.json')
        if (date.today() - date.fromisoformat(config['pricing_checked'])).days > 30:
            raise ValueError('Reconfira a tabela de preços e atualize pricing_checked antes de gerar.')
        path = workspace / 'jobs' / spec['id'] / 'job.json'
        if path.exists():
            previous = read(path)
            if previous['fingerprint'] != summary['fingerprint']:
                raise ValueError('ID já existe com outro conteúdo. Use novo ID para uma nova tentativa autorizada.')
            return {'id': spec['id'], 'status': previous['status'], 'reused': True,
                    'message': 'Nenhuma submissão adicional. Use sync ou attach.'}
        budget = float(config['budget_usd'])
        if not math.isfinite(budget) or not config.get('budget_authorization') or summary['reserved_workspace_usd'] + summary['estimated_usd'] > budget + 1e-8:
            raise ValueError('Orçamento ausente ou insuficiente. Registre um limite autorizado com budget.')
        key = credential(workspace)
        job = dict(summary, spec=spec, status='SUBMITTING', created_at=now(),
                   reserved_usd=summary['estimated_usd'])
        # Persistent reservation BEFORE network; crash/timeout never silently resubmits.
        save(path, job)
        payload = {'model': spec['model'], 'duration': spec['duration'], 'ratio': spec['ratio'],
                   'promptText': spec['prompt'],
                   'promptImage': f'data:{mime};base64,' + base64.b64encode(raw).decode()}
        if spec['model'] == 'hailuo3':
            payload['resolution'] = '768p'
            payload['promptImage'] = [{'uri': payload['promptImage']}]
            for ref in spec.get('references', []):
                payload['promptImage'].append({'uri': 'data:image/png;base64,' + base64.b64encode(Path(ref).read_bytes()).decode()})
        try:
            response = api(key, 'POST', '/image_to_video', payload)
            job['task_id'] = identifier(response['id'])
            job['status'] = 'PENDING'
        except Exception:
            job['status'] = 'UNKNOWN'
            save(path, job)
            raise
        save(path, job)
        return {'id': spec['id'], 'task_id': job['task_id'], 'status': job['status'],
                'reserved_usd': job['reserved_usd']}


def download(url, destination):
    if urlparse(url).scheme != 'https':
        raise ValueError('URL de saída precisa usar HTTPS.')
    temp = destination.with_suffix('.part')
    # No API authorization header is sent to output storage.
    with urlopen(Request(url, headers={'User-Agent': 'CaioVideoIntegration/1.0'}), timeout=90) as response, temp.open('wb') as stream:
        shutil.copyfileobj(response, stream)
    with temp.open('rb') as stream:
        header = stream.read(64)
    if b'ftyp' not in header or temp.stat().st_size < 32:
        raise ValueError('Saída não reconhecida como MP4. Não importada.')
    os.replace(temp, destination)


def sync(workspace, job_id, wait=0):
    with locked(workspace):
        path = workspace / 'jobs' / identifier(job_id) / 'job.json'
        job = read(path)
        if not job.get('task_id'):
            raise ValueError('Sem ID remoto. Recupere no portal e use attach; não reenvie.')
        output = path.parent / 'output.mp4'
        if job['status'] == 'SUCCEEDED' and output.exists():
            return {'id': job_id, 'status': 'SUCCEEDED', 'file': str(output)}
        key = credential(workspace)
        deadline = time.monotonic() + wait
        while True:
            response = api(key, 'GET', '/tasks/' + identifier(job['task_id']))
            job['status'] = response['status']
            job['checked_at'] = now()
            save(path, job)
            if job['status'] == 'SUCCEEDED':
                outputs = response.get('output', [])
                if not outputs:
                    raise ValueError('Tarefa concluída sem arquivo de saída.')
                download(outputs[0], output)
                job['output_file'] = 'output.mp4'
                job['output_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
                save(path, job)
                return {'id': job_id, 'status': job['status'], 'file': str(output)}
            if job['status'] in ('FAILED', 'CANCELED', 'CANCELLED') or time.monotonic() + 5 > deadline:
                return {'id': job_id, 'status': job['status']}
            time.sleep(5)


def import_clip(workspace, job_id, project):
    with locked(workspace):
        folder = workspace / 'jobs' / identifier(job_id)
        job = read(folder / 'job.json')
        source = folder / 'output.mp4'
        if job['status'] != 'SUCCEEDED' or not source.exists():
            raise ValueError('Conclua sync/download antes da importação.')
        if hashlib.sha256(source.read_bytes()).hexdigest() != job.get('output_sha256'):
            raise ValueError('Arquivo de vídeo mudou após download. Confira antes de importar.')
        project = Path(project).resolve()
        if not (project / 'src' / 'AiVideoLayer.tsx').exists():
            raise ValueError('Projeto não possui o componente AiVideoLayer instalado.')
        manifest = project / 'src' / 'ai-video-manifest.json'
        clips = read(manifest) if manifest.exists() else []
        spec = job['spec']
        fps = spec['timeline']['fps']
        if any(c['fps'] != fps for c in clips if c['id'] != job_id):
            raise ValueError('Manifesto possui outro FPS. Converta os tempos antes de importar.')
        target = project / 'public' / 'ai-video' / (job_id + '.mp4')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        cue = {'id': job_id, 'src': 'ai-video/' + target.name, 'fps': fps,
               'from': spec['timeline']['from_frame'], 'durationInFrames': spec['duration'] * fps}
        save(manifest, sorted([c for c in clips if c['id'] != job_id] + [cue], key=lambda c: c['from']))
        return {'file': str(target), 'manifest': str(manifest), 'composition': 'VideoIACinematico'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('doctor')
    p = sub.add_parser('plan'); p.add_argument('manifest')
    p = sub.add_parser('budget'); p.add_argument('--usd', required=True, type=float); p.add_argument('--note', required=True)
    p = sub.add_parser('submit'); p.add_argument('manifest'); p.add_argument('--approve-upload', action='store_true')
    p = sub.add_parser('sync'); p.add_argument('id'); p.add_argument('--wait', type=int, default=0, choices=range(0, 61))
    p = sub.add_parser('attach'); p.add_argument('id'); p.add_argument('--task-id', required=True)
    p = sub.add_parser('import'); p.add_argument('id'); p.add_argument('--project', required=True)
    args = parser.parse_args(argv)
    workspace = args.workspace.resolve()
    try:
        if args.command == 'doctor':
            result = {'workspace': str(workspace), 'config_present': (workspace / 'config.json').exists(),
                      'credential_present': bool(os.environ.get('RUNWAYML_API_SECRET')) or (workspace / '.secrets/runway.dpapi').exists(),
                      'authentication_tested': False, 'network_used': False}
        elif args.command == 'plan':
            result = plan(workspace, args.manifest)[3]
        elif args.command == 'budget':
            if not math.isfinite(args.usd) or args.usd < 0 or not args.note.strip():
                raise ValueError('Limite deve ser número finito não negativo e ter referência à autorização.')
            with locked(workspace):
                config = read(workspace / 'config.json')
                config.update(budget_usd=args.usd, budget_authorization={'note': args.note, 'at': now()})
                save(workspace / 'config.json', config)
            result = {'budget_usd': args.usd, 'reserved_usd': total_reserved(workspace)}
        elif args.command == 'submit':
            result = submit(workspace, args.manifest, args.approve_upload)
        elif args.command == 'sync':
            result = sync(workspace, args.id, args.wait)
        elif args.command == 'attach':
            with locked(workspace):
                path = workspace / 'jobs' / identifier(args.id) / 'job.json'
                job = read(path)
                if job.get('task_id'):
                    raise ValueError('Já existe um ID remoto associado. Não será substituído.')
                job.update(task_id=identifier(args.task_id), status='PENDING', attached_at=now())
                save(path, job)
            result = {'id': args.id, 'status': 'PENDING'}
        else:
            result = import_clip(workspace, args.id, args.project)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        # Avoid displaying URLs (signed downloads) or raw transport messages.
        message = str(error) if isinstance(error, ValueError) else f'Falha local: {type(error).__name__}. Confira arquivos e configuração.'
        print(json.dumps({'error': message}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
```

#### Arquivo: scripts/test_runway_video.py

```python
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import date
import runway_video as client


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        client.save(self.root / 'config.json', {
            'budget_usd': 1, 'budget_authorization': {'note': 'test-only'},
            'pricing_checked': date.today().isoformat(), 'usd_per_credit': 0.01,
            'credits_per_second': {'gen4.5': 12, 'gen4_turbo': 5}})
        (self.root / 'frame.png').write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(32))
        self.manifest = self.root / 'scene.json'
        client.save(self.manifest, {'id': 'scene', 'image': 'frame.png', 'model': 'gen4.5',
            'duration': 5, 'ratio': '720:1280', 'prompt': 'Camera moves slowly.',
            'timeline': {'from_frame': 30, 'fps': 30}})

    def tearDown(self):
        self.temp.cleanup()

    def test_no_network_in_plan(self):
        with patch.object(client, 'api', side_effect=AssertionError('network')):
            summary = client.plan(self.root, self.manifest)[3]
        self.assertEqual(summary['estimated_usd'], 0.6)
        self.assertFalse(summary['network_used'])

    def test_budget_and_upload_gate_before_network(self):
        with patch.object(client, 'api') as network:
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, False)
            config = client.read(self.root / 'config.json')
            config['budget_usd'] = 0
            client.save(self.root / 'config.json', config)
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, True)
            network.assert_not_called()

    def test_timeout_never_resubmits_and_reserves_cost(self):
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', side_effect=ValueError('timeout')) as network:
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, True)
            result = client.submit(self.root, self.manifest, True)
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(network.call_count, 1)
            self.assertEqual(client.total_reserved(self.root), 0.6)

    def test_generate_resume_import_and_duplicate_id(self):
        mp4 = b'\x00\x00\x00\x18ftypmp42' + bytes(64)
        def fake_download(url, dest):
            dest.write_bytes(mp4)
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', return_value={'id': 'remote-123'}) as network:
            client.submit(self.root, self.manifest, True)
            client.submit(self.root, self.manifest, True)
            self.assertEqual(network.call_count, 1)
            body = network.call_args.args[3]
            self.assertTrue(body['promptImage'].startswith('data:image/png;base64,'))
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', return_value={'status': 'SUCCEEDED', 'output': ['https://example.com/clip.mp4']}), patch.object(client, 'download', side_effect=fake_download):
            result = client.sync(self.root, 'scene')
        self.assertTrue(Path(result['file']).exists())
        project = self.root / 'remotion'
        (project / 'src').mkdir(parents=True)
        (project / 'src/AiVideoLayer.tsx').write_text('test fixture')
        client.import_clip(self.root, 'scene', project)
        client.import_clip(self.root, 'scene', project)
        clips = client.read(project / 'src/ai-video-manifest.json')
        self.assertEqual(len(clips), 1)
        self.assertEqual(clips[0]['from'], 30)
        self.assertEqual(clips[0]['durationInFrames'], 150)
        self.assertEqual((project / 'public/ai-video/scene.mp4').read_bytes(), mp4)
        job = client.read(self.root / 'jobs/scene/job.json')
        self.assertEqual(job['output_sha256'], hashlib.sha256(mp4).hexdigest())
        self.assertNotIn('example.com', json.dumps(job))

    def test_budget_is_cumulative_and_id_changes_are_rejected(self):
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', return_value={'id': 'remote'}):
            client.submit(self.root, self.manifest, True)
        spec = client.read(self.manifest)
        spec['prompt'] = 'Changed scene'
        client.save(self.manifest, spec)
        with self.assertRaises(ValueError):
            client.submit(self.root, self.manifest, True)
        spec['id'] = 'second-scene'
        client.save(self.manifest, spec)
        with self.assertRaises(ValueError):
            client.submit(self.root, self.manifest, True)

    def test_active_lock_blocks_submission(self):
        with client.locked(self.root):
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, True)


if __name__ == '__main__':
    unittest.main()
```
