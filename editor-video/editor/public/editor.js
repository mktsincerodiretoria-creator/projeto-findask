"use strict";

// ---------- Elementos ----------
const $ = (id) => document.getElementById(id);
const el = {
  seletor: $("seletor"),
  arquivo: $("arquivo"),
  salvo: $("salvo"),
  exportar: $("exportar"),
  video: $("video"),
  vazio: $("vazio"),
  play: $("play"),
  tempoAtual: $("tempo-atual"),
  tempoTotal: $("tempo-total"),
  resumo: $("resumo"),
  excluir: $("excluir"),
  cortar: $("cortar"),
  desfazer: $("desfazer"),
  refazer: $("refazer"),
  zoom: $("zoom"),
  timeline: $("timeline"),
  largura: $("largura"),
  canvas: $("canvas"),
  mensagem: $("mensagem"),
  faixa: $("aviso-exportacao"),
  textoExp: $("texto-exportacao"),
  barraExp: $("barra-exportacao"),
  baixar: $("baixar"),
};
const ctx = el.canvas.getContext("2d");

const MARGEM = 12; // espaço antes do 0 e depois do fim da timeline
const ALT_REGUA = 24;
const PX_POR_QUADRO_MAX = 18; // zoom máximo: cada quadro com 18 px
const ONDA_POR_SEG = 100;

const cores = {
  fundo: "#1b1d22",
  regua: "#24272e",
  riscos: "#5a606b",
  textoRegua: "#9aa0a8",
  clipe: "#2d3e5c",
  borda: "#4a5a78",
  onda: "#7fb0ff",
  fundoOnda: "#1f2a3d",
  sel: "#f5b400",
  agulha: "#ff3b3b",
};

// ---------- Estado ----------
const est = {
  nome: null,
  info: null,
  clipes: [], // trechos mantidos, em segundos do vídeo original, na ordem
  acum: [], // início de cada trecho na timeline
  total: 0, // duração final
  sel: -1, // trecho selecionado
  t: 0, // posição da agulha na timeline (segundos)
  pxs: 50, // pixels por segundo
  historico: [],
  futuro: [],
  onda: null,
  mini: null,
  miniImg: null,
  tocando: false,
  idxTocando: 0,
  hoverX: null,
  arrastando: false,
  token: 0,
};

// ---------- Utilidades ----------
const dois = (n) => String(n).padStart(2, "0");

function formatar(seg, centesimos = true) {
  const tot = Math.max(0, Math.round(seg * 100));
  const cc = tot % 100;
  const s = Math.floor(tot / 100) % 60;
  const m = Math.floor(tot / 6000) % 60;
  const h = Math.floor(tot / 360000);
  const base = h ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
  return centesimos ? `${base}.${dois(cc)}` : base;
}

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const quadro = () => 1 / (est.info?.fps || 30);
const noQuadro = (s) => Math.round(s / quadro()) * quadro();

let temporizadorMsg;
function aviso(texto) {
  el.mensagem.textContent = texto;
  el.mensagem.classList.add("visivel");
  clearTimeout(temporizadorMsg);
  temporizadorMsg = setTimeout(() => el.mensagem.classList.remove("visivel"), 2600);
}

async function api(url, opcoes) {
  const r = await fetch(url, opcoes);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
}

function guardar(chave, valor) {
  try {
    localStorage.setItem(chave, valor);
  } catch {}
}
function ler(chave) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

// ---------- Trechos e tempo ----------
function recalcular() {
  let soma = 0;
  est.acum = est.clipes.map((c) => {
    const inicio = soma;
    soma += c.fim - c.inicio;
    return inicio;
  });
  est.total = soma;
  if (est.sel >= est.clipes.length) est.sel = -1;
}

// Converte a posição na timeline para {trecho, segundo do vídeo original}.
function localizar(t) {
  const n = est.clipes.length;
  for (let i = 0; i < n; i++) {
    const c = est.clipes[i];
    const dur = c.fim - c.inicio;
    if (t < est.acum[i] + dur || i === n - 1) {
      return { i, s: c.inicio + limitar(t - est.acum[i], 0, dur) };
    }
  }
  return { i: 0, s: 0 };
}

