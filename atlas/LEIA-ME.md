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

## Voz neural (ElevenLabs)

1. Crie uma conta em elevenlabs.io e gere uma chave de API (no perfil, em "API Keys").
2. Na janela do Atlas, abra "Ajustes de voz", cole a chave em "Voz neural (ElevenLabs)" e clique em **Salvar voz neural**.
3. Para trocar a voz, escolha uma na biblioteca de vozes da ElevenLabs, copie o **ID da voz** e cole no campo "ID da voz".

A chave fica só neste computador, no arquivo `segredos.json`. Se a ElevenLabs falhar (chave errada, créditos esgotados, sem internet), o Atlas volta sozinho para a voz do Windows e avisa na tela. A ElevenLabs cobra por caracteres falados, à parte do plano Claude. Não use vozes clonadas de atores ou de outras pessoas sem autorização.

## Modo agente (comandar o Claude Code pela voz)

Por padrão o Atlas só conversa, pesquisa e abre sites. No modo agente ele passa a comandar o Claude Code neste computador: cria e edita arquivos, roda tarefas e usa os conectores da sua conta. Para ligar, em `config.json`:

```json
"agente": { "ativo": true, "pasta": "", "permissao": "acceptEdits", "chrome": false }
```

- `pasta`: onde ele trabalha. Vazio usa `Atlas-trabalho` na sua pasta de usuário. No Windows, escreva o caminho com barras duplas, por exemplo `"C:\\Projetos"`.
- `permissao`: `acceptEdits` deixa criar e editar arquivos na pasta, mas bloqueia comandos que exigiriam aprovação. `bypassPermissions` libera tudo sem perguntar; como o pedido vem por voz e pode ser entendido errado, só use se aceitar esse risco.
- `chrome`: `true` liga a integração com a extensão Claude no Chrome, para ele agir no navegador. Exige a extensão instalada e logada. Esta parte não foi testada.

Depois de mudar, reinicie o Atlas. O Cowork não tem uma forma de ser comandado por fora; o Atlas não o controla.

## Navegadores das lojas

O Atlas abre o Chrome no perfil de cada loja: "Atlas, abre o navegador da Núcleo" ou "Atlas, iniciar os trabalhos" (abre todos). As lojas ficam em `lojas`, no `config.json`:

- `perfil`: parte do nome do perfil como aparece no Chrome (no círculo do canto superior direito). O Atlas casa pelo nome.
- `apelidos`: formas como você fala o nome da loja.
- `paginas`: endereços que devem abrir junto, por exemplo `["https://seller.shopee.com.br"]`.

Se uma loja não abrir, a tela mostra os nomes dos perfis que o Atlas encontrou; ajuste `perfil` para bater com um deles.

Para o Atlas também **agir dentro** do navegador pelo Claude no Chrome, ligue `"ativo": true` e `"chrome": true` em `agente`. Isso é experimental: a documentação do Claude Code só descreve a escolha entre vários navegadores no modo interativo (comando `/chrome`, "Select browser"), então o Atlas pode agir apenas no navegador escolhido lá.

## Se algo der errado

- **Não escuta**: confira se o microfone foi permitido (cadeado ao lado do endereço na janela) e se o microfone padrão do Windows é o certo. O reconhecimento de voz precisa de internet.
- **Escuta mas não entende o nome**: veja no texto cinza da janela como ele transcreve "Atlas" e acrescente essa forma em `apelidos`.
- **Voz feminina ou estranha**: em Configurações do Windows → Hora e idioma → Fala, adicione vozes de Português (Brasil); depois escolha em "Ajustes de voz". No Edge aparecem as vozes "Online (Natural)", como a Antonio; para usar o Edge, ponha `"navegador": "edge"` em `config.json`.
- **"Tive um problema para falar com o Claude"**: abra o Prompt de Comando, digite `claude` e refaça o login.
- **Diagnóstico**: rode `iniciar.bat` para ver as mensagens, ou abra `atlas.log`.

## Limites conhecidos

- O Atlas usa a cota do seu plano Claude, como qualquer uso do Claude Code.
- O áudio do microfone é transcrito pelo serviço de voz do navegador (Google no Chrome, Microsoft no Edge).
- Sem o modo agente, ele só conversa, pesquisa e abre sites/programas.
