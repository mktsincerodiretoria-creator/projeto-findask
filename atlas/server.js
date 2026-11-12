// Atlas - assistente de voz local. Sem dependencias: so Node.js + Claude Code.
// O navegador cuida do microfone e da voz; este servidor conversa com o Claude
// usando o login do Claude Code (o plano do usuario, sem chave de API).
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const PORTA = Number(process.env.ATLAS_PORTA || cfg.porta || 7717);
const URL_LOCAL = `http://localhost:${PORTA}`;
const WIN = process.platform === 'win32';
// Um erro inesperado nunca pode derrubar o assistente: registra e segue rodando
process.on('uncaughtException', (e) => { try { log('ERRO inesperado:', e && e.stack || e); } catch {} });
process.on('unhandledRejection', (e) => { try { log('ERRO inesperado (promessa):', e && e.stack || e); } catch {} });

// Acha o Claude Code mesmo quando o PATH do Windows ainda nao foi atualizado depois da instalacao
function acharClaude() {
  if (process.env.ATLAS_CLAUDE) return process.env.ATLAS_CLAUDE;
  if (!WIN) return 'claude';
  const cand = [];
  for (const d of (process.env.PATH || '').split(';')) if (d) cand.push(path.join(d, 'claude.exe'), path.join(d, 'claude.cmd'));
  cand.push(path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
    path.join(path.dirname(process.execPath), 'claude.cmd'));
  return cand.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
const SESSAO_EXPIRA_MS = 30 * 60 * 1000;

const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const programas = {};
for (const [nome, alvo] of Object.entries(cfg.programas || {})) programas[semAcento(nome)] = alvo;

// Prompt de sistema gerado a partir de persona.md + config.json
const PERSONA_GERADA = '.persona-gerada.md';
fs.writeFileSync(
  path.join(DIR, PERSONA_GERADA),
  fs.readFileSync(path.join(DIR, 'persona.md'), 'utf8')
    .replace(/{{NOME}}/g, cfg.nome)
    .replace(/{{PROGRAMAS}}/g, Object.keys(cfg.programas || {}).join(', ') || 'nenhum')
    .replace(/{{LOJAS}}/g, Object.keys(cfg.lojas || {}).join(', ') || 'nenhuma')
    + (cfg.agente && cfg.agente.ativo ? '\n' + fs.readFileSync(path.join(DIR, 'persona-agente.md'), 'utf8') : '')
);

// Segredos (chave da ElevenLabs) ficam so neste computador, fora do config.json
const ARQ_SEGREDOS = path.join(DIR, 'segredos.json');
let segredos = {};
try { segredos = JSON.parse(fs.readFileSync(ARQ_SEGREDOS, 'utf8')); } catch {}
const el = Object.assign({ voz: 'nPczCjzI2devNBz1zQrb', modelo: 'eleven_flash_v2_5' }, cfg.elevenlabs || {});
const EL_BASE = process.env.ATLAS_ELEVENLABS_URL || 'https://api.elevenlabs.io';
const chaveEl = () => process.env.ELEVENLABS_API_KEY || segredos.elevenlabs || '';
const vozEl = () => segredos.elevenlabsVoz || el.voz;

// Modo agente (opcional): o Atlas deixa de so conversar e passa a comandar o Claude Code neste computador
const ag = Object.assign({ ativo: false, pasta: '', permissao: 'acceptEdits', chrome: false }, cfg.agente || {});
if (!['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'].includes(ag.permissao)) ag.permissao = 'acceptEdits';
const PASTA_AGENTE = ag.ativo ? (ag.pasta || path.join(os.homedir(), 'Atlas-trabalho')) : DIR;
if (ag.ativo) fs.mkdirSync(PASTA_AGENTE, { recursive: true });

// Fotos e arquivos enviados pela janela ficam nesta pasta, para o Claude ler
const PASTA_ANEXOS = path.join(DIR, 'anexos');
const LIMITE_ANEXO = 20 * 1024 * 1024;
fs.mkdirSync(PASTA_ANEXOS, { recursive: true });
function caminhosDosAnexos(ids) {
  return (Array.isArray(ids) ? ids : []).slice(0, 10).map((id) => path.join(PASTA_ANEXOS, path.basename(String(id))))
    .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

let sessao = { id: null, ultimoUso: 0 };
let ocupado = false;

function log(...a) {
  const linha = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  process.stdout.write(linha);
  try { fs.appendFileSync(path.join(DIR, 'atlas.log'), linha); } catch {}
}

// ---------- Acoes no computador ----------
function abrir(alvoBruto) {
  const alvo = String(alvoBruto).trim();
  let destino = programas[semAcento(alvo)] || alvo;
  let ehUrl = false;
  try { ehUrl = ['http:', 'https:'].includes(new URL(destino).protocol); } catch {}
  if (!ehUrl && !programas[semAcento(alvo)]) {
    log('acao recusada (alvo nao cadastrado):', alvo);
    return false;
  }
  log('abrindo:', destino);
  if (!WIN) return true; // fora do Windows apenas registra (usado nos testes)
  const filho = ehUrl
    ? spawn('rundll32', ['url.dll,FileProtocolHandler', destino], { detached: true, stdio: 'ignore' })
    : spawn('cmd', ['/c', 'start', '', destino], { detached: true, stdio: 'ignore', windowsHide: true });
  filho.on('error', (e) => log('erro ao abrir:', e.message));
  filho.unref();
  return true;
}

// ---------- Navegadores das lojas (perfis do Chrome) ----------
function acharChrome() {
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']].filter(Boolean);
  return pf.map((p) => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe')).find((p) => fs.existsSync(p)) || null;
}
// Le os perfis que existem no Chrome deste computador: pasta interna -> nome que aparece no Chrome
function lerPerfisChrome() {
  const base = process.env.ATLAS_CHROME_DADOS || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(base, 'Local State'), 'utf8')).profile.info_cache;
    return Object.entries(cache).map(([dir, i]) => ({ dir, nome: String(i.name || i.shortcut_name || dir) }));
  } catch { return []; }
}
const lojas = Object.entries(cfg.lojas || {}).map(([nome, l]) => ({
  nome, perfil: semAcento(l.perfil || nome), paginas: Array.isArray(l.paginas) ? l.paginas : [],
  apelidos: [nome, ...(l.apelidos || [])].map(semAcento),
}));
function acharLoja(falado) {
  const f = semAcento(falado).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return lojas.find((l) => l.apelidos.includes(f))
    || [...lojas].sort((a, b) => b.nome.length - a.nome.length).find((l) => l.apelidos.some((a) => f.includes(a)));
}
// Casa a loja com o perfil do Chrome pelo nome; prefere o nome igual, depois o mais curto que contenha o texto
function acharPerfil(loja, perfis) {
  const cand = perfis.map((p) => ({ p, n: semAcento(p.nome).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() }));
  const igual = cand.find((c) => c.n === loja.perfil || c.p.dir.toLowerCase() === loja.perfil);
  if (igual) return igual.p;
  const palavras = loja.perfil.split(' ');
  const contem = cand.filter((c) => palavras.every((w) => c.n.split(' ').includes(w))).sort((a, b) => a.n.length - b.n.length);
  return contem.length ? contem[0].p : null;
}
function abrirNavegador(pedido) {
  const [alvoBruto, urlExtra] = String(pedido).split('|').map((x) => x.trim());
  const perfis = lerPerfisChrome();
  const todas = /^(todas|todos|tudo)$/.test(semAcento(alvoBruto));
  const escolhidas = todas ? lojas : [acharLoja(alvoBruto)].filter(Boolean);
  if (!escolhidas.length) { log('navegador: loja nao cadastrada:', alvoBruto); return { ok: false, detalhe: `Loja "${alvoBruto}" não cadastrada no config.json.` }; }
  const chrome = acharChrome();
  const abertas = [], faltando = [];
  for (const loja of escolhidas) {
    const perfil = acharPerfil(loja, perfis);
    if (!perfil) { faltando.push(loja.nome); continue; }
    const urls = [...loja.paginas, ...(urlExtra ? [urlExtra] : [])].filter((u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } });
    log('abrindo navegador:', loja.nome, '->', perfil.nome, `(${perfil.dir})`, urls.join(' '));
    abertas.push(loja.nome);
    if (WIN && chrome) spawn(chrome, [`--profile-directory=${perfil.dir}`, ...urls], { detached: true, stdio: 'ignore' }).on('error', (e) => log('erro ao abrir o Chrome:', e.message)).unref();
  }
  if (WIN && !chrome) return { ok: false, detalhe: 'Não encontrei o Google Chrome neste computador.' };
  const detalhe = (abertas.length ? 'Navegador aberto: ' + abertas.join(', ') + '.' : '')
    + (faltando.length ? ` Sem perfil do Chrome com o nome de: ${faltando.join(', ')}. Perfis que existem: ${perfis.map((p) => p.nome).join(', ') || 'nenhum encontrado'}.` : '');
  return { ok: abertas.length > 0, detalhe };
}