// Ajusta a posição para cair exatamente num quadro do vídeo.
function ajustarAoQuadro(t) {
  if (!est.clipes.length) return 0;
  const { i, s } = localizar(limitar(t, 0, est.total));
  const c = est.clipes[i];
  return est.acum[i] + limitar(noQuadro(s), c.inicio, c.fim) - c.inicio;
}

// Pontos de corte (inícios de trecho) na timeline, incluindo início e fim.
function pontosDeCorte() {
  return [...est.acum, est.total];
}

// ---------- Posição, player e reprodução ----------
function irPara(t, { manterVisivel = true } = {}) {
  if (!est.info) return;
  est.t = ajustarAoQuadro(t);
  if (!est.tocando && est.clipes.length) {
    const { s } = localizar(est.t);
    if (Math.abs(el.video.currentTime - s) > 0.001) el.video.currentTime = s;
  }
  if (manterVisivel) mostrarAgulha();
  atualizarTela();
}

function tocar() {
  if (!est.info || !est.total) return;
  if (est.t >= est.total - quadro() / 2) est.t = 0;
  const { i, s } = localizar(est.t);
  est.idxTocando = i;
  el.video.currentTime = s;
  est.tocando = true;
  el.video.play().catch(() => pausar());
  atualizarTela();
  requestAnimationFrame(acompanhar);
}

function pausar() {
  if (!est.tocando) return;
  est.tocando = false;
  el.video.pause();
  atualizarTela();
}

// Durante a reprodução, pula os trechos excluídos.
function acompanhar() {
  if (!est.tocando) return;
  let i = est.idxTocando;
  let c = est.clipes[i];
  let s = el.video.currentTime;
  if (s >= c.fim - 0.02) {
    if (i + 1 < est.clipes.length) {
      i = ++est.idxTocando;
      c = est.clipes[i];
      el.video.currentTime = c.inicio;
      s = c.inicio;
    } else {
      pausar();
      est.t = est.total;
      atualizarTela();
      return;
    }
  }
  est.t = est.acum[i] + limitar(s - c.inicio, 0, c.fim - c.inicio);
  seguirAgulha();
  atualizarTela();
  requestAnimationFrame(acompanhar);
}

el.video.addEventListener("ended", () => {
  if (est.tocando) {
    pausar();
    est.t = est.total;
    atualizarTela();
  }
});

// ---------- Edição ----------
function registrar() {
  est.historico.push(JSON.stringify(est.clipes));
  if (est.historico.length > 300) est.historico.shift();
  est.futuro = [];
}

function cortar() {
  if (!est.info || !est.clipes.length) return;
  pausar();
  const { i, s: bruto } = localizar(est.t);
  const c = est.clipes[i];
  const s = noQuadro(bruto);
  if (s - c.inicio < quadro() * 0.999 || c.fim - s < quadro() * 0.999) {
    aviso("Já existe um corte neste ponto. Mova a agulha vermelha e corte de novo.");
    return;
  }
  registrar();
  est.clipes.splice(i, 1, { inicio: c.inicio, fim: s }, { inicio: s, fim: c.fim });
  est.sel = -1;
  mudou();
  est.t = est.acum[i + 1];
  aviso(`Cortado em ${formatar(est.t)}. Agora clique no trecho que quer excluir.`);
  atualizarTela();
}

function excluir() {
  if (!est.info) return;
  if (est.sel < 0) {
    aviso("Clique primeiro no trecho da timeline que você quer excluir.");
    return;
  }
  if (est.clipes.length === 1) {
    aviso("Este é o único trecho do vídeo. Corte antes para separar a parte que quer tirar.");
    return;
  }
  pausar();
  registrar();
  const inicio = est.acum[est.sel];
  const removido = est.clipes[est.sel].fim - est.clipes[est.sel].inicio;
  est.clipes.splice(est.sel, 1);
  est.sel = -1;
  mudou();
  irPara(Math.min(inicio, est.total));
  aviso(`Trecho de ${formatar(removido)} excluído. O resto do vídeo foi juntado.`);
}

function desfazer() {
  if (!est.historico.length) return;
  pausar();
  est.futuro.push(JSON.stringify(est.clipes));
  est.clipes = JSON.parse(est.historico.pop());
  est.sel = -1;
  mudou();
  irPara(est.t);
}

function refazer() {
  if (!est.futuro.length) return;
  pausar();
  est.historico.push(JSON.stringify(est.clipes));
  est.clipes = JSON.parse(est.futuro.pop());
  est.sel = -1;
  mudou();
  irPara(est.t);
}

