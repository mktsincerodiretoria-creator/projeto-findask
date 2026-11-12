# Atlas — assistente de voz

Assistente pessoal por voz para Windows. Liga junto com o computador, fica escutando o microfone e responde em voz alta quando você diz **"Atlas"**. O cérebro é o Claude, usando o login do Claude Code (o seu plano, sem chave de API).

## Instalar (uma vez só)

1. Baixe esta pasta `atlas` para o computador (por exemplo em `C:\Atlas`).
2. Dê dois cliques em **`instalar.bat`**.
3. Se o instalador abrir uma janela do Claude pedindo login, entre com a conta do seu plano, digite `/exit` e volte ao instalador.
4. Quando a janela verde do Atlas abrir, clique em **Permitir** no pedido de microfone.

O instalador coloca o Node.js, o Git e o Claude Code se faltarem, cria o atalho na área de trabalho e configura o Atlas para abrir sozinho a cada vez que o Windows iniciar.

## Usar

- Diga **"Atlas"** e, em seguida, o pedido. Pode ser tudo junto: "Atlas, que horas são?".
- Depois que ele responde, você tem 8 segundos para continuar a conversa sem repetir o nome.
- Diga **"Atlas, pare"** depois que ele terminar, ou aperte **Esc** / clique na esfera para interromper enquanto ele fala.
- Diga **"Atlas, nova conversa"** para ele esquecer o assunto atual.
- Também dá para digitar no campo de texto.

O que ele faz hoje: conversa, pesquisa na web e abre sites e programas ("Atlas, abre o Mercado Livre", "Atlas, pesquisa tal coisa no Google").

## Ajustar

- **Voz**: na janela, abra "Ajustes de voz" para trocar a voz, o tom (mais grave ou agudo) e a velocidade. Use "Testar voz".
- **Nome**: em `config.json`, troque `nome` e `apelidos` (as formas como o microfone pode entender o nome).
- **Programas e sites**: em `config.json`, na lista `programas`, adicione `"nome falado": "programa.exe ou https://site"`.
- **Personalidade**: edite `persona.md`.
- **Modelo**: em `config.json`, `modelo` pode ser `haiku` (mais rápido), `sonnet` ou `opus`.

Depois de mudar `config.json` ou `persona.md`, rode `desinstalar.bat` e `instalar.bat` de novo (ou reinicie o computador).

## Se algo der errado

- **Não escuta**: confira se o microfone foi permitido (cadeado ao lado do endereço na janela) e se o microfone padrão do Windows é o certo. O reconhecimento de voz precisa de internet.
- **Escuta mas não entende o nome**: veja no texto cinza da janela como ele transcreve "Atlas" e acrescente essa forma em `apelidos`.
- **Voz feminina ou estranha**: em Configurações do Windows → Hora e idioma → Fala, adicione vozes de Português (Brasil); depois escolha em "Ajustes de voz". No Edge aparecem as vozes "Online (Natural)", como a Antonio; para usar o Edge, ponha `"navegador": "edge"` em `config.json`.
- **"Tive um problema para falar com o Claude"**: abra o Prompt de Comando, digite `claude` e refaça o login.
- **Diagnóstico**: rode `iniciar.bat` para ver as mensagens, ou abra `atlas.log`.

## Limites conhecidos

- O Atlas usa a cota do seu plano Claude, como qualquer uso do Claude Code.
- O áudio do microfone é transcrito pelo serviço de voz do navegador (Google no Chrome, Microsoft no Edge).
- Ele ainda não mexe em arquivos, e-mail ou agenda; só conversa, pesquisa e abre sites/programas.