// Separa o texto falavel das marcacoes [[ABRIR:...]] conforme o texto chega em pedacos
function criarFiltro(aoTexto, aoAcao) {
  let pend = '';
  return {
    receber(pedaco) {
      pend += pedaco;
      for (;;) {
        const i = pend.indexOf('[[');
        if (i === -1) break;
        const f = pend.indexOf(']]', i);
        if (f === -1) {
          if (i > 0) { aoTexto(pend.slice(0, i)); pend = pend.slice(i); }
          return;
        }
        if (i > 0) aoTexto(pend.slice(0, i));
        const m = /^(ABRIR|NAVEGADOR)\s*:(.+)$/is.exec(pend.slice(i + 2, f));
        if (m) aoAcao(m[1].toUpperCase(), m[2]);
        pend = pend.slice(f + 2);
      }
      const segura = pend.endsWith('[') ? pend.length - 1 : pend.length;
      if (segura > 0) { aoTexto(pend.slice(0, segura)); pend = pend.slice(segura); }
    },
    fim() { if (pend && !pend.startsWith('[[')) aoTexto(pend); pend = ''; },
  };
}

// ---------- Conversa com o Claude ----------
let chromeFalhou = false; // se a ligacao com o Chrome quebrar o Claude Code, segue sem ela ate reiniciar
function perguntar(texto, enviar, anexos = []) {
  return new Promise((resolver) => {
    if (Date.now() - sessao.ultimoUso > SESSAO_EXPIRA_MS) sessao.id = null;
    const claude = acharClaude();
    if (!claude) {
      log('Claude Code nao encontrado');
      return resolver({ ok: false, semClaude: true, detalhe: 'Claude Code não encontrado neste computador. Rode o instalar.bat de novo.' });
    }
    // .exe roda direto; o atalho .cmd do npm precisa do interpretador de comandos
    const viaShell = WIN && !/\.exe$/i.test(claude);
    const arqPersona = path.join(DIR, PERSONA_GERADA);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt-file', viaShell ? `"${arqPersona}"` : arqPersona,
      '--model', String(cfg.modelo || 'sonnet').replace(/[^\w.\-\[\]]/g, '')];
    if (ag.ativo) {
      // Claude Code completo: arquivos e comandos na pasta de trabalho, conectores da conta e, se ligado, o Claude no Chrome
      args.push('--permission-mode', ag.permissao);
      if (ag.chrome && !chromeFalhou) args.push('--chrome', '--allowedTools', 'mcp__claude-in-chrome'); // libera as ferramentas da extensao sem pergunta
    } else {
      // A leitura de arquivos so e liberada na vez em que o operador anexou algo
      const ferramentas = anexos.length ? 'WebSearch,WebFetch,Read' : 'WebSearch,WebFetch';
      args.push('--tools', ferramentas, '--allowedTools', ferramentas, '--strict-mcp-config');
    }
    if (sessao.id) args.push('--resume', sessao.id);

    const ambiente = Object.assign({}, process.env);
    const chavePath = Object.keys(ambiente).find((k) => k.toLowerCase() === 'path') || 'PATH';
    ambiente[chavePath] = path.dirname(process.execPath) + path.delimiter + (ambiente[chavePath] || ''); // garante o node para o atalho .cmd
    const filho = spawn(viaShell ? `"${claude}"` : claude, args, { cwd: PASTA_AGENTE, shell: viaShell, windowsHide: true, env: ambiente });
    filho.stdin.on('error', (e) => { erro += ' ' + e.message; }); // se o claude nao abrir, a escrita falha: nao pode derrubar o servidor
    const filtro = criarFiltro((t) => enviar('texto', { t }), (tipo, alvo) => {
      if (tipo === 'NAVEGADOR') { const r = abrirNavegador(alvo); enviar('acao', { alvo, ok: r.ok, detalhe: r.detalhe }); }
      else enviar('acao', { alvo, ok: abrir(alvo) });
    });
    let resto = '', falou = false, erro = '', resultado = null;

    filho.stdout.on('data', (d) => {
      resto += d.toString('utf8');
      const linhas = resto.split('\n');
      resto = linhas.pop();
      for (const l of linhas) {
        if (!l.trim()) continue;
        let ev; try { ev = JSON.parse(l); } catch { continue; }
        if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_delta'
            && ev.event.delta && ev.event.delta.type === 'text_delta') {
          falou = true;
          filtro.receber(ev.event.delta.text);
        } else if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_start'
            && ev.event.content_block && ev.event.content_block.type === 'server_tool_use' ||
            (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_start'
            && ev.event.content_block && ev.event.content_block.type === 'tool_use')) {
          enviar('status', { s: 'pesquisando' });
        } else if (ev.type === 'stream_event' && ev.event && ev.event.type === 'message_stop') {
          if (falou) filtro.receber(' ');
        } else if (ev.type === 'result') {
          resultado = ev;
        }
      }
    });
    filho.stderr.on('data', (d) => { erro += d.toString('utf8'); });
    filho.on('error', (e) => { erro += e.message; });
    // Se o Claude Code travar (por exemplo esperando login), encerra em vez de deixar o assistente preso
    const limite = setTimeout(() => { erro += ' Tempo esgotado: o Claude Code não respondeu.'; try { filho.kill(); } catch {} if (WIN && filho.pid) spawn('taskkill', ['/pid', String(filho.pid), '/t', '/f'], { stdio: 'ignore' }).on('error', () => {}); }, ag.ativo ? 14 * 60000 : 3 * 60000);
    filho.on('close', (codigo) => {
      clearTimeout(limite);
      filtro.fim();
      if (resultado && resultado.session_id && !resultado.is_error) {
        sessao = { id: resultado.session_id, ultimoUso: Date.now() };
      }
      const falhou = !resultado || resultado.is_error || codigo !== 0;
      if (falhou) log('claude terminou com falha:', `codigo ${codigo}`, (erro || '').slice(0, 300));
      if (falhou && !falou) {
        const detalhe = ((resultado && resultado.result) || erro || `codigo ${codigo}`).toString().slice(0, 400);
        log('falha do claude:', detalhe);
        resolver({ ok: false, detalhe });
      } else {
        if (!falou && resultado && resultado.result) enviar('texto', { t: String(resultado.result) });
        resolver({ ok: true });
      }
    });
    const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
    const notaAnexos = anexos.length
      ? `\n\n[O operador anexou ${anexos.length} arquivo(s). Abra cada um com a ferramenta Read antes de responder:\n${anexos.join('\n')}]`
      : '';
    filho.stdin.end(`[Agora: ${agora}]\n${texto}${notaAnexos}`);
  });
}