function mudou() {
  const estavaAjustado = est.pxs <= pxMinimo() * 1.001;
  recalcular();
  if (estavaAjustado) ajustarZoom();
  else definirZoom(est.pxs);
  agendarSalvar();
}

// ---------- Salvamento automático ----------
let temporizadorSalvar = null;
let salvando = Promise.resolve();

function agendarSalvar() {
  el.salvo.textContent = "Alterações não salvas…";
  clearTimeout(temporizadorSalvar);
  temporizadorSalvar = setTimeout(salvarAgora, 600);
}

function salvarAgora() {
  if (temporizadorSalvar === null) return salvando;
  clearTimeout(temporizadorSalvar);
  temporizadorSalvar = null;
  const nome = est.nome;
  const corpo = JSON.stringify({ clipes: est.clipes });
  el.salvo.textContent = "Salvando…";
  salvando = fetch(`/api/projeto/${encodeURIComponent(nome)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: corpo,
    keepalive: corpo.length < 60000,
  })
    .then((r) => {
      if (!r.ok) throw new Error();
      if (est.nome === nome) el.salvo.textContent = "Salvo ✓";
    })
    .catch(() => {
      if (est.nome === nome) el.salvo.textContent = "⚠ Erro ao salvar";
    });
  return salvando;
}

window.addEventListener("beforeunload", () => salvarAgora());

// ---------- Zoom e rolagem ----------
function larguraVisivel() {
  return el.timeline.clientWidth;
}

function pxMinimo() {
  return Math.max(0.0001, (larguraVisivel() - MARGEM * 2) / Math.max(est.total, 0.001));
}

function pxMaximo() {
  return Math.max(pxMinimo(), (est.info?.fps || 30) * PX_POR_QUADRO_MAX);
}

function xDe(t) {
  return MARGEM + t * est.pxs - el.timeline.scrollLeft;
}

function tempoEm(x) {
  return (x + el.timeline.scrollLeft - MARGEM) / est.pxs;
}

function definirZoom(px, ancoraX = null) {
  const min = pxMinimo();
  const max = pxMaximo();
  if (ancoraX === null) {
    const xa = xDe(est.t);
    ancoraX = xa >= 0 && xa <= larguraVisivel() ? xa : larguraVisivel() / 2;
  }
  const tAncora = tempoEm(ancoraX);
  est.pxs = limitar(px, min, max);
  el.largura.style.width = `${MARGEM * 2 + est.total * est.pxs}px`;
  el.timeline.scrollLeft = tAncora * est.pxs + MARGEM - ancoraX;
  el.zoom.value = String(max > min ? Math.round((Math.log(est.pxs / min) / Math.log(max / min)) * 1000) : 0);
  desenhar();
}

function ajustarZoom() {
  definirZoom(pxMinimo(), 0);
  el.timeline.scrollLeft = 0;
}

function zoomPorFator(fator, ancoraX = null) {
  definirZoom(est.pxs * fator, ancoraX);
}

el.zoom.addEventListener("input", () => {
  const min = pxMinimo();
  const max = pxMaximo();
  definirZoom(min * Math.pow(max / min, Number(el.zoom.value) / 1000));
});

function mostrarAgulha() {
  const x = xDe(est.t);
  const w = larguraVisivel();
  if (x < 20 || x > w - 20) el.timeline.scrollLeft = est.t * est.pxs + MARGEM - w / 2;
}

function seguirAgulha() {
  const x = xDe(est.t);
  const w = larguraVisivel();
  if (x > w - 30 || x < 0) el.timeline.scrollLeft = est.t * est.pxs + MARGEM - w * 0.2;
}

el.timeline.addEventListener("scroll", desenhar);

el.timeline.addEventListener(
  "wheel",
  (e) => {
    if (!est.info) return;
    const rect = el.canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl + roda do mouse (ou pinça no trackpad) = zoom no ponto do mouse
      e.preventDefault();
      zoomPorFator(Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Roda do mouse sozinha = andar para os lados
      e.preventDefault();
      el.timeline.scrollLeft += e.deltaY;
    }
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  if (!est.info) return desenhar();
  const estavaAjustado = Number(el.zoom.value) === 0;
  if (estavaAjustado) ajustarZoom();
  else definirZoom(est.pxs);
});

// ---------- Mouse na timeline ----------
function trechoEm(t) {
  if (t < 0 || t > est.total) return -1;
  return localizar(t).i;
}

el.canvas.addEventListener("pointerdown", (e) => {
  if (!est.info || e.button !== 0) return;
  el.timeline.focus({ preventScroll: true });
  pausar();
  const rect = el.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const t = tempoEm(x);
  if (y > ALT_REGUA) est.sel = trechoEm(t); // clicar na faixa seleciona o trecho
  est.arrastando = true;
  el.canvas.setPointerCapture(e.pointerId);
  irPara(t, { manterVisivel: false });
});

el.canvas.addEventListener("pointermove", (e) => {
  const rect = el.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (est.arrastando) {
    irPara(tempoEm(limitar(x, 0, larguraVisivel())), { manterVisivel: false });
  } else {
    est.hoverX = x;
    desenhar();
  }
});

function soltar() {
  est.arrastando = false;
}
el.canvas.addEventListener("pointerup", soltar);
el.canvas.addEventListener("pointercancel", soltar);
el.canvas.addEventListener("pointerleave", () => {
  est.hoverX = null;
  desenhar();
});

// ---------- Teclado ----------
function pularParaCorte(direcao) {
  const pontos = pontosDeCorte();
  const eps = quadro() / 2;
  const alvo =
    direcao > 0 ? pontos.find((p) => p > est.t + eps) : [...pontos].reverse().find((p) => p < est.t - eps);
  if (alvo !== undefined) irPara(alvo);
}

document.addEventListener("keydown", (e) => {
  const alvo = e.target;
  if (alvo instanceof HTMLSelectElement || (alvo instanceof HTMLInputElement && alvo.type !== "range")) return;
  if (!est.info) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const tecla = e.key;

  if (ctrl && (tecla === "z" || tecla === "Z")) {
    e.preventDefault();
    e.shiftKey ? refazer() : desfazer();
  } else if (ctrl && (tecla === "y" || tecla === "Y")) {
    e.preventDefault();
    refazer();
  } else if (ctrl) {
    return;
  } else if (tecla === " ") {
    e.preventDefault();
    est.tocando ? pausar() : tocar();
  } else if (tecla === "s" || tecla === "S" || tecla === "b" || tecla === "B") {
    e.preventDefault();
    cortar();
  } else if (tecla === "Delete" || tecla === "Backspace") {
    e.preventDefault();
    excluir();
  } else if (tecla === "ArrowLeft" || tecla === "ArrowRight") {
    if (alvo === el.zoom) return;
    e.preventDefault();
    pausar();
    const passo = e.shiftKey ? 1 : quadro();
    irPara(est.t + (tecla === "ArrowRight" ? passo : -passo));
  } else if (tecla === "ArrowUp" || tecla === "ArrowDown") {
    if (alvo === el.zoom) return;
    e.preventDefault();
    pausar();
    pularParaCorte(tecla === "ArrowDown" ? 1 : -1);
  } else if (tecla === "Home") {
    e.preventDefault();
    pausar();
    irPara(0);
  } else if (tecla === "End") {
    e.preventDefault();
    pausar();
    irPara(est.total);
  } else if (tecla === "+" || tecla === "=") {
    zoomPorFator(1.5);
  } else if (tecla === "-" || tecla === "_") {
    zoomPorFator(1 / 1.5);
  } else if (tecla === "0") {
    ajustarZoom();
  } else if (tecla === "Escape") {
    est.sel = -1;
    atualizarTela();
  }
});

// ---------- Botões ----------
const acoes = {
  inicio: () => (pausar(), irPara(0)),
  fim: () => (pausar(), irPara(est.total)),
  "voltar-quadro": () => (pausar(), irPara(est.t - quadro())),
  "avancar-quadro": () => (pausar(), irPara(est.t + quadro())),
  play: () => (est.tocando ? pausar() : tocar()),
  cortar,
  excluir,
  desfazer,
  refazer,
  "zoom-mais": () => zoomPorFator(1.5),
  "zoom-menos": () => zoomPorFator(1 / 1.5),
  "zoom-ajustar": ajustarZoom,
};
document.querySelectorAll("[data-acao]").forEach((b) =>
  b.addEventListener("click", () => {
    acoes[b.dataset.acao]?.();
    // devolve o foco à timeline para os atalhos continuarem funcionando
    el.timeline.focus({ preventScroll: true });
  }),
);

// ---------- Interface ----------
function atualizarTela() {
  const temVideo = Boolean(est.info);
  el.tempoAtual.textContent = formatar(est.t);
  el.tempoTotal.textContent = formatar(est.total);
  el.play.textContent = est.tocando ? "❚❚" : "▶︎";
  el.excluir.disabled = !temVideo || est.sel < 0;
  el.cortar.disabled = !temVideo;
  el.desfazer.disabled = !est.historico.length;
  el.refazer.disabled = !est.futuro.length;
  el.exportar.disabled = !temVideo || exportacaoAtiva;
  if (temVideo) {
    const removido = est.info.duracao - est.total;
    const n = est.clipes.length;
    el.resumo.textContent =
      `${n} ${n === 1 ? "trecho" : "trechos"}` +
      (removido > 0.005 ? ` · removido ${formatar(removido)} do original (${formatar(est.info.duracao)})` : "");
  } else {
    el.resumo.textContent = "";
  }
  desenhar();
}

// ---------- Desenho da timeline ----------
let desenhoPendente = false;
function desenhar() {
  if (desenhoPendente) return;
  desenhoPendente = true;
  requestAnimationFrame(() => {
    desenhoPendente = false;
    renderizar();
  });
}

function escolherPassos() {
  const fps = est.info?.fps || 30;
  const candidatos = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const principal = candidatos.find((p) => p * est.pxs >= 90) ?? 3600;
  let divisoes = 1;
  for (const d of [10, 5, 2]) {
    if ((principal / d) * est.pxs >= 8 && principal / d >= 1 / fps - 1e-9) {
      divisoes = d;
      break;
    }
  }
  return { principal, divisoes };
}

function renderizar() {
  const dpr = window.devicePixelRatio || 1;
  const w = el.timeline.clientWidth;
  const h = el.timeline.clientHeight;
  if (el.canvas.width !== Math.round(w * dpr) || el.canvas.height !== Math.round(h * dpr)) {
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    el.canvas.style.width = `${w}px`;
    el.canvas.style.height = `${h}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cores.fundo;
  ctx.fillRect(0, 0, w, h);

  // Régua
  ctx.fillStyle = cores.regua;
  ctx.fillRect(0, 0, w, ALT_REGUA);
  if (!est.info) return;

  const t0 = tempoEm(0);
  const t1 = tempoEm(w);
  const { principal, divisoes } = escolherPassos();
  const menor = principal / divisoes;
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.strokeStyle = cores.riscos;
  ctx.fillStyle = cores.textoRegua;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = Math.max(0, Math.floor(t0 / menor)); k * menor <= Math.min(t1, est.total) + 1e-9; k++) {
    const x = Math.round(xDe(k * menor)) + 0.5;
    const ehPrincipal = k % divisoes === 0;
    ctx.moveTo(x, ALT_REGUA);
    ctx.lineTo(x, ALT_REGUA - (ehPrincipal ? 10 : 4));
    if (ehPrincipal) ctx.fillText(formatar(k * menor, principal < 1), x + 3, 3);
  }
  ctx.stroke();

  // Faixa com os trechos
  const yTrilha = ALT_REGUA + 8;
  const altTrilha = h - yTrilha - 8;
  const altMini = Math.round(altTrilha * 0.58);
  const yOnda = yTrilha + altMini;
  const altOnda = altTrilha - altMini;
  const img = est.miniImg && est.miniImg.complete && est.miniImg.naturalWidth ? est.miniImg : null;

  est.clipes.forEach((c, i) => {
    const a = est.acum[i];
    const b = a + (c.fim - c.inicio);
    if (b < t0 || a > t1) return;
    const x0 = xDe(a) + 1;
    const x1 = xDe(b) - 1;
    const larg = Math.max(1, x1 - x0);
    const vis0 = Math.max(x0, 0);
    const vis1 = Math.min(x1, w);
    const fonte = (x) => c.inicio + (tempoEm(x) - a); // segundo do vídeo original naquele pixel

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, yTrilha, larg, altTrilha, 5);
    ctx.clip();
    ctx.fillStyle = cores.clipe;
    ctx.fillRect(x0, yTrilha, larg, altTrilha);

    // Miniaturas
    if (img) {
      const m = est.mini;
      const tw = (m.largura * altMini) / m.altura;
      for (let x = vis0 - ((vis0 - x0) % tw); x < vis1; x += tw) {
        const idx = limitar(Math.floor(fonte(x) / m.intervalo), 0, m.total - 1);
        const sx = (idx % m.colunas) * m.largura;
        const sy = Math.floor(idx / m.colunas) * m.altura;
        ctx.drawImage(img, sx, sy, m.largura, m.altura, x, yTrilha, tw, altMini);
      }
    }

    // Onda do áudio
    ctx.fillStyle = cores.fundoOnda;
    ctx.fillRect(x0, yOnda, larg, altOnda);
    if (est.onda && est.onda.length) {
      ctx.fillStyle = cores.onda;
      const meio = yOnda + altOnda / 2;
      const passo = 1 / est.pxs;
      for (let x = Math.floor(vis0); x < vis1; x++) {
        const sA = fonte(x);
        const iA = Math.max(0, Math.floor(sA * ONDA_POR_SEG));
        const iB = Math.min(est.onda.length, Math.max(iA + 1, Math.ceil((sA + passo) * ONDA_POR_SEG)));
        let pico = 0;
        for (let j = iA; j < iB; j++) if (est.onda[j] > pico) pico = est.onda[j];
        const alt = Math.max(1, (pico / 255) * (altOnda - 6));
        ctx.fillRect(x, meio - alt / 2, 1, alt);
      }
    }

    // Duração do trecho
    if (larg > 70) {
      const rotulo = formatar(c.fim - c.inicio);
      ctx.font = "11px ui-monospace, Menlo, monospace";
      const tw = ctx.measureText(rotulo).width + 8;
      const lx = Math.max(x0, 0) + 4;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(lx, yTrilha + 4, tw, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(rotulo, lx + 4, yTrilha + 6);
    }

    if (i === est.sel) {
      ctx.fillStyle = "rgba(245,180,0,0.22)";
      ctx.fillRect(x0, yTrilha, larg, altTrilha);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, yTrilha + 0.5, larg - 1, altTrilha - 1, 5);
    ctx.lineWidth = i === est.sel ? 3 : 1;
    ctx.strokeStyle = i === est.sel ? cores.sel : cores.borda;
    ctx.stroke();
  });

  // Linha do mouse
  if (est.hoverX !== null && !est.arrastando) {
    const th = tempoEm(est.hoverX);
    if (th >= 0 && th <= est.total) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(Math.round(est.hoverX), 0, 1, h);
    }
  }

  // Agulha (posição atual)
  const xa = Math.round(xDe(est.t));
  ctx.fillStyle = cores.agulha;
  ctx.fillRect(xa - 1, 0, 2, h);
  ctx.beginPath();
  ctx.moveTo(xa - 7, 0);
  ctx.lineTo(xa + 7, 0);
  ctx.lineTo(xa + 7, 10);
  ctx.lineTo(xa, 17);
  ctx.lineTo(xa - 7, 10);
  ctx.closePath();
  ctx.fill();
}

