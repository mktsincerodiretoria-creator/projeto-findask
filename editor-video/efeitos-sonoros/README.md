# Efeitos sonoros cinematográficos (suspense)

Pacote de referência no estilo sério, sinistro e de trailer. Todos os sons foram **sintetizados do zero** pelo `sintetizar.py`, sem amostras de terceiros. Por isso podem ser usados em vídeos e anúncios sem licença. Os arquivos são WAV de 48 kHz e 24 bits, com picos entre −1 e −6 dBFS. Para ouvir todos em sequência, abra `demo-todos-os-efeitos.mp3`.

| Arquivo | Quando usar |
|---|---|
| `01-abertura-braam` | Abertura do vídeo, ou a primeira frase forte (o "BRAAM" grave de trailer) |
| `02-impacto-sub-drop` | Número ou revelação de impacto; corte seco para uma tela importante |
| `03-riser-tensao` | Os 3 a 5 segundos antes de revelar algo; termina em corte seco no ponto da revelação |
| `04-whoosh-transicao` | Troca de cena ou de tópico |
| `05-drone-suspense-loop` | Fundo contínuo das partes de explicação; fica embaixo da voz e pode tocar em loop |
| `06-pulso-batimento` | Momento de risco: "você está perdendo dinheiro e não percebe" |
| `07-stinger-revelacao` | Golpe metálico escuro: a virada, o "segredo" |
| `08-reverse-swell` | Sucção antes de um impacto; coloque o fim dele exatamente no `02` ou no `07` |
| `09-tique-taque-tensao` | Prazo, urgência, contagem |
| `10-entrada-texto-sutil` | Texto ou número aparecendo na tela, sem soar como desenho animado |

Combinação clássica de trailer: `03` (riser) ou `08` (swell) → corte seco → `02` ou `07` (impacto), com o `05` (drone) embaixo de tudo.

Mixagem: os efeitos devem ficar **abaixo da voz**, audíveis e sem distorcer. Como ponto de partida, deixe o drone de 18 a 24 dB abaixo da voz e os impactos de 6 a 10 dB abaixo, e ajuste de ouvido.

Para gerar variações: `python3 sintetizar.py pasta-de-saida` (precisa de `numpy` e `ffmpeg`). Mude a semente ou as frequências no script.

## Onde pegar versões profissionais gravadas

Sons sintetizados servem como referência e uso imediato. Para o nível de trailer de cinema, o ideal são bibliotecas gravadas e mixadas por profissionais. **Confira sempre a licença para uso comercial e em anúncios.**

**Gratuitas, com uso comercial:**
- **Sonniss – GameAudioGDC Bundle:** pacotes gratuitos e enormes, de qualidade profissional, com muito material cinematográfico, impactos e ambientes. Licença royalty-free.
- **Pixabay – Sound Effects:** grátis para uso comercial, sem atribuição. A qualidade varia: filtre pelos mais baixados.
- **Freesound:** confira a licença de cada arquivo. Prefira CC0; CC-BY exige crédito.

**Por assinatura (já incluem licença para redes sociais e anúncios):**
- **Artlist** (músicas e efeitos), **Epidemic Sound**, **Envato Elements** e **Motion Array**.

**Premium, nível cinema:**
- **BOOM Library:** as coleções *Cinematic Trailers* e *Cinematic Metal* são referência em trailer.
- **Soundly:** biblioteca e app, com plano gratuito limitado.

**Termos de busca, em inglês:** `cinematic braam`, `trailer hit`, `sub drop`, `cinematic riser`, `dark drone`, `tension stinger`, `reverse swell`, `cinematic whoosh`, `horror ambience`, `heartbeat tension`, `clock ticking tension`, `metal impact dark`.

**Referências de estilo para ouvir:** o "braam" dos trailers de *A Origem* (Inception); o tique-taque e a tensão contínua de *Dunkirk* (Hans Zimmer); as aberturas de *True Detective* e *Mindhunter*; documentários de true crime da Netflix.