// Traduz o erro da ElevenLabs para uma instrucao clara
function explicarElevenLabs(status, detalhe) {
  const d = String(detalhe).toLowerCase();
  const formato = /^sk_/.test(chaveEl()) ? '' : ' A chave salva não começa com "sk_", então provavelmente não é uma chave de API: crie uma nova em elevenlabs.io, no menu Developers, em API Keys, e copie no momento em que ela aparece.';
  if (status === 401 && /missing_permissions/.test(d)) return 'A chave da ElevenLabs existe, mas está sem a permissão de Texto para Fala (Text to Speech). Crie outra chave com essa permissão liberada.';
  if (status === 401 && /quota/.test(d)) return 'Os créditos da ElevenLabs acabaram.';
  if (status === 401) return 'A ElevenLabs recusou a chave (chave inválida).' + formato;
  if (status === 404 || /voice_not_found/.test(d)) return 'A ElevenLabs não encontrou o ID da voz nesta conta. Confira o ID e se a voz foi salva em "Minhas vozes".';
  if (status === 402 || /payment|subscription|free_users|can_not_use/.test(d)) return 'O seu plano da ElevenLabs não permite usar esta voz pela API. É preciso um plano pago ou outra voz.';
  if (status === 429 || /quota_exceeded/.test(d)) return 'Limite ou créditos da ElevenLabs esgotados.';
  return `ElevenLabs respondeu ${status}: ${String(detalhe).slice(0, 200)}`;
}

