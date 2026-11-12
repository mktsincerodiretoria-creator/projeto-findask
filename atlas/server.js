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
const CLAUDE = process.env.ATLAS_CLAUDE || 'claude';
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
);

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
        const m = /^ABRIR\s*:(.+)$/is.exec(pend.slice(i + 2, f));
        if (m) aoAcao(m[1]);
        pend = pend.slice(f + 2);
      }
      const segura = pend.endsWith('[') ? pend.length - 1 : pend.length;
      if (segura > 0) { aoTexto(pend.slice(0, segura)); pend = pend.slice(segura); }
    },
    fim() { if (pend && !pend.startsWith('[[')) aoTexto(pend); pend = ''; },
  };
}

// ---------- Conversa com o Claude ----------
function perguntar(texto, enviar) {
  return new Promise((resolver) => {
    if (Date.now() - sessao.ultimoUso > SESSAO_EXPIRA_MS) sessao.id = null;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt-file', PERSONA_GERADA,
      '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch',
      '--strict-mcp-config', '--model', String(cfg.modelo || 'sonnet').replace(/[^\w.\-\[\]]/g, '')];
    if (sessao.id) args.push('--resume', sessao.id);

    const filho = spawn(CLAUDE, args, { cwd: DIR, shell: WIN, windowsHide: true });
    const filtro = criarFiltro((t) => enviar('texto', { t }), (alvo) => enviar('acao', { alvo, ok: abrir(alvo) }));
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
    filho.on('close', (codigo) => {
      filtro.fim();
      if (resultado && resultado.session_id && !resultado.is_error) {
        sessao = { id: resultado.session_id, ultimoUso: Date.now() };
      }
      const falhou = !resultado || resultado.is_error || codigo !== 0;
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
    filho.stdin.end(`[Agora: ${agora}]\n${texto}`);
  });
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
    }));
  }
  if (req.method === 'POST' && rota === '/nova-conversa') {
    sessao = { id: null, ultimoUso: 0 };
    res.writeHead(204); return res.end();
  }
  if (req.method === 'POST' && rota === '/falar') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 20000) req.destroy(); });
    req.on('end', async () => {
      let texto = '';
      try { texto = String(JSON.parse(corpo).texto || '').trim(); } catch {}
      if (!texto) { res.writeHead(400); return res.end('sem texto'); }
      if (ocupado) { res.writeHead(409); return res.end('ocupado'); }
      ocupado = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const enviar = (tipo, dados) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
      log('pedido:', texto);
      try {
        let r = await perguntar(texto, enviar);
        if (!r.ok && sessao.id) { sessao.id = null; r = await perguntar(texto, enviar); } // sessao antiga invalida
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
  if (e.code === 'EADDRINUSE') { log('ja estava rodando; so abrindo a janela'); abrirJanela(); setTimeout(() => process.exit(0), 500); }
  else { log('erro do servidor:', e.message); process.exit(1); }
});
servidor.listen(PORTA, '127.0.0.1', () => { log(`${cfg.nome} online em ${URL_LOCAL}`); abrirJanela(); });
