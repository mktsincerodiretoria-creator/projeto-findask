# CorteFácil — editor inteligente de vídeo

Um "CapCut simplificado" para vídeos falados. Você envia o vídeo e ele:

- **Corta os silêncios** entre as falas automaticamente (mantendo um pequeno respiro para não ficar robótico).
- **Encontra erros de fala** e explica cada um:
  - hesitações e vícios ("é…", "hã", "hum"; "né" e "tipo" viram sugestão);
  - palavras repetidas ("eu eu vou") e palavras cortadas ("prob… problema");
  - **frases regravadas**: quando você erra e fala a frase de novo, fica só a última tentativa;
  - **erros assumidos**: quando você diz "desculpa", "pera", "vou de novo"… e recomeça;
  - palavras que o reconhecimento de voz não entendeu bem (para você conferir).
- **Revisão inteligente com IA (opcional)**: o Claude lê a fala inteira e aponta regravações,
  correções ("custa 50, quer dizer, 40"), falsos inícios e comentários de bastidor, dizendo
  qual foi o erro em cada corte.
- **Coloca legenda** sincronizada (estilo frase ou curta, estilo Reels, com destaque da palavra falada).
- **Exporta em alta resolução** (original, 1080p, 2K ou 4K) com a legenda gravada no vídeo e/ou em `.srt`.

Tudo roda **no seu computador**: o vídeo não é enviado para nenhum servidor (só o texto da fala
vai para a IA, e apenas se você ativar a revisão inteligente).

## Instalação

### Windows (o jeito fácil)

1. Baixe o arquivo **`Instalar CorteFacil.bat`** (gerado com `python empacotar.py`, fica em `dist/`).
2. Dê dois cliques nele. Se aparecer "O Windows protegeu o computador", clique em
   **Mais informações → Executar assim mesmo**.
3. Ele instala tudo sozinho em `%LOCALAPPDATA%\CorteFacil` (fora do OneDrive, sem pedir
   administrador), cria o ícone **CorteFácil** na Área de Trabalho e abre o editor.
   Na primeira vez leva uns 5 a 10 minutos (baixa cerca de 1 GB).
4. Das próximas vezes, clique no ícone **CorteFácil** na Área de Trabalho.

Para atualizar, rode um `Instalar CorteFacil.bat` mais novo: seus projetos são mantidos.

### Mac

```bash
brew install python ffmpeg
./iniciar.sh
```

### Linux

```bash
sudo apt install python3 python3-venv ffmpeg
./iniciar.sh
```

O editor abre em <http://127.0.0.1:8765>. Para sair, feche a janela do terminal.

> Na **primeira análise** o programa baixa o modelo de reconhecimento de voz
> (Whisper, de 75 MB a 3 GB conforme o modelo escolhido). Depois funciona offline.
> Se o computador tiver placa de vídeo NVIDIA, ela é usada automaticamente.

## Como usar

1. **Arraste o vídeo** para a tela inicial. Em "Opções da análise" você ajusta a pausa mínima,
   o respiro e quais erros procurar.
2. Espere a análise. Você cai no editor:
   - **Erros e cortes**: a lista de tudo que foi encontrado, com o motivo. Clique para ir até o
     ponto, ▶ para ouvir o trecho, e a chavinha para ligar/desligar o corte.
   - **Transcrição**: o texto da fala, com as palavras cortadas riscadas. Selecione palavras
     para cortar ou restaurar; **duplo clique** corrige o texto da legenda.
   - **Legenda**: estilo, fonte, tamanho, cores, posição, maiúsculas, destaque da palavra.
   - **Ajustes**: mude os valores e clique em **Aplicar ajustes** (instantâneo), rode a
     **revisão com IA** ou transcreva de novo com um modelo mais preciso.
   - **Linha do tempo**: clique para navegar, **arraste para selecionar** e aperte Delete para
     cortar um trecho qualquer.
   - "**Prévia com cortes**" ligado = o player pula os cortes, como vai ficar o vídeo final.
3. Clique em **Exportar**, escolha resolução, qualidade e legenda, e baixe o vídeo.

Atalhos: **Espaço** tocar/pausar · **← →** voltar/avançar 1 s (Shift = 5 s) · **Delete** cortar
seleção · **Ctrl+Z** desfazer.

## Revisão inteligente com IA (opcional)

Crie uma chave em <https://console.anthropic.com/> e cole em **⚙ Configurações** (ou defina a
variável de ambiente `ANTHROPIC_API_KEY`). A revisão usa o modelo `claude-opus-5-5`; um vídeo curto custa
alguns centavos de dólar. Sem a chave, todos os outros recursos funcionam.

## Dicas

- Sobrou pausa demais? Diminua **Pausa mínima**. Ficou picotado? Aumente o **Respiro**.
- Ruído de fundo impedindo o corte dos silêncios? Aumente a **Sensibilidade**.
- Legenda com palavras erradas? Use um modelo maior ("medium" ou "large-v3") em Ajustes →
  Transcrever de novo, ou corrija com duplo clique na Transcrição.

## Para desenvolvedores

```
app/
  main.py         API (FastAPI) e fila de tarefas
  analise.py      detecção de silêncios, vícios, repetições e regravações
  ia.py           revisão com o Claude (saída estruturada)
  transcricao.py  faster-whisper com tempo por palavra
  legendas.py     agrupamento, SRT e ASS (legenda gravada)
  exportar.py     cortes + legenda + codificação com ffmpeg
  midia.py        ffprobe, extração de áudio, prévia, forma de onda
static/           interface (HTML/CSS/JS puro, sem build)
testes/           pytest (o teste ponta a ponta gera um vídeo com espeak-ng)
```

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest testes
```

Os projetos ficam em `dados/projetos/` (mude com a variável `EDITOR_DADOS`).