// ---------- Servidor HTTP (somente local) ----------
function origemValida(req) {
  const hosts = [`localhost:${PORTA}`, `127.0.0.1:${PORTA}`];
  if (!hosts.includes(req.headers.host)) return false;
  const o = req.headers.origin;
  return !o || hosts.some((h) => o === `http://${h}`);
}

const servidor = http.createServer(async (req, res) => {
  if (!origemValida(req)) { res.writeHead(403); return res.end('proibido'); }
  const rota = req.url.split('?')[0];

  if (req.method === 'GET' && (rota === '/' || rota === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(DIR, 'public', 'index.html')));
  }
  if (req.method === 'GET' && rota === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      nome: cfg.nome, apelidos: cfg.apelidos || [cfg.nome], voz: cfg.voz || {},
      segundosDeContinuacao: cfg.segundosDeContinuacao || 8, saudacao: cfg.saudacao || '',
      neural: !!chaveEl(), vozNeural: vozEl(), agente: ag.ativo,
    }));
  }
  if (req.method === 'GET' && rota === '/voz') {
    // Voz neural: converte uma frase em audio pela ElevenLabs. A chave nunca sai deste servidor.
    const texto = (new URL(req.url, URL_LOCAL).searchParams.get('t') || '').slice(0, 1200);
    if (!chaveEl() || !texto) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nenhuma chave da ElevenLabs salva.'); }
    try {
      const corpo = { text: texto, model_id: el.modelo,
        voice_settings: { stability: el.estabilidade ?? 0.5, similarity_boost: el.semelhanca ?? 0.8, speed: el.velocidade ?? 0.95 } };
      if (/v2_5/.test(el.modelo)) corpo.language_code = 'pt';
      const r = await fetch(`${EL_BASE}/v1/text-to-speech/${encodeURIComponent(vozEl())}/stream?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': chaveEl(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(corpo) });
      if (!r.ok) {
        const detalhe = (await r.text()).slice(0, 300);
        log('elevenlabs falhou:', r.status, detalhe);
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(explicarElevenLabs(r.status, detalhe));
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      for await (const pedaco of r.body) res.write(pedaco);
      return res.end();
    } catch (e) {
      log('elevenlabs erro:', e.message);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não consegui alcançar a ElevenLabs (internet, antivírus ou firewall bloqueando api.elevenlabs.io).');
    }
  }
  if (req.method === 'POST' && rota === '/voz-neural') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        const d = JSON.parse(corpo);
        if (typeof d.chave === 'string' && d.chave.trim()) segredos.elevenlabs = d.chave.trim();
        if (d.chave === '') delete segredos.elevenlabs;
        if (typeof d.voz === 'string') { const v = d.voz.trim().replace(/[^\w-]/g, ''); if (v) segredos.elevenlabsVoz = v; else delete segredos.elevenlabsVoz; }
        fs.writeFileSync(ARQ_SEGREDOS, JSON.stringify(segredos, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ neural: !!chaveEl(), vozNeural: vozEl() }));
      } catch { res.writeHead(400); res.end('invalido'); }
    });
    return;
  }
  if (req.method === 'POST' && rota === '/anexo') {
    // Recebe o arquivo cru no corpo; o nome vem na URL
    const original = path.basename(new URL(req.url, URL_LOCAL).searchParams.get('nome') || 'arquivo').replace(/[^\w.\- ]/g, '_').slice(-80) || 'arquivo';
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${original}`;
    const destino = path.join(PASTA_ANEXOS, id);
    const saida = fs.createWriteStream(destino);
    let tamanho = 0, estourou = false;
    req.on('data', (d) => { tamanho += d.length; if (tamanho > LIMITE_ANEXO) { estourou = true; req.destroy(); saida.destroy(); } });
    req.pipe(saida);
    const falhar = (codigo, msg) => { fs.unlink(destino, () => {}); if (!res.headersSent) { res.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); } };
    req.on('close', () => { if (estourou) falhar(413, 'Arquivo grande demais (limite de 20 MB).'); });
    saida.on('error', () => falhar(500, 'Não consegui salvar o arquivo.'));
    saida.on('finish', () => { if (estourou) return; res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ id, nome: original })); });
    return;
  }
  if (req.method === 'POST' && rota === '/nova-conversa') {
    sessao = { id: null, ultimoUso: 0 };
    res.writeHead(204); return res.end();
  }
  if (req.method === 'POST' && rota === '/falar') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 20000) req.destroy(); });
    req.on('end', async () => {
      let texto = '', anexos = [];
      try { const d = JSON.parse(corpo); texto = String(d.texto || '').trim(); anexos = caminhosDosAnexos(d.anexos); } catch {}
      if (!texto && anexos.length) texto = 'Veja o que eu anexei e me diga o que é.';
      if (!texto) { res.writeHead(400); return res.end('sem texto'); }
      if (ocupado) { res.writeHead(409); return res.end('ocupado'); }
      ocupado = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const enviar = (tipo, dados) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
      log('pedido:', texto, anexos.length ? `(+${anexos.length} anexo)` : '');
      try {
        let r = await perguntar(texto, enviar, anexos);
        if (!r.ok && !r.semClaude && ag.ativo && ag.chrome && !chromeFalhou) {
          // Pode ter sido a ligacao com o Chrome: tenta de novo sem ela, para o assistente nao ficar mudo
          chromeFalhou = true; log('falhou com --chrome; tentando sem:', r.detalhe);
          const r2 = await perguntar(texto, enviar, anexos);
          if (r2.ok) enviar('acao', { ok: false, detalhe: 'A ligação com o Claude no Chrome falhou (' + String(r.detalhe).slice(0, 200) + '). Respondi sem ela.' });
          else chromeFalhou = false;
          r = r2;
        }
        if (!r.ok && !r.semClaude && sessao.id) { sessao.id = null; r = await perguntar(texto, enviar, anexos); } // sessao antiga invalida
        if (!r.ok) enviar('erro', { detalhe: r.detalhe });
      } catch (e) {
        enviar('erro', { detalhe: e.message });
      } finally {
        ocupado = false;
        enviar('fim', {});
        res.end();
      }
    });
    return;
  }
  res.writeHead(404); res.end('nao encontrado');
});