// ---------- Abrir vídeo ----------
async function listarVideos(selecionar) {
  const nomes = await api("/api/videos");
  el.seletor.innerHTML = "";
  const vazio = document.createElement("option");
  vazio.value = "";
  vazio.textContent = nomes.length ? "Escolha um vídeo…" : "Nenhum vídeo ainda — envie um";
  el.seletor.append(vazio);
  for (const n of nomes) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    el.seletor.append(o);
  }
  const alvo = selecionar ?? est.nome ?? ler("editor:ultimo");
  if (alvo && nomes.includes(alvo)) {
    el.seletor.value = alvo;
    if (alvo !== est.nome) await abrir(alvo);
  }
  return nomes;
}

async function abrir(nome) {
  pausar();
  await salvarAgora();
  const token = ++est.token;
  const enc = encodeURIComponent(nome);
  el.salvo.textContent = "Abrindo…";
  try {
    const info = await api(`/api/info/${enc}`);
    const projeto = await api(`/api/projeto/${enc}`);
    if (token !== est.token) return;

    Object.assign(est, {
      nome,
      info,
      clipes: projeto?.clipes?.length ? projeto.clipes : [{ inicio: 0, fim: info.duracao }],
      sel: -1,
      t: 0,
      historico: [],
      futuro: [],
      onda: null,
      mini: null,
      miniImg: null,
    });
    recalcular();
    el.video.src = `/media/${enc}`;
    el.vazio.hidden = true;
    el.seletor.value = nome;
    guardar("editor:ultimo", nome);
    ajustarZoom();
    irPara(0);
    el.salvo.textContent = projeto ? "Cortes anteriores carregados" : "";

    // Onda e miniaturas chegam depois (a primeira vez pode demorar em vídeos longos)
    fetch(`/api/onda/${enc}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (buf && token === est.token) {
          est.onda = new Uint8Array(buf);
          desenhar();
        }
      });
    api(`/api/miniaturas/${enc}`)
      .then((m) => {
        if (token !== est.token) return;
        const imagem = new Image();
        imagem.onload = () => {
          if (token !== est.token) return;
          est.mini = m;
          est.miniImg = imagem;
          desenhar();
        };
        imagem.src = m.url;
      })
      .catch(() => {});
  } catch (e) {
    el.salvo.textContent = "";
    aviso(`Não consegui abrir: ${e.message}`);
  }
}

el.seletor.addEventListener("change", () => {
  if (el.seletor.value) abrir(el.seletor.value);
  el.seletor.blur();
});

// ---------- Enviar vídeo ----------
el.arquivo.addEventListener("change", async () => {
  const arquivo = el.arquivo.files[0];
  el.arquivo.value = "";
  if (!arquivo) return;
  const existentes = [...el.seletor.options].map((o) => o.value);
  if (existentes.includes(arquivo.name) && !confirm(`Já existe "${arquivo.name}". Substituir?`)) return;

  await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/enviar/${encodeURIComponent(arquivo.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) el.salvo.textContent = `Enviando ${arquivo.name}… ${Math.round((e.loaded / e.total) * 100)}%`;
    };
    xhr.onload = async () => {
      if (xhr.status === 200) {
        el.salvo.textContent = "Vídeo enviado ✓";
        est.nome = null;
        await listarVideos(arquivo.name);
      } else {
        let erro = `Erro ${xhr.status}`;
        try {
          erro = JSON.parse(xhr.responseText).erro || erro;
        } catch {}
        el.salvo.textContent = "";
        aviso(`Falha no envio: ${erro}`);
      }
      resolve();
    };
    xhr.onerror = () => {
      el.salvo.textContent = "";
      aviso("Falha no envio. Verifique a conexão.");
      resolve();
    };
    xhr.send(arquivo);
  });
});

// ---------- Exportar ----------
let exportacaoAtiva = false;
let temporizadorExport = null;

function mostrarExportacao(e) {
  exportacaoAtiva = e.estado === "exportando";
  el.faixa.classList.toggle("erro", e.estado === "erro");
  if (e.estado === "parado") {
    el.faixa.hidden = true;
  } else {
    el.faixa.hidden = false;
    el.baixar.hidden = e.estado !== "pronto";
    el.barraExp.parentElement.hidden = e.estado !== "exportando";
    if (e.estado === "exportando") {
      el.textoExp.textContent = `Exportando ${e.nome}… ${Math.round((e.progresso || 0) * 100)}%`;
      el.barraExp.style.width = `${(e.progresso || 0) * 100}%`;
    } else if (e.estado === "pronto") {
      el.textoExp.textContent = `Pronto: ${e.saida}`;
      el.baixar.href = e.url;
    } else if (e.estado === "erro") {
      el.textoExp.textContent = `A exportação falhou: ${e.erro}`;
    }
  }
  atualizarTela();
  clearTimeout(temporizadorExport);
  if (exportacaoAtiva) temporizadorExport = setTimeout(verificarExportacao, 1000);
}

async function verificarExportacao() {
  try {
    mostrarExportacao(await api("/api/exportar"));
  } catch {
    temporizadorExport = setTimeout(verificarExportacao, 3000);
  }
}

el.exportar.addEventListener("click", async () => {
  if (!est.nome) return;
  pausar();
  await salvarAgora();
  try {
    mostrarExportacao(await api(`/api/exportar/${encodeURIComponent(est.nome)}`, { method: "POST" }));
  } catch (e) {
    aviso(e.message);
  }
});

// ---------- Início ----------
atualizarTela();
listarVideos().catch((e) => aviso(`Erro ao listar vídeos: ${e.message}`));
verificarExportacao();