// ---------- Janela do assistente ----------
function abrirJanela() {
  if (!WIN || process.env.ATLAS_SEM_JANELA) return;
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']].filter(Boolean);
  const chrome = pf.map((p) => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  const edge = pf.map((p) => path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  const ordem = cfg.navegador === 'edge' ? edge : cfg.navegador === 'chrome' ? chrome : [...chrome, ...edge];
  const exe = ordem.find((p) => fs.existsSync(p));
  if (!exe) { log('Chrome/Edge nao encontrado. Abra manualmente:', URL_LOCAL); return; }
  const perfil = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Atlas', 'perfil-' + path.basename(exe, '.exe'));
  fs.mkdirSync(perfil, { recursive: true });
  spawn(exe, [`--app=${URL_LOCAL}`, `--user-data-dir=${perfil}`, '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--window-size=480,760'], { detached: true, stdio: 'ignore' }).unref();
  log('janela aberta com', exe);
}

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { log('ja estava rodando; so abrindo a janela'); abrirJanela(); setTimeout(() => process.exit(0), 1500); }
  else { log('erro do servidor:', e.message); process.exit(1); }
});
try { for (const f of fs.readdirSync(PASTA_ANEXOS)) { const p = path.join(PASTA_ANEXOS, f); if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.unlinkSync(p); } } catch {}
servidor.listen(PORTA, '127.0.0.1', () => { log(`${cfg.nome} online em ${URL_LOCAL}` + (ag.ativo ? ` | modo agente em ${PASTA_AGENTE} (${ag.permissao}${ag.chrome ? ', chrome' : ''})` : '')); abrirJanela(); });
