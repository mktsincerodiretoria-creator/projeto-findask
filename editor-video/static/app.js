"use strict";

/* =========================================================================
   CorteFácil — interface do editor
   ========================================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const TIPOS = {
  silencio:      { nome: "Silêncios",          cor: "#5b7bb5" },
  vicio:         { nome: "Vícios / hesitações", cor: "#f5a524" },
  repeticao:     { nome: "Repetições",         cor: "#ff7a45" },
  falso_inicio:  { nome: "Palavras cortadas",  cor: "#e05dc2" },
  regravacao:    { nome: "Regravações",        cor: "#ff5d5d" },
  erro_assumido: { nome: "Erros assumidos",    cor: "#ff3b6b" },
  erro_ia:       { nome: "Erros (IA)",         cor: "#a57cff" },
  duvida:        { nome: "Palavras duvidosas", cor: "#8a93a6" },
  manual:        { nome: "Cortes manuais",     cor: "#19d3c5" },
};
const tipoInfo = (t) => TIPOS[t] || { nome: t, cor: "#8a93a6" };

const estado = {
  status: null,
  projeto: null,
  onda: [],
  blocos: [],
  mesclados: [],
  filtro: null,
  selecao: null,        // {a, b} em segundos (linha do tempo)
  selPalavras: null,    // {a, b} índices (transcrição)
  ancoraPalavra: null,
  historico: [],
  refazer: [],
  quadros: null,        // miniaturas da linha do tempo {n, passo, largura, altura, img}
  textosPendentes: {},
  ouvindo: null,
  poll: null,
};

// Dois <video> com o mesmo arquivo: "video" é o que aparece e toca; "reserva" fica escondido,
// já parado no começo do próximo trecho. No corte, os dois trocam de papel na hora — sem a
// engasgada de buscar o ponto no meio da reprodução (o que travava no celular).
const videoA = $("#video"), videoB = $("#video-b");
let video = videoA, reserva = videoB;
const videos = [videoA, videoB];
const celular = matchMedia("(max-width: 820px)");   // tela de celular

/* ------------------------------------------------------------ utilidades */

async function api(url, opcoes = {}) {
  const headers = typeof opcoes.body === "string" ? { "Content-Type": "application/json" } : {};
  const r = await fetch(url, { ...opcoes, headers });
  if (r.status === 401) { location.href = "/entrar.html"; throw new Error("Digite a senha."); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* resposta sem JSON */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}
const enviar = (url, metodo, dados) => api(url, { method: metodo, body: JSON.stringify(dados) });

function fmt(t, preciso = false) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const seg = preciso ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${seg}` : `${m}:${seg}`;
}

function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let avisoTimer;
function aviso(msg, erro = false) {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = "aviso" + (erro ? " erro" : "");
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), erro ? 6000 : 3000);
}

function mostrarTela(nome) {
  for (const t of ["inicio", "processando", "editor"]) $(`#tela-${t}`).hidden = t !== nome;
  $("#btn-exportar").hidden = nome !== "editor";
  if (nome !== "editor") {
    video.pause();
    $("#nome-projeto").textContent = "";
  }
}

const novoId = () => Math.random().toString(16).slice(2, 12);

/* ------------------------------------------------------------ opções da análise */

function campoAlternar(chave, titulo, sub, valor, desabilitado = false) {
  return `<div class="campo-linha"><span>${titulo}${sub ? `<small>${sub}</small>` : ""}</span>
    <label class="alternar"><input type="checkbox" data-chave="${chave}" ${valor ? "checked" : ""} ${desabilitado ? "disabled" : ""}>
    <span class="alternar-trilho"></span></label></div>`;
}

function campoFaixa(chave, titulo, sub, valor, min, max, passo, unidade = "") {
  return `<div class="faixa"><label>${titulo}</label><output>${valor}${unidade}</output>
    <input type="range" data-chave="${chave}" data-unidade="${unidade}" min="${min}" max="${max}" step="${passo}" value="${valor}">
    ${sub ? `<small>${sub}</small>` : ""}</div>`;
}

function montarOpcoes(el, cfg, { inicial }) {
  const ia = estado.status?.ia_disponivel;
  const modelos = (estado.status?.modelos || ["small"]).map(
    (m) => `<option ${m === (cfg.modelo || "small") ? "selected" : ""}>${m}</option>`).join("");
  const ritmo = cfg.ritmo || ritmoDe(cfg);
  el.innerHTML = [
    `<div class="campo">Ritmo dos cortes <div class="segmentado" data-ritmo>
      ${Object.entries(RITMOS).map(([k, r]) => `<button type="button" data-v="${k}" class="${ritmo === k ? "ativo" : ""}">${r.nome}</button>`).join("")}
      </div><small>${RITMOS[ritmo]?.dica || "Ajuste personalizado"}</small>
      <input type="hidden" data-chave="ritmo" value="${ritmo}"></div>`,
    campoAlternar("cortar_silencios", "Cortar silêncios e respirações", "Remove as pausas e o som de respiração entre as falas", cfg.cortar_silencios),
    campoFaixa("silencio_minimo", "Pausa mínima para cortar", "Pausas menores que isso ficam", cfg.silencio_minimo, 0.1, 2, 0.05, "s"),
    campoFaixa("margem", "Respiro nas bordas", "Quanto de pausa manter antes e depois de cada fala", cfg.margem, 0, 0.4, 0.01, "s"),
    campoFaixa("sensibilidade", "Sensibilidade do silêncio", "Aumente se houver ruído de fundo e as pausas não forem cortadas", cfg.sensibilidade, 0, 1, 0.05),
    campoAlternar("detectar_vicios", "Hesitações e vícios", "“é…”, “hã”, “hum”, “né”, “tipo”", cfg.detectar_vicios),
    campoAlternar("detectar_repeticoes", "Repetições e palavras cortadas", "“eu eu vou”, “prob… problema”", cfg.detectar_repeticoes),
    campoAlternar("detectar_regravacoes", "Frases regravadas", "Quando você erra e fala a frase de novo, fica só a última", cfg.detectar_regravacoes),
    campoAlternar("usar_ia", "Revisão inteligente com IA", ia ? "O Claude lê a fala e explica cada erro encontrado" : "Configure a chave da API em ⚙ Configurações para ativar", ia && cfg.usar_ia, !ia),
    inicial ? `<div class="cores" style="grid-template-columns:1fr 1fr">
      <label class="campo">Reconhecimento de voz<select data-chave="modelo">${modelos}</select></label>
      <label class="campo">Idioma<select data-chave="idioma">
        <option value="pt" selected>Português</option><option value="en">Inglês</option>
        <option value="es">Espanhol</option><option value="">Detectar</option></select></label></div>` : "",
  ].join("");
  for (const r of $$("input[type=range]", el)) {
    r.addEventListener("input", () => (r.previousElementSibling.textContent = r.value + r.dataset.unidade));
  }
}

// Ritmo dos cortes: "Máximo" (padrão) tira toda pausa e respiração, deixando um respiro curtinho.
const RITMOS = {
  maximo: { nome: "⚡ Máximo", dica: "Corta todas as pausas e respirações (ritmo de Reels/TikTok)", silencio_minimo: 0.2, margem: 0, sensibilidade: 1 },
  equilibrado: { nome: "Equilibrado", dica: "Tira as pausas, deixa um respiro curto", silencio_minimo: 0.3, margem: 0.1, sensibilidade: 0.5 },
  natural: { nome: "Natural", dica: "Só as pausas longas; fala mais calma", silencio_minimo: 0.5, margem: 0.15, sensibilidade: 0.45 },
};
function ritmoDe(cfg) {
  return Object.keys(RITMOS).find((k) => ["silencio_minimo", "margem", "sensibilidade"]
    .every((c) => Math.abs((cfg[c] ?? 0) - RITMOS[k][c]) < 0.001)) || "personalizado";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ritmo] button");
  if (!b) return;
  const el = b.closest(".grade-opcoes, form, div[id^=opcoes]") || document;
  const r = RITMOS[b.dataset.v];
  for (const c of ["silencio_minimo", "margem", "sensibilidade"]) {
    const i = $(`input[data-chave="${c}"]`, el);
    if (i) { i.value = r[c]; i.previousElementSibling.textContent = r[c] + i.dataset.unidade; }
  }
  $$("button", b.parentElement).forEach((x) => x.classList.toggle("ativo", x === b));
  $(`input[data-chave="ritmo"]`, el).value = b.dataset.v;
  b.parentElement.nextElementSibling.textContent = r.dica;
});
document.addEventListener("input", (e) => {
  // mexeu numa barra à mão: vira "personalizado"
  const i = e.target.closest('input[data-chave="silencio_minimo"], input[data-chave="margem"], input[data-chave="sensibilidade"]');
  if (!i) return;
  const el = i.closest(".grade-opcoes, form, div[id^=opcoes]") || document;
  const cfg = lerOpcoes(el);
  const r = ritmoDe(cfg);
  $$("[data-ritmo] button", el).forEach((x) => x.classList.toggle("ativo", x.dataset.v === r));
  const h = $(`input[data-chave="ritmo"]`, el);
  if (h) { h.value = r; h.previousElementSibling.textContent = RITMOS[r]?.dica || "Ajuste personalizado"; }
});

function lerOpcoes(el) {
  const cfg = {};
  for (const i of $$("[data-chave]", el)) {
    cfg[i.dataset.chave] = i.type === "checkbox" ? i.checked : i.type === "range" ? parseFloat(i.value) : i.value;
  }
  return cfg;
}

/* ------------------------------------------------------------ início */

async function carregarInicio() {
  mostrarTela("inicio");
  montarOpcoes($("#opcoes-iniciais"), estado.status.config_padrao, { inicial: true });
  const lista = $("#lista-projetos");
  const itens = await api("/api/projetos");
  if (!itens.length) {
    lista.innerHTML = `<li class="vazio" style="cursor:default">Nenhum projeto ainda. Envie um vídeo acima para começar.</li>`;
    return;
  }
  const rotulos = { pronto: "Pronto", erro: "Erro", processando: "Analisando", na_fila: "Na fila", enviado: "Enviando" };
  lista.innerHTML = itens.map((p) => `
    <li data-id="${p.id}">
      <span class="nome">${escapar(p.nome)}${estado.status.usuario?.admin && p.dono && p.dono !== "admin"
        ? `<span class="selo-dono">👤 ${escapar(p.dono)}</span>` : ""}</span>
      <span class="info">${p.meta ? fmt(p.meta.duracao) + " · " + p.meta.largura + "×" + p.meta.altura : ""}</span>
      <span class="info">${new Date(p.criado_em * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
      <span class="selo ${p.status}">${rotulos[p.status] || p.status}</span>
      <button class="icone" data-apagar="${p.id}" title="Apagar projeto">🗑</button>
    </li>`).join("");
}

$("#lista-projetos").addEventListener("click", async (e) => {
  const apagar = e.target.closest("[data-apagar]");
  if (apagar) {
    e.stopPropagation();
    if (!confirm("Apagar este projeto e os vídeos exportados dele?")) return;
    await api(`/api/projetos/${apagar.dataset.apagar}`, { method: "DELETE" });
    carregarInicio();
    return;
  }
  const li = e.target.closest("li[data-id]");
  if (li) location.hash = `#/p/${li.dataset.id}`;
});

function enviarArquivo(arquivo) {
  if (!arquivo) return;
  const dados = new FormData();
  dados.append("arquivo", arquivo);
  dados.append("config", JSON.stringify(lerOpcoes($("#opcoes-iniciais"))));
  const xhr = new XMLHttpRequest();
  $("#envio").hidden = false;
  xhr.upload.onprogress = (e) => {
    const f = e.loaded / e.total;
    $("#envio-barra").style.width = `${f * 100}%`;
    $("#envio-texto").textContent = `Enviando ${Math.round(f * 100)}%`;
  };
  xhr.onload = () => {
    $("#envio").hidden = true;
    if (xhr.status >= 300) {
      let msg = "Falha no envio";
      try { msg = JSON.parse(xhr.responseText).detail; } catch { /* sem JSON */ }
      aviso(msg, true);
      return;
    }
    location.hash = `#/p/${JSON.parse(xhr.responseText).id}`;
  };
  xhr.onerror = () => { $("#envio").hidden = true; aviso("Falha no envio. O programa está aberto?", true); };
  xhr.open("POST", "/api/projetos");
  xhr.send(dados);
}

const zona = $("#soltar");
$("#arquivo").addEventListener("change", (e) => enviarArquivo(e.target.files[0]));
zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("arrastando"); });
zona.addEventListener("dragleave", () => zona.classList.remove("arrastando"));
zona.addEventListener("drop", (e) => {
  e.preventDefault();
  zona.classList.remove("arrastando");
  enviarArquivo(e.dataTransfer.files[0]);
});

/* ------------------------------------------------------------ processamento */

function acompanhar(pid) {
  clearInterval(estado.poll);
  mostrarTela("processando");
  $("#proc-erro").hidden = true;
  $("#proc-voltar").hidden = true;
  $("#proc-tentar").hidden = true;
  $(".girando").hidden = false;
  const passo = async () => {
    let p;
    try { p = await api(`/api/projetos/${pid}`); } catch (e) { return; }
    if (location.hash !== `#/p/${pid}`) { clearInterval(estado.poll); return; }
    $("#nome-projeto").textContent = p.nome;
    $("#proc-etapa").textContent = p.etapa || "Analisando…";
    $("#proc-barra").style.width = `${(p.progresso || 0) * 100}%`;
    $("#proc-pct").textContent = `${Math.round((p.progresso || 0) * 100)}%`;
    if (p.status === "pronto") {
      clearInterval(estado.poll);
      abrirEditor(p);
    } else if (p.status === "erro") {
      clearInterval(estado.poll);
      $(".girando").hidden = true;
      $("#proc-etapa").textContent = "Não foi possível analisar o vídeo";
      $("#proc-erro").textContent = p.erro;
      $("#proc-erro").hidden = false;
      $("#proc-voltar").hidden = false;
      $("#proc-tentar").hidden = false;
      $("#proc-tentar").dataset.pid = pid;
    }
  };
  passo();
  estado.poll = setInterval(passo, 1000);
}
$("#proc-voltar").addEventListener("click", () => (location.hash = ""));
$("#proc-tentar").addEventListener("click", async () => {
  const pid = $("#proc-tentar").dataset.pid;
  try {
    await enviar(`/api/projetos/${pid}/analisar`, "POST", { retranscrever: true });
    acompanhar(pid);
  } catch (e) { aviso(e.message, true); }
});

/* ------------------------------------------------------------ editor */

async function abrirEditor(p) {
  estado.projeto = p;
  estado.historico = [];
  estado.refazer = [];
  $("#refazer").disabled = true;
  estado.selecao = estado.selPalavras = null;
  estado.filtro = null;
  mostrarTela("editor");
  $("#nome-projeto").textContent = p.nome;
  $("#desfazer").disabled = true;
  if (videoA.dataset.pid !== p.id) {
    for (const v of videos) v.src = `/api/projetos/${p.id}/previa`;
    videoA.dataset.pid = p.id;
    reserva.dataset.alvo = "";
  }
  estado.onda = await api(`/api/projetos/${p.id}/onda`).catch(() => []);
  carregarQuadros(p.id);
  montarOpcoes($("#opcoes-ajustes"), p.config, { inicial: false });
  $("#modelo-retranscrever").innerHTML = estado.status.modelos
    .map((m) => `<option ${m === (p.config.modelo || "small") ? "selected" : ""}>${m}</option>`).join("");
  $("#dica-ia").textContent = p.ia_disponivel
    ? "O Claude lê a transcrição, encontra regravações, correções e trechos fora do roteiro, e explica cada erro."
    : "Para usar, coloque sua chave da API da Anthropic em ⚙ Configurações.";
  p.filtro = p.filtro || { id: "natural", intensidade: 1 };
  carregarLut(p.filtro.id);
  $("#grade-filtros").dataset.pid = "";
  if (abaAtiva() === "filtros") montarFiltros();
  try {
    const r = await api(`/api/projetos/${p.id}/movimento`);
    estado.mov = r.movimento;
    estado.trilha = r.trilha;
  } catch { estado.mov = null; estado.trilha = null; }
  estado.enq = { ...ENQ_PADRAO, ...(p.enquadramento || {}) };
  montarMovimento();
  montarFormato();
  ajustarQuadro();
  renderZooms();
  montarFormLegenda();
  botaoCC();
  montarLegendaCores();
  posicionarBarraTamanho();
  atualizarTudo();
  carregarLegendas();
  setTimeout(redimensionarLinhaTempo, 50);
}

const cortes = () => estado.projeto.cortes;

function mesclarAtivos() {
  const lista = cortes().filter((c) => c.ativo).map((c) => [c.inicio, c.fim]).sort((a, b) => a[0] - b[0]);
  const res = [];
  for (const [a, b] of lista) {
    if (res.length && a <= res[res.length - 1][1] + 1e-6) res[res.length - 1][1] = Math.max(res[res.length - 1][1], b);
    else res.push([a, b]);
  }
  estado.mesclados = res;
}

function tempoFinal(t) {
  let removido = 0;
  for (const [a, b] of estado.mesclados) {
    if (a >= t) break;
    removido += Math.min(b, t) - a;
  }
  return t - removido;
}

function duracao() { return estado.projeto?.meta?.duracao || video.duration || 0; }

const pendentes = new Set();   // listas que mudaram com a aba fechada
function renderSeVisivel(aba, fn) {
  if (abaAtiva() === aba) { fn(); pendentes.delete(aba); } else pendentes.add(aba);
}

function atualizarTudo() {
  mesclarAtivos();
  renderResumo();
  renderSeVisivel("cortes", () => { renderFiltros(); renderCortes(); });
  renderSeVisivel("texto", renderTranscricao);
  desenharLinhaTempo();
  chipAtual = "";
}

// Mostra o corte que está embaixo da agulha, com "Não cortar" / "Cortar" num toque.
let chipAtual = "";
function atualizarChipCorte(t) {
  const chip = $("#chip-corte");
  const c = estado.tempoAlvo == null && !video.paused ? null : corteEm(t);
  const chave = c ? `${c.id}|${c.ativo}|${c.inicio}|${c.fim}` : "-";
  if (chave === chipAtual) return;
  chipAtual = chave;
  // o espaço fica sempre reservado: a linha do tempo não "pula" quando aparece um corte
  chip.classList.toggle("vazio", !c);
  if (!c) {
    chip.style.removeProperty("--cor");
    chip.classList.remove("mantido");
    chip.dataset.id = "";
    chip.innerHTML = `<span class="chip-texto">${celular.matches
      ? "Toque num trecho cortado para mantê-lo · arraste as bordas brancas para ajustar"
      : "Clique num trecho cortado para mantê-lo · arraste as bordas brancas para ajustar"}</span>`;
    return;
  }
  const info = tipoInfo(c.tipo);
  chip.style.setProperty("--cor", info.cor);
  chip.classList.toggle("mantido", !c.ativo);
  chip.dataset.id = c.id;
  chip.innerHTML = `<span class="chip-texto">${c.ativo ? "✂" : "↩"} <b>${escapar(c.titulo || info.nome)}</b>
      <small>${(c.fim - c.inicio).toFixed(1)}s${c.ativo ? "" : " · mantido"}</small></span>
    <button type="button" data-chip="ouvir">▶</button>
    ${c.ativo ? `<button type="button" class="manter" data-chip="manter">Não cortar</button>`
      : `<button type="button" data-chip="cortar">✂ Cortar</button>`}`;
}
$("#chip-corte").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]");
  const c = cortes().find((x) => x.id === $("#chip-corte").dataset.id);
  if (!b || !c) return;
  if (b.dataset.chip === "ouvir") { ouvir(Math.max(0, c.inicio - 0.6), Math.min(duracao(), c.fim + 0.6)); return; }
  guardarHistorico();
  c.ativo = b.dataset.chip === "cortar";
  alterou();
  aviso(c.ativo ? "Trecho cortado de novo." : "Pronto: esse trecho fica no vídeo. (↶ desfaz)");
});

function renderResumo() {
  const dur = duracao();
  const final = tempoFinal(dur);
  const ativos = cortes().filter((c) => c.ativo).length;
  const pct = dur ? Math.round((1 - final / dur) * 100) : 0;
  $("#resumo").innerHTML = `
    <div class="cartao"><small>Original</small><b>${fmt(dur)}</b></div>
    <div class="cartao destaque"><small>Vídeo final</small><b>${fmt(final)}</b></div>
    <div class="cartao"><small>Removido</small><b>${fmt(dur - final)} (${pct}%)</b></div>
    <div class="cartao"><small>Cortes ativos</small><b>${ativos} de ${cortes().length}</b></div>`;
}

/* ---------- lista de cortes ---------- */

function renderFiltros() {
  const cont = {};
  for (const c of cortes()) cont[c.tipo] = (cont[c.tipo] || 0) + 1;
  const chips = [`<button class="filtro ${estado.filtro ? "" : "ativo"}" data-filtro="">Todos (${cortes().length})</button>`];
  for (const tipo of Object.keys(TIPOS)) {
    if (!cont[tipo]) continue;
    const info = tipoInfo(tipo);
    chips.push(`<button class="filtro ${estado.filtro === tipo ? "ativo" : ""}" data-filtro="${tipo}">
      <span class="bolinha" style="background:${info.cor}"></span>${info.nome} (${cont[tipo]})</button>`);
  }
  $("#filtros").innerHTML = chips.join("");
  const com = estado.projeto.comentario_ia;
  $("#comentario-ia").hidden = !com;
  $("#comentario-ia").textContent = com ? `✦ ${com}` : "";
}

$("#filtros").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filtro]");
  if (!b) return;
  estado.filtro = b.dataset.filtro || null;
  renderFiltros();
  renderCortes();
});

const cortesVisiveis = () => cortes().filter((c) => !estado.filtro || c.tipo === estado.filtro);

function renderCortes() {
  const lista = cortesVisiveis();
  if (!lista.length) {
    $("#lista-cortes").innerHTML = `<li class="vazio">Nenhum corte${estado.filtro ? " deste tipo" : ""}.</li>`;
    return;
  }
  $("#lista-cortes").innerHTML = lista.map((c) => {
    const info = tipoInfo(c.tipo);
    return `<li class="corte ${c.ativo ? "" : "inativo"}" data-id="${c.id}" style="--cor:${info.cor}">
      <div class="corte-titulo">${escapar(c.titulo || info.nome)}
        <span class="corte-tempo">${fmt(c.inicio, true)} · ${(c.fim - c.inicio).toFixed(1)}s</span></div>
      <div class="corte-acoes">
        <button class="icone" data-ouvir title="Ouvir este trecho">▶</button>
        ${c.origem === "manual" ? `<button class="icone" data-remover title="Remover corte manual">✕</button>` : ""}
        <label class="alternar" title="${c.ativo ? "Será cortado" : "Não será cortado"}">
          <input type="checkbox" data-ativo ${c.ativo ? "checked" : ""}><span class="alternar-trilho"></span></label>
      </div>
      ${c.trecho ? `<div class="corte-trecho">“${escapar(c.trecho)}”</div>` : ""}
      ${c.motivo ? `<div class="corte-motivo">${escapar(c.motivo)}</div>` : ""}
    </li>`;
  }).join("");
}

$("#lista-cortes").addEventListener("click", (e) => {
  const li = e.target.closest(".corte");
  if (!li) return;
  const c = cortes().find((x) => x.id === li.dataset.id);
  if (e.target.closest("[data-ativo]")) {
    guardarHistorico();
    c.ativo = e.target.checked;
    alterou();
    return;
  }
  if (e.target.closest(".alternar")) return;
  if (e.target.closest("[data-ouvir]")) { ouvir(c.inicio, c.fim); return; }
  if (e.target.closest("[data-remover]")) {
    guardarHistorico();
    estado.projeto.cortes = cortes().filter((x) => x.id !== c.id);
    alterou();
    return;
  }
  irPara(Math.max(0, c.inicio - 0.5));
  focarCorte(c.id, false);
});

function focarCorte(id, rolar = true) {
  $$(".corte.foco").forEach((el) => el.classList.remove("foco"));
  const el = $(`.corte[data-id="${id}"]`);
  if (!el) return;
  el.classList.add("foco");
  if (rolar) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function alternarVisiveis(ativo) {
  guardarHistorico();
  for (const c of cortesVisiveis()) c.ativo = ativo;
  alterou();
}
$("#ativar-visiveis").addEventListener("click", () => alternarVisiveis(true));
$("#desativar-visiveis").addEventListener("click", () => alternarVisiveis(false));

/* ---------- histórico e salvamento ---------- */

const fotoEdicao = () => JSON.stringify({ cortes: cortes(), zooms: estado.mov?.zooms || [], enq: estado.enq });

function botoesHistorico() {
  $("#desfazer").disabled = !estado.historico.length;
  $("#refazer").disabled = !estado.refazer.length;
}

function guardarHistorico() {
  estado.historico.push(fotoEdicao());
  if (estado.historico.length > 80) estado.historico.shift();
  estado.refazer = [];
  botoesHistorico();
}

function voltarPara(foto) {
  const antes = JSON.parse(foto);
  estado.projeto.cortes = antes.cortes;
  if (estado.mov) estado.mov.zooms = antes.zooms;
  if (antes.enq) { estado.enq = antes.enq; montarFormato(); ajustarQuadro(); transformAtual = "x"; }
  botoesHistorico();
  renderZooms();
  alterou();
}

function desfazer() {
  const anterior = estado.historico.pop();
  if (!anterior) return;
  estado.refazer.push(fotoEdicao());
  voltarPara(anterior);
}

function refazer() {
  const proxima = estado.refazer.pop();
  if (!proxima) return;
  estado.historico.push(fotoEdicao());
  voltarPara(proxima);
}
$("#desfazer").addEventListener("click", desfazer);
$("#lt-play").addEventListener("click", () => alternarPlay());

$("#refazer").addEventListener("click", refazer);

function alterou() {
  atualizarTudo();
  agendarSalvar();
}

let salvarTimer = null;
let salvando = Promise.resolve();
function agendarSalvar() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(salvarAgora, 400);
}

function salvarAgora() {
  clearTimeout(salvarTimer);
  salvarTimer = null;
  const p = estado.projeto;
  const textos = estado.textosPendentes;
  estado.textosPendentes = {};
  salvando = salvando.then(() => enviar(`/api/projetos/${p.id}/edicao`, "PUT", {
    cortes: p.cortes, textos, estilo_legenda: p.estilo_legenda, filtro: p.filtro, movimento: estado.mov,
    enquadramento: estado.enq,
  })).then(() => carregarLegendas()).catch((e) => aviso("Não consegui salvar: " + e.message, true));
  return salvando;
}

/* ---------- transcrição ---------- */

function estadoPalavras() {
  // Para cada palavra: corte ativo que a remove, ou sugestão (corte desligado) que a cobre.
  const pal = estado.projeto.palavras;
  const res = new Array(pal.length);
  const ordenados = [...cortes()].sort((a, b) => a.inicio - b.inicio);
  for (let i = 0; i < pal.length; i++) {
    const meio = (pal[i].inicio + pal[i].fim) / 2;
    let ativo = null, sugestao = null;
    for (const c of ordenados) {
      if (c.inicio > meio) break;
      if (c.fim >= meio) {
        if (c.ativo) { if (!ativo || ativo.tipo === "silencio") ativo = c; }
        else if (c.tipo !== "silencio") sugestao = c;
      }
    }
    res[i] = { ativo, sugestao };
  }
  return res;
}

function renderTranscricao() {
  const pal = estado.projeto.palavras;
  if (!pal.length) {
    $("#transcricao").innerHTML = `<p class="vazio">Nenhuma fala reconhecida.</p>`;
    return;
  }
  const est = estadoPalavras();
  const sel = estado.selPalavras;
  const partes = [];
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    if (i > 0 && p.inicio - pal[i - 1].fim >= 0.8) partes.push(`<span class="pausa">⏸${(p.inicio - pal[i - 1].fim).toFixed(1)}s</span> `);
    const { ativo, sugestao } = est[i];
    const classes = ["p"];
    let cor = "";
    if (ativo) { classes.push("cortada"); cor = tipoInfo(ativo.tipo).cor; }
    else if (sugestao) { classes.push("sugerida"); cor = tipoInfo(sugestao.tipo).cor; }
    if (sel && i >= sel.a && i <= sel.b) classes.push("selecionada");
    const titulo = ativo ? `Cortado: ${ativo.titulo}` : sugestao ? `Sugestão: ${sugestao.titulo}` : "";
    partes.push(`<span class="${classes.join(" ")}" data-i="${i}" ${cor ? `style="--cor:${cor}"` : ""} ${titulo ? `title="${escapar(titulo)}"` : ""}>${escapar(p.texto)}</span> `);
  }
  $("#transcricao").innerHTML = partes.join("");
  atualizarBarraSelecao();
}

let arrastandoPalavras = false;
let ultimoToque = false;   // o último clique veio de um dedo (celular)?
document.addEventListener("pointerdown", (e) => (ultimoToque = e.pointerType === "touch"), true);
$("#transcricao").addEventListener("mousedown", (e) => {
  const span = e.target.closest(".p");
  if (!span || e.target.tagName === "INPUT") return;
  const i = +span.dataset.i;
  const s = estado.selPalavras;
  // No celular não tem Shift: toque na primeira palavra e depois na última.
  const estender = e.shiftKey || (ultimoToque && s && s.a === s.b && s.a !== i);
  if (estender && estado.ancoraPalavra != null) {
    selecionarPalavras(estado.ancoraPalavra, i);
  } else {
    estado.ancoraPalavra = i;
    selecionarPalavras(i, i);
    arrastandoPalavras = !ultimoToque;
  }
  irPara(estado.projeto.palavras[i].inicio);
});
$("#transcricao").addEventListener("mouseover", (e) => {
  if (!arrastandoPalavras) return;
  const span = e.target.closest(".p");
  if (span) selecionarPalavras(estado.ancoraPalavra, +span.dataset.i);
});
document.addEventListener("mouseup", () => (arrastandoPalavras = false));

function selecionarPalavras(a, b) {
  estado.selPalavras = { a: Math.min(a, b), b: Math.max(a, b) };
  for (const el of $$("#transcricao .p")) {
    const i = +el.dataset.i;
    el.classList.toggle("selecionada", i >= estado.selPalavras.a && i <= estado.selPalavras.b);
  }
  atualizarBarraSelecao();
}

function atualizarBarraSelecao() {
  const s = estado.selPalavras;
  const barra = $("#barra-selecao");
  if (!s) { barra.hidden = true; return; }
  const pal = estado.projeto.palavras;
  barra.hidden = false;
  const n = s.b - s.a + 1;
  $("#selecao-info").textContent = `${n} palavra${n > 1 ? "s" : ""} · ${fmt(pal[s.a].inicio, true)}–${fmt(pal[s.b].fim, true)}`;
  $("#corrigir-palavra").hidden = n !== 1;
}

function intervaloDasPalavras(a, b) {
  const pal = estado.projeto.palavras;
  const fim = b + 1 < pal.length ? pal[b + 1].inicio : Math.min(duracao(), pal[b].fim + 0.1);
  return [pal[a].inicio, fim];
}

function cortarIntervalo(ini, fim, trecho = "") {
  if (fim - ini < 0.03) return;
  guardarHistorico();
  cortes().push({
    id: novoId(), inicio: +ini.toFixed(3), fim: +fim.toFixed(3), tipo: "manual", titulo: "Corte manual",
    motivo: "Trecho removido por você.", ativo: true, origem: "manual", palavras: null, trecho,
  });
  alterou();
}

function restaurarIntervalo(ini, fim) {
  const afetados = cortes().filter((c) => c.ativo && c.inicio < fim && c.fim > ini);
  if (!afetados.length) { aviso("Nada cortado nesse trecho."); return; }
  guardarHistorico();
  estado.projeto.cortes = cortes().filter((c) => !(c.origem === "manual" && afetados.includes(c)));
  for (const c of afetados) c.ativo = false;
  alterou();
}

$("#cortar-selecao").addEventListener("click", () => {
  const s = estado.selPalavras;
  if (!s) return;
  const [a, b] = intervaloDasPalavras(s.a, s.b);
  const trecho = estado.projeto.palavras.slice(s.a, s.b + 1).map((p) => p.texto).join(" ");
  cortarIntervalo(a, b, trecho);
});
$("#restaurar-selecao").addEventListener("click", () => {
  const s = estado.selPalavras;
  if (s) restaurarIntervalo(...intervaloDasPalavras(s.a, s.b));
});

$("#transcricao").addEventListener("dblclick", (e) => {
  const span = e.target.closest(".p");
  if (span) editarPalavra(+span.dataset.i);
});
$("#corrigir-palavra").addEventListener("click", () => {
  if (estado.selPalavras) editarPalavra(estado.selPalavras.a);
});

function editarPalavra(i) {
  const span = $(`#transcricao .p[data-i="${i}"]`);
  if (!span) return;
  const original = estado.projeto.palavras[i].texto;
  span.innerHTML = `<input value="${escapar(original)}">`;
  const input = $("input", span);
  input.focus();
  input.select();
  const concluir = (salvar) => {
    const novo = input.value.trim();
    if (salvar && novo && novo !== original) {
      estado.projeto.palavras[i].texto = novo;
      estado.textosPendentes[i] = novo;
      agendarSalvar();
    }
    renderTranscricao();
  };
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") concluir(true);
    if (ev.key === "Escape") concluir(false);
  });
  input.addEventListener("blur", () => concluir(true), { once: true });
}

/* ---------- reprodução ---------- */

function irPara(t) {
  video.currentTime = Math.max(0, Math.min(duracao(), t));
  estado.ouvindo = null;
  // agulha fora da tela (ex.: tocou num corte da lista): a linha do tempo vai até ela
  if (typeof rolagem !== "undefined") {
    const x = video.currentTime * pps;
    if (x < rolagem.scrollLeft || x > rolagem.scrollLeft + rolagem.clientWidth - 20) rolagem.scrollLeft = x - rolagem.clientWidth / 3;
  }
}

function ouvir(a, b) {
  estado.ouvindo = { fim: Math.min(duracao(), b + 0.6) };
  video.currentTime = Math.max(0, a - 1.0);
  video.play();
}

function alternarPlay() {
  if (video.paused) {
    video.dataset.liberado = "1";   // tocou num toque seu: este player também pode tocar com som
    liberarReserva();
    if (video.currentTime >= duracao() - 0.05) video.currentTime = 0;
    video.play();
  } else video.pause();
}
$("#btn-play").addEventListener("click", alternarPlay);
function botoesPlay() {
  $("#btn-play").textContent = video.paused ? "▶" : "❚❚";
  $("#lt-play").textContent = video.paused ? "▶\uFE0E" : "❚❚";
}
for (const v of videos) {
  v.addEventListener("click", alternarPlay);
  v.addEventListener("play", botoesPlay);
  v.addEventListener("pause", botoesPlay);
}

// No iPhone, um vídeo só toca com som se começou num toque da pessoa: "libera" o de reserva
// junto com o primeiro play.
function liberarReserva() {
  if (reserva.dataset.liberado) return;
  reserva.muted = false;
  reserva.play().then(() => { reserva.pause(); reserva.dataset.liberado = "1"; reserva.dataset.alvo = ""; })
    .catch(() => { reserva.muted = true; });
}

// Deixa a reserva parada no próximo trecho que vem depois de um corte.
function prepararReserva(t) {
  const prox = estado.mesclados.find(([a]) => a > t);
  if (!prox || prox[0] - t > 3 || prox[1] >= duracao() - 0.05) return;
  const alvo = prox[1].toFixed(3);
  if (reserva.dataset.alvo === alvo) return;
  reserva.dataset.alvo = alvo;
  reserva.currentTime = prox[1];
}

function saltar(b) {
  const pronta = reserva.dataset.alvo === b.toFixed(3) && reserva.readyState >= 2 && !reserva.seeking
    && Math.abs(reserva.currentTime - b) < 0.08 && reserva.dataset.liberado;
  if (!pronta) { video.currentTime = b; return; }
  const antigo = video;
  video = reserva;
  reserva = antigo;
  reserva.__par = video;
  video.muted = false;
  video.classList.remove("video-reserva");
  const tocando = video.play();
  antigo.classList.add("video-reserva");
  antigo.pause();
  reserva.dataset.alvo = "";
  transformAtual = "x";
  marcaFiltro = "";
  tocando?.catch((err) => {
    // só se o navegador PROIBIU tocar (e não quando você pausou logo depois): volta para o
    // jeito antigo, buscando o ponto no mesmo player
    if (err?.name !== "NotAllowedError" || video !== reserva.__par) return;
    video.classList.add("video-reserva");
    antigo.classList.remove("video-reserva");
    reserva = video;
    video = antigo;
    video.currentTime = b;
    video.play();
  });
}
video.addEventListener("loadedmetadata", () => { legendaAtual = ""; posicionarBarraTamanho(); });

let palavraAtual = -1;
let textoTempos = "";
function quadro() {
  requestAnimationFrame(quadro);
  if ($("#tela-editor").hidden || !estado.projeto) return;
  let t = video.currentTime;
  if (!video.paused) {
    if (estado.ouvindo) {
      if (t >= estado.ouvindo.fim) { video.pause(); estado.ouvindo = null; }
    } else if ($("#pular-cortes").checked) {
      const c = estado.mesclados.find(([a, b]) => t >= a - 0.005 && t < b - 0.02);
      if (c) {
        if (c[1] >= duracao() - 0.05) { video.pause(); video.currentTime = c[0]; }
        else { saltar(c[1]); t = c[1]; }
      } else prepararReserva(t);
    }
  }
  const tt = estado.tempoAlvo ?? t;
  const txt = fmt(tt, true) + "|" + fmt(tempoFinal(tt), true);
  if (txt !== textoTempos) {
    textoTempos = txt;
    $("#tempo-atual").textContent = fmt(tt, true);
    $("#tempo-final").textContent = fmt(tempoFinal(tt), true);
  }
  aplicarMovimento(t);
  desenharFiltro();
  atualizarLegendaPrevia(t);
  if (abaAtiva() === "texto") destacarPalavra(t);
  atualizarChipCorte(tt);
  seguirCursor(t);
  desenharLinhaTempo(true);
}

function destacarPalavra(t) {
  const pal = estado.projeto.palavras;
  let idx = -1;
  // busca binária pela palavra que está tocando
  let lo = 0, hi = pal.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (pal[m].fim < t) lo = m + 1;
    else if (pal[m].inicio > t) hi = m - 1;
    else { idx = m; break; }
  }
  if (idx === palavraAtual) return;
  $(`#transcricao .p[data-i="${palavraAtual}"]`)?.classList.remove("atual");
  palavraAtual = idx;
  const el = $(`#transcricao .p[data-i="${idx}"]`);
  if (el) {
    el.classList.add("atual");
    if (!video.paused && !$("#aba-texto").hidden) el.scrollIntoView({ block: "nearest" });
  }
}

/* ---------- legenda: prévia ---------- */

async function carregarLegendas() {
  if (!estado.projeto) return;
  estado.blocos = await api(`/api/projetos/${estado.projeto.id}/legendas`).catch(() => []);
}

function estilo() {
  return { ...estado.status.estilo_padrao, ...(estado.projeto.estilo_legenda || {}) };
}

function hexParaRgba(hex, alfa) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alfa})`;
}

let legendaAtual = "";
function atualizarLegendaPrevia(t) {
  const el = $("#legenda-previa");
  const es = estilo();
  let bloco = es.ativa ? estado.blocos.find((b) => t >= b.inicio_orig - 0.05 && t <= b.fim_orig + 0.25) : null;
  // Editando a legenda: mostra sempre a mais próxima, para ver o tamanho enquanto ajusta.
  if (!bloco && es.ativa && abaAtiva() === "legenda" && estado.blocos.length) {
    bloco = estado.blocos.find((b) => b.inicio_orig >= t) || estado.blocos[estado.blocos.length - 1];
  }
  if (!bloco) {
    if (legendaAtual) { el.innerHTML = ""; legendaAtual = ""; }
    return;
  }
  // Área real da imagem dentro da caixa (o vídeo é centralizado).
  const caixa = $("#video-caixa").getBoundingClientRect();
  const vr = quadroRect();
  const menor = Math.min(vr.width, vr.height);
  const fs = (menor * es.tamanho) / 100 / 1.15;
  const contorno = (es.contorno * menor) / 1080;
  const vertical = vr.height > vr.width;
  const margem = vr.height * (vertical ? 0.12 : 0.07);

  let atual = -1;
  if (es.destaque) {
    bloco.palavras.forEach((p, i) => { if (t >= p.inicio_orig) atual = i; });
  }
  const html = bloco.palavras.map((p, i) =>
    (i === 0 ? "" : i === bloco.quebra ? "<br>" : " ")
    + (i === atual ? `<span style="color:${es.cor_destaque}">${escapar(p.texto)}</span>` : escapar(p.texto))).join("");
  const chave = html + JSON.stringify(es) + vr.width + vr.height;
  if (chave === legendaAtual) return;
  legendaAtual = chave;

  const largura = (vr.width * es.largura) / 100;
  el.style.left = `${vr.left - caixa.left + (vr.width - largura) / 2}px`;
  el.style.width = `${largura}px`;
  el.style.padding = "0";
  el.style.whiteSpace = es.linhas === 1 ? "nowrap" : "normal";
  el.style.top = el.style.bottom = "";
  el.style.transform = "";
  if (es.posicao === "superior") el.style.top = `${vr.top - caixa.top + margem}px`;
  else if (es.posicao === "meio") { el.style.top = `${vr.top - caixa.top + vr.height / 2}px`; el.style.transform = "translateY(-50%)"; }
  else el.style.bottom = `${caixa.bottom - vr.bottom + margem}px`;

  const fundo = es.fundo ? `background:${hexParaRgba(es.cor_fundo, 0.75)};` : "";
  const traco = !es.fundo && contorno > 0
    ? `-webkit-text-stroke:${(contorno * 2).toFixed(1)}px ${es.cor_contorno};paint-order:stroke fill;` : "";
  el.innerHTML = `<span class="bloco" style="font-family:'${es.fonte}',sans-serif;font-size:${fs.toFixed(1)}px;
    font-weight:${es.negrito ? 700 : 400};color:${es.cor};${fundo}${traco}">${html}</span>`;
}

/* ---------- legenda: barra de tamanho (estilo Instagram) ---------- */

const TAM_MIN = 3, TAM_MAX = 14;
const barraTam = $("#barra-tamanho");

function abaAtiva() { return $(".aba.ativa")?.dataset.aba; }

function posicionarBarraTamanho() {
  const visivel = !!estado.projeto && abaAtiva() === "legenda" && !$("#tela-editor").hidden;
  barraTam.hidden = !visivel;
  if (!visivel) return;
  const caixa = $("#video-caixa").getBoundingClientRect();
  const vr = quadroRect();
  barraTam.style.left = `${Math.max(8, vr.left - caixa.left + 10)}px`;
  const f = (TAM_MAX - estilo().tamanho) / (TAM_MAX - TAM_MIN);   // 0 = topo (maior)
  $("#barra-tamanho-botao").style.top = `${Math.min(1, Math.max(0, f)) * 100}%`;
}

function arrastarTamanho(e) {
  const r = barraTam.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  const valor = Math.round((TAM_MAX - f * (TAM_MAX - TAM_MIN)) * 2) / 2;
  if (valor === estilo().tamanho) return;
  mudarEstilo("tamanho", valor);
  const faixa = $('#form-legenda [data-chave="tamanho"]');
  if (faixa) { faixa.value = valor; faixa.previousElementSibling.textContent = `${valor}%`; }
}
barraTam.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  barraTam.setPointerCapture(e.pointerId);
  arrastarTamanho(e);
});
barraTam.addEventListener("pointermove", (e) => { if (barraTam.hasPointerCapture(e.pointerId)) arrastarTamanho(e); });
window.addEventListener("resize", posicionarBarraTamanho);

/* ---------- legenda: formulário ---------- */

const FONTES = ["Arial", "Arial Black", "Verdana", "Tahoma", "Trebuchet MS", "Impact", "Georgia", "Courier New"];

function montarFormLegenda() {
  const es = estilo();
  const seg = (chave, opcoes) => `<div class="segmentado" data-seg="${chave}">${opcoes.map(([v, r]) =>
    `<button type="button" data-v="${v}" class="${es[chave] === v ? "ativo" : ""}">${r}</button>`).join("")}</div>`;
  $("#form-legenda").innerHTML = `
    ${campoAlternar("ativa", "Legenda ligada", "Desligada: o vídeo sai sem legenda (também no botão CC ao lado do vídeo)", es.ativa)}
    <div class="campo">Linhas na tela ${seg("linhas", [[1, "1 linha"], [2, "2 linhas"]])}</div>
    <div class="campo">Palavras por vez ${seg("modo", [["frase", "Frase inteira"], ["curta", "Até 3 (estilo Reels)"]])}</div>
    <div class="campo">Posição ${seg("posicao", [["superior", "Em cima"], ["meio", "Meio"], ["inferior", "Embaixo"]])}</div>
    <label class="campo">Fonte<select data-chave="fonte">${FONTES.map((f) =>
      `<option ${f === es.fonte ? "selected" : ""}>${f}</option>`).join("")}</select></label>
    ${campoFaixa("tamanho", "Tamanho", "Dica: arraste também a barra ao lado do vídeo", es.tamanho, 3, 14, 0.5, "%")}
    ${campoFaixa("largura", "Largura máxima", "Quanto da largura do vídeo a legenda pode ocupar", es.largura, 40, 96, 1, "%")}
    ${campoFaixa("contorno", "Contorno", "", es.contorno, 0, 10, 0.5, "px")}
    <div class="cores">
      <label>Texto<input type="color" data-chave="cor" value="${es.cor}"></label>
      <label>Contorno<input type="color" data-chave="cor_contorno" value="${es.cor_contorno}"></label>
      <label>Destaque<input type="color" data-chave="cor_destaque" value="${es.cor_destaque}"></label>
    </div>
    ${campoAlternar("negrito", "Negrito", "", es.negrito)}
    ${campoAlternar("maiusculas", "LETRAS MAIÚSCULAS", "", es.maiusculas)}
    ${campoAlternar("destaque", "Destacar a palavra falada", "Pinta a palavra do momento com a cor de destaque", es.destaque)}
    ${campoAlternar("fundo", "Caixa de fundo", "Fundo escuro atrás do texto", es.fundo)}
    <div class="cores"><label>Cor do fundo<input type="color" data-chave="cor_fundo" value="${es.cor_fundo}"></label></div>
    <p class="dica">Dica: corrija palavras erradas da legenda com duplo clique na aba Transcrição.</p>`;
  for (const r of $$("input[type=range]", $("#form-legenda"))) {
    r.addEventListener("input", () => (r.previousElementSibling.textContent = r.value + r.dataset.unidade));
  }
}

function mudarEstilo(chave, valor) {
  const p = estado.projeto;
  p.estilo_legenda = { ...estilo(), [chave]: valor };
  if (chave === "ativa") botaoCC();
  legendaAtual = "";
  posicionarBarraTamanho();
  agendarSalvar();  // salvar recarrega os blocos (tamanho, linhas e largura mudam o agrupamento)
}

function botaoCC() {
  const ligada = estilo().ativa !== false;
  for (const b of $$(".btn-cc")) {
    b.classList.toggle("ligado", ligada);
    b.title = ligada ? "Legenda ligada (toque para desligar)" : "Legenda desligada (toque para ligar)";
  }
}
$$(".btn-cc").forEach((b) => b.addEventListener("click", () => {
  const ligar = estilo().ativa === false;
  mudarEstilo("ativa", ligar);
  const chk = $('#form-legenda input[data-chave="ativa"]');
  if (chk) chk.checked = ligar;
  aviso(ligar ? "Legenda ligada." : "Legenda desligada: o vídeo vai sair sem legenda.");
}));

$("#form-legenda").addEventListener("input", (e) => {
  const i = e.target.closest("[data-chave]");
  if (!i) return;
  mudarEstilo(i.dataset.chave, i.type === "checkbox" ? i.checked : i.type === "range" ? parseFloat(i.value) : i.value);
});
$("#form-legenda").addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg] button");
  if (!b) return;
  const grupo = b.parentElement;
  $$("button", grupo).forEach((x) => x.classList.toggle("ativo", x === b));
  const v = b.dataset.v;
  mudarEstilo(grupo.dataset.seg, /^\d+$/.test(v) ? Number(v) : v);
});

/* ---------- abas ---------- */

// Tela cheia: usa a do navegador quando existe; no iPhone, o vídeo ocupa a tela pela página.
function telaCheia(ligar) {
  const caixa = $("#video-caixa");
  caixa.classList.toggle("cheia", ligar);
  document.body.classList.toggle("com-tela-cheia", ligar);
  ajustarCaixaCelular();
  if (ligar && caixa.requestFullscreen) caixa.requestFullscreen().catch(() => {});
  else if (!ligar && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$("#btn-tela-cheia").addEventListener("click", () => telaCheia(true));
$("#sair-tela-cheia").addEventListener("click", (e) => { e.stopPropagation(); telaCheia(false); });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) telaCheia(false); });
$("#video-caixa").addEventListener("click", (e) => {
  if ($("#video-caixa").classList.contains("cheia") && !e.target.closest("button, .barra-tamanho")) alternarPlay();
});

$$(".aba").forEach((aba) => aba.addEventListener("click", () => {
  $$(".aba").forEach((a) => a.classList.toggle("ativa", a === aba));
  for (const c of $$(".aba-conteudo")) c.hidden = c.id !== `aba-${aba.dataset.aba}`;
  $("#video-caixa").classList.toggle("enquadrando", aba.dataset.aba === "formato");
  legendaAtual = "";
  posicionarBarraTamanho();
  if (aba.dataset.aba === "filtros") montarFiltros();
  if (pendentes.has("cortes") && aba.dataset.aba === "cortes") { renderFiltros(); renderCortes(); pendentes.delete("cortes"); }
  if (pendentes.has("texto") && aba.dataset.aba === "texto") { renderTranscricao(); pendentes.delete("texto"); palavraAtual = -1; }
  // No celular as abas ficam embaixo (como no CapCut): mostra o conteúdo da aba escolhida.
  if (celular.matches) {
    const c = $(`#aba-${aba.dataset.aba}`), editor = $("#tela-editor");
    editor.classList.add("compacto");   // vídeo pequeno + linha do tempo presos no alto
    ajustarCaixaCelular();
    const topo = c.getBoundingClientRect().top - editor.getBoundingClientRect().top + editor.scrollTop;
    const presos = $("#video-caixa").offsetHeight + 8 + $(".linha-tempo").offsetHeight;
    editor.scrollTo({ top: Math.max(60, topo - presos - 6), behavior: "smooth" });
  }
}));

/* ---------- ajustes / reanálise ---------- */

$("#recalcular").addEventListener("click", async () => {
  const p = estado.projeto;
  guardarHistorico();
  try {
    const novo = await enviar(`/api/projetos/${p.id}/recalcular`, "POST", { config: lerOpcoes($("#opcoes-ajustes")) });
    p.cortes = novo.cortes;
    p.config = novo.config;
    atualizarTudo();
    carregarLegendas();
    aviso(`Pronto: ${novo.cortes.filter((c) => c.ativo).length} cortes ativos.`);
  } catch (e) { aviso(e.message, true); }
});

$("#analisar-ia").addEventListener("click", async () => {
  const p = estado.projeto;
  if (!estado.status.ia_disponivel) { abrirConfig(); return; }
  await salvarAgora();
  try {
    await enviar(`/api/projetos/${p.id}/analisar`, "POST", {
      config: { ...lerOpcoes($("#opcoes-ajustes")), usar_ia: true }, retranscrever: false,
    });
    acompanhar(p.id);
  } catch (e) { aviso(e.message, true); }
});

$("#retranscrever").addEventListener("click", async () => {
  const p = estado.projeto;
  if (!confirm("Transcrever de novo substitui as correções de texto que você fez. Continuar?")) return;
  try {
    await enviar(`/api/projetos/${p.id}/analisar`, "POST", {
      config: { modelo: $("#modelo-retranscrever").value }, retranscrever: true,
    });
    acompanhar(p.id);
  } catch (e) { aviso(e.message, true); }
});

/* ------------------------------------------------------------ filtros de cor */

// A prévia aplica a mesma LUT 3D que o ffmpeg usa na exportação, via WebGL.
const telaFiltro = $("#video-filtro");
const gl = telaFiltro.getContext("webgl", { premultipliedAlpha: false });
const N_LUT = 33;
let glPrograma = null, texVideo = null, texLut = null, lutCarregada = null, comparando = false;

function iniciarWebGL() {
  if (!gl || glPrograma) return !!gl;
  const vs = `attribute vec2 p; varying vec2 uv;
    void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `precision mediump float;
    varying vec2 uv; uniform sampler2D video; uniform sampler2D lut; uniform float intens;
    const float N = ${N_LUT}.0;
    vec3 aplicar(vec3 c) {
      float b = c.b * (N - 1.0);
      float b0 = floor(b); float b1 = min(b0 + 1.0, N - 1.0);
      float x = c.r * (N - 1.0) + 0.5; float y = (c.g * (N - 1.0) + 0.5) / N;
      vec3 a0 = texture2D(lut, vec2((b0 * N + x) / (N * N), y)).rgb;
      vec3 a1 = texture2D(lut, vec2((b1 * N + x) / (N * N), y)).rgb;
      return mix(a0, a1, b - b0);
    }
    void main() {
      vec3 c = texture2D(video, uv).rgb;
      gl_FragColor = vec4(mix(c, aplicar(c), intens), 1.0);
    }`;
  const compilar = (tipo, src) => { const sh = gl.createShader(tipo); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
  glPrograma = gl.createProgram();
  gl.attachShader(glPrograma, compilar(gl.VERTEX_SHADER, vs));
  gl.attachShader(glPrograma, compilar(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(glPrograma);
  gl.useProgram(glPrograma);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(glPrograma, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const textura = (unidade) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unidade);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  texVideo = textura(0);
  texLut = textura(1);
  gl.uniform1i(gl.getUniformLocation(glPrograma, "video"), 0);
  gl.uniform1i(gl.getUniformLocation(glPrograma, "lut"), 1);
  return true;
}

async function carregarLut(fid) {
  if (fid === "natural" || !iniciarWebGL()) { lutCarregada = null; return; }
  const bytes = new Uint8Array(await (await fetch(`/api/filtros/${fid}/lut`)).arrayBuffer());
  if (estado.projeto?.filtro?.id !== fid) return;   // trocou de filtro enquanto baixava
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texLut);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, N_LUT * N_LUT, N_LUT, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes);
  lutCarregada = fid;
}

let marcaFiltro = "";
function desenharFiltro() {
  const f = estado.projeto?.filtro;
  const ativo = f && f.id !== "natural" && f.intensidade > 0 && lutCarregada === f.id
    && !comparando && video.readyState >= 2;
  telaFiltro.hidden = !ativo;
  if (!ativo) return;
  const caixa = $("#video-caixa").getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(video.offsetWidth * dpr), h = Math.round(video.offsetHeight * dpr);
  const marca = `${video.currentTime}|${w}|${h}|${f.id}|${f.intensidade}`;
  if (video.paused && marca === marcaFiltro) return;
  marcaFiltro = marca;
  if (telaFiltro.width !== w || telaFiltro.height !== h) { telaFiltro.width = w; telaFiltro.height = h; }
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texVideo);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  gl.uniform1f(gl.getUniformLocation(glPrograma, "intens"), f.intensidade);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

async function montarFiltros() {
  const grade = $("#grade-filtros");
  const p = estado.projeto;
  if (!estado.listaFiltros) estado.listaFiltros = await api("/api/filtros");
  if (grade.dataset.pid !== p.id) {
    grade.dataset.pid = p.id;
    grade.innerHTML = estado.listaFiltros.map((f) => `
      <button class="filtro-item" data-fid="${f.id}" title="${escapar(f.descricao)}">
        <img src="/api/projetos/${p.id}/filtros/${f.id}.jpg" alt="" loading="lazy"><span>${escapar(f.nome)}</span>
      </button>`).join("");
  }
  for (const b of $$(".filtro-item", grade)) b.classList.toggle("ativo", b.dataset.fid === p.filtro.id);
  $("#intensidade").value = Math.round(p.filtro.intensidade * 100);
  $("#intensidade-valor").textContent = `${$("#intensidade").value}%`;
  $("#faixa-intensidade").hidden = p.filtro.id === "natural";
  if (!gl) $("#comparar").textContent = "Seu navegador não mostra a prévia do filtro, mas ele é aplicado ao exportar.";
}

$("#grade-filtros").addEventListener("click", (e) => {
  const b = e.target.closest(".filtro-item");
  if (!b) return;
  estado.projeto.filtro = { ...estado.projeto.filtro, id: b.dataset.fid };
  carregarLut(b.dataset.fid);
  montarFiltros();
  agendarSalvar();
});
$("#intensidade").addEventListener("input", (e) => {
  estado.projeto.filtro.intensidade = e.target.value / 100;
  $("#intensidade-valor").textContent = `${e.target.value}%`;
  agendarSalvar();
});
const soltarComparar = () => (comparando = false);
$("#comparar").addEventListener("pointerdown", () => (comparando = true));
$("#comparar").addEventListener("pointerup", soltarComparar);
$("#comparar").addEventListener("pointerleave", soltarComparar);

/* ------------------------------------------------------------ zoom e tracking */

// Mesma conta do app/movimento.py: a prévia mostra exatamente o que sai na exportação.
const ZOOM_MAX = 1.35, RAMPA = 0.35, ALTURA_ROSTO = 0.10;
const suaveJS = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

function zoomEm(t, m) {
  let extra = 0;   // sobrepostos não somam: vale o mais forte
  for (const zm of m.zooms) {
    if (!zm.ativo || t < zm.inicio || t > zm.fim) continue;
    let e = 1;
    if (zm.estilo !== "corte") {
      const r = Math.min(RAMPA, (zm.fim - zm.inicio) / 3);
      e = suaveJS(Math.min((t - zm.inicio) / r, (zm.fim - t) / r, 1));
    }
    extra = Math.max(extra, zm.intensidade * e);
  }
  return Math.min(1 + m.zoom_base + extra, ZOOM_MAX);
}

function centroEm(t, m, tr) {
  if (!m.tracking || !tr || !tr.t || !tr.t.length) return [0.5, 0.5];
  const ts = tr.t;
  if (t <= ts[0]) return [tr.x[0], tr.y[0]];
  if (t >= ts[ts.length - 1]) return [tr.x[ts.length - 1], tr.y[ts.length - 1]];
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const md = (lo + hi) >> 1; if (ts[md] <= t) lo = md; else hi = md; }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo]);
  return [tr.x[lo] + (tr.x[hi] - tr.x[lo]) * f, tr.y[lo] + (tr.y[hi] - tr.y[lo]) * f];
}

/* ---------- formato e enquadramento (mesma conta do movimento.py: prévia = exportação) ---------- */

const FORMATOS = { original: null, "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9] };
const ENQ_PADRAO = { formato: "original", escala: 1, x: 0, y: 0, rotacao: 0 };
const enq = () => estado.enq || ENQ_PADRAO;

// largura/altura do vídeo final
function proporcaoQuadro() {
  const f = FORMATOS[enq().formato];
  if (f) return f[0] / f[1];
  const m = estado.projeto?.meta;
  return video.videoWidth ? video.videoWidth / video.videoHeight : m ? m.largura / m.altura : 16 / 9;
}

// [a, b, e, f]: leva o ponto (x, y) do vídeo (w x h) para o quadro (W x H):
// x' = a·x − b·y + e ; y' = b·x + a·y + f
function geometria(t, w, h, W, H) {
  const m = estado.mov, q = enq();
  const z = m ? zoomEm(t, m) : 1;
  const s = Math.min(W / w, H / h) * q.escala * z;
  let px = w / 2, py = h / 2;
  if (m && m.tracking && estado.trilha?.t?.length) {
    const [fx, fy] = centroEm(t, m, estado.trilha);
    const forca = m.forca_tracking ?? 0.7;
    const ex = W / 2 / s, ey = H / 2 / s;
    if (ex < w / 2) px = Math.min(Math.max(w / 2 + forca * (fx * w - w / 2), ex), w - ex);
    if (ey < h / 2) {
      const alvo = fy * h + ALTURA_ROSTO * 2 * ey;
      py = Math.min(Math.max(h / 2 + forca * (alvo - h / 2), ey), h - ey);
    }
  }
  const th = q.rotacao * Math.PI / 180, a = s * Math.cos(th), b = s * Math.sin(th);
  const cx = W / 2 + q.x * W, cy = H / 2 + q.y * H;
  return [a, b, cx - (a * px - b * py), cy - (b * px + a * py)];
}

const quadroEl = $("#quadro");
const quadroRect = () => quadroEl.getBoundingClientRect();

// O quadro tem o formato do vídeo final (9:16, 1:1...); o vídeo fica dentro dele.
function ajustarQuadro() {
  const caixa = $("#video-caixa");
  if (!video.videoWidth) return;
  const ar = proporcaoQuadro();
  const alt = Math.min(caixa.clientWidth / ar, caixa.clientHeight);
  quadroEl.style.width = `${Math.floor(alt * ar)}px`;
  quadroEl.style.height = `${Math.floor(alt)}px`;
  transformAtual = "x";
  legendaAtual = "";
  posicionarBarraTamanho();
}
new ResizeObserver(ajustarQuadro).observe($("#video-caixa"));
video.addEventListener("loadedmetadata", ajustarQuadro);

// No celular a caixa do vídeo se adapta ao vídeo: em pé aparece inteiro (até 60% da tela),
// deitado fica centralizado com faixas pretas e sobra espaço embaixo. Ao rolar a página,
// vídeo e linha do tempo ficam presos no alto e o vídeo encolhe para caber o resto.
const ALTURA_CHEIA = 0.6, ALTURA_COMPACTA = 0.3;
function ajustarCaixaCelular() {
  const caixa = $("#video-caixa"), editor = $("#tela-editor");
  if (!celular.matches || caixa.classList.contains("cheia")) {
    caixa.style.height = "";
    editor.style.removeProperty("--alt-video");
    return;
  }
  const largura = caixa.clientWidth || window.innerWidth - 16;
  const proporcao = 1 / proporcaoQuadro();
  // vídeo deitado: no mínimo uma caixa 16:9 (faixas pretas em cima e embaixo)
  const natural = Math.max(largura * proporcao, largura * 9 / 16);
  const limite = window.innerHeight * (editor.classList.contains("compacto") ? ALTURA_COMPACTA : ALTURA_CHEIA);
  const alt = Math.round(Math.max(150, Math.min(natural, limite)));
  caixa.style.height = `${alt}px`;
  editor.style.setProperty("--alt-video", `${alt + 8}px`);
}
video.addEventListener("loadedmetadata", ajustarCaixaCelular);
window.addEventListener("resize", ajustarCaixaCelular);
celular.addEventListener("change", ajustarCaixaCelular);
$("#tela-editor").addEventListener("scroll", () => {
  if (!celular.matches) return;
  const editor = $("#tela-editor"), y = editor.scrollTop;
  // folga para não ficar abrindo e fechando no meio do caminho
  const compacto = editor.classList.contains("compacto") ? y > 4 : y > 50;
  if (compacto !== editor.classList.contains("compacto")) {
    editor.classList.toggle("compacto", compacto);
    ajustarCaixaCelular();
  }
}, { passive: true });

let transformAtual = "";
function aplicarMovimento(t) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const W = quadroEl.clientWidth, H = quadroEl.clientHeight;
  if (!vw || !W || !H) return;
  // o elemento <video> tem o tamanho "inteiro no quadro"; a matriz faz o resto
  const c0 = Math.min(W / vw, H / vh);
  const [a, b, e, f] = geometria(t, vw, vh, W, H);
  const tam = [vw * c0, vh * c0].map((v) => `${v.toFixed(2)}px`);
  const tr = `matrix(${(a / c0).toFixed(5)}, ${(b / c0).toFixed(5)}, ${(-b / c0).toFixed(5)}, ${(a / c0).toFixed(5)}, ${e.toFixed(2)}, ${f.toFixed(2)})`;
  if (tr + tam === transformAtual) return;
  transformAtual = tr + tam;
  for (const el of [videoA, videoB, telaFiltro]) {
    el.style.width = tam[0];
    el.style.height = tam[1];
    el.style.transform = tr;
  }
}

/* ---------- aba Formato: escolha do formato, gestos no vídeo e tracking ---------- */

function montarFormato() {
  const q = enq();
  $$("#formatos button").forEach((b) => b.classList.toggle("ativo", b.dataset.formato === q.formato));
  $("#enq-escala").value = Math.round(q.escala * 100);
  $("#enq-escala-valor").textContent = `${Math.round(q.escala * 100)}%`;
  $("#enq-rotacao").value = Math.round(q.rotacao);
  $("#enq-rotacao-valor").textContent = `${Math.round(q.rotacao)}°`;
  const m = estado.mov;
  $("#opcoes-tracking").innerHTML = m ? [
    campoAlternar("tracking", "Seguir o rosto", "O enquadramento acompanha você", m.tracking),
    campoFaixa("forca_tracking", "Intensidade do tracking", "Fica no centro ← → segue o rosto de perto",
      Math.round((m.forca_tracking ?? 0.7) * 100), 0, 100, 5, "%"),
  ].join("") : `<p class="vazio">Tracking indisponível neste projeto.</p>`;
  for (const r of $$("#opcoes-tracking input[type=range]")) {
    r.addEventListener("input", () => (r.previousElementSibling.textContent = r.value + r.dataset.unidade));
  }
  infoRosto();
}

function mudouEnquadramento({ formato = false } = {}) {
  const q = estado.enq;
  q.escala = Math.min(5, Math.max(0.2, q.escala));
  q.x = Math.min(1.5, Math.max(-1.5, q.x));
  q.y = Math.min(1.5, Math.max(-1.5, q.y));
  q.rotacao = ((q.rotacao % 360) + 540) % 360 - 180;
  if (formato) { ajustarQuadro(); ajustarCaixaCelular(); legendaAtual = ""; }
  transformAtual = "x";
  montarFormato();
  agendarSalvar();
}

// quanto aumentar para o vídeo cobrir o quadro todo (sem faixas pretas), também girado 90°
function escalaPreencher() {
  const av = (video.videoWidth || 16) / (video.videoHeight || 9), ac = proporcaoQuadro();
  const c = Math.min(ac / av, 1);                     // "inteiro" (quadro com altura 1)
  const giro = Math.abs(Math.round(enq().rotacao / 90)) % 2 === 1;
  const [lv, hv] = giro ? [1, av] : [av, 1];          // tamanho do vídeo já girado
  return Math.max(ac / (lv * c), 1 / (hv * c));
}

$("#formatos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-formato]");
  if (!b || !estado.enq) return;
  guardarHistorico();
  Object.assign(estado.enq, { formato: b.dataset.formato, escala: 1, x: 0, y: 0 });
  mudouEnquadramento({ formato: true });
});
$("#enq-escala").addEventListener("pointerdown", () => guardarHistorico());
$("#enq-escala").addEventListener("input", (e) => { estado.enq.escala = +e.target.value / 100; mudouEnquadramento(); });
$("#enq-rotacao").addEventListener("pointerdown", () => guardarHistorico());
$("#enq-rotacao").addEventListener("input", (e) => { estado.enq.rotacao = +e.target.value; mudouEnquadramento(); });
$("#aba-formato").addEventListener("click", (e) => {
  const b = e.target.closest("[data-enq]");
  if (!b || !estado.enq) return;
  guardarHistorico();
  const q = estado.enq;
  if (b.dataset.enq === "inteiro") Object.assign(q, { escala: 1, x: 0, y: 0 });
  else if (b.dataset.enq === "preencher") Object.assign(q, { escala: escalaPreencher(), x: 0, y: 0 });
  else if (b.dataset.enq === "centralizar") Object.assign(q, { x: 0, y: 0, rotacao: 0 });
  else if (b.dataset.enq === "esquerda") q.rotacao -= 90;
  else if (b.dataset.enq === "direita") q.rotacao += 90;
  mudouEnquadramento();
});
$("#opcoes-tracking").addEventListener("input", (e) => {
  const i = e.target.closest("[data-chave]");
  if (!i || !estado.mov) return;
  estado.mov[i.dataset.chave] = i.type === "checkbox" ? i.checked : parseFloat(i.value) / 100;
  transformAtual = "x";
  agendarSalvar();
});

// Gestos no vídeo (só com a aba Formato aberta): 1 dedo move, 2 dedos aumentam/diminuem e giram.
const caixaVideo = $("#video-caixa");
const enquadrando = () => abaAtiva() === "formato" && !!estado.enq && !caixaVideo.classList.contains("cheia");
let gestoEnq = null;
const ima = (v, alvo, folga) => (Math.abs(v - alvo) < folga ? alvo : v);   // "gruda" no centro / no reto

function infoDedos(ts) {
  if (ts.length < 2) return { x: ts[0].clientX, y: ts[0].clientY };
  const [p, q] = [ts[0], ts[1]];
  return { x: (p.clientX + q.clientX) / 2, y: (p.clientY + q.clientY) / 2,
    d: Math.hypot(q.clientX - p.clientX, q.clientY - p.clientY),
    ang: Math.atan2(q.clientY - p.clientY, q.clientX - p.clientX) * 180 / Math.PI };
}

function comecarGesto(pontos) {
  gestoEnq = { ini: infoDedos(pontos), enq: { ...estado.enq }, n: pontos.length };
}

function moverGesto(pontos) {
  const g = gestoEnq, a = infoDedos(pontos), q = estado.enq;
  const W = quadroEl.clientWidth || 1, H = quadroEl.clientHeight || 1;
  if (pontos.length !== g.n) { comecarGesto(pontos); return; }   // pôs ou tirou um dedo
  q.x = ima(g.enq.x + (a.x - g.ini.x) / W, 0, 0.015);
  q.y = ima(g.enq.y + (a.y - g.ini.y) / H, 0, 0.015);
  if (pontos.length >= 2 && g.ini.d > 10) {
    q.escala = g.enq.escala * a.d / g.ini.d;
    const giro = g.enq.rotacao + (a.ang - g.ini.ang);
    q.rotacao = ima(ima(ima(giro, 0, 4), 90, 4), -90, 4);
  }
  mudouEnquadramento();
}

caixaVideo.addEventListener("touchstart", (e) => {
  if (!enquadrando() || e.target.closest("button, .barra-tamanho")) return;
  e.preventDefault();
  if (!gestoEnq) guardarHistorico();
  comecarGesto(e.touches);
}, { passive: false });
caixaVideo.addEventListener("touchmove", (e) => {
  if (!gestoEnq) return;
  e.preventDefault();
  moverGesto(e.touches);
}, { passive: false });
caixaVideo.addEventListener("touchend", (e) => {
  if (!gestoEnq) return;
  if (e.touches.length) comecarGesto(e.touches); else gestoEnq = null;
});
caixaVideo.addEventListener("mousedown", (e) => {
  if (!enquadrando() || e.target.closest("button, .barra-tamanho")) return;
  e.preventDefault();
  guardarHistorico();
  comecarGesto([e]);
  const mover = (ev) => moverGesto([ev]);
  const soltar = () => { gestoEnq = null; window.removeEventListener("mousemove", mover); window.removeEventListener("mouseup", soltar); };
  window.addEventListener("mousemove", mover);
  window.addEventListener("mouseup", soltar);
});
caixaVideo.addEventListener("wheel", (e) => {
  if (!enquadrando()) return;
  e.preventDefault();
  estado.enq.escala *= Math.exp(-e.deltaY * 0.0015);
  mudouEnquadramento();
}, { passive: false });

function montarMovimento() {
  const m = estado.mov;
  const el = $("#opcoes-movimento");
  if (!m) { el.innerHTML = `<p class="vazio">Zoom indisponível neste projeto.</p>`; return; }
  el.innerHTML = [
    campoFaixa("zoom_base", "Aproximação fixa", "Deixa o vídeo sempre um pouco mais perto, dando espaço para o tracking", Math.round(m.zoom_base * 100), 0, 20, 1, "%"),
    campoAlternar("auto", "Zooms automáticos", "Coloca zoom in / zoom out em começos de frase, perguntas e destaques", m.auto),
    campoFaixa("sensibilidade", "Sensibilidade", "Poucos zooms ← → muitos zooms", Math.round(m.sensibilidade * 100), 0, 100, 5, "%"),
    campoFaixa("intensidade", "Intensidade do zoom", "Quanto aproxima. 10–15% é sutil e profissional", Math.round(m.intensidade * 100), 3, 25, 1, "%"),
    `<div class="campo">Estilo do zoom <div class="segmentado" data-seg-mov="estilo">
      <button type="button" data-v="suave" class="${m.estilo === "suave" ? "ativo" : ""}">Suave (aproxima devagar)</button>
      <button type="button" data-v="corte" class="${m.estilo === "corte" ? "ativo" : ""}">Corte seco (punch-in)</button></div></div>`,
  ].join("");
  for (const r of $$("input[type=range]", el)) {
    r.addEventListener("input", () => (r.previousElementSibling.textContent = r.value + r.dataset.unidade));
  }
  infoRosto();
}

function infoRosto() {
  const tr = estado.trilha;
  const el = $("#info-rosto");
  if (!tr) {
    el.innerHTML = `Este projeto ainda não tem o rosto mapeado. <button class="btn-mini" id="procurar-rosto">Procurar rosto</button>`;
    $("#procurar-rosto").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Procurando…";
      try {
        estado.trilha = (await api(`/api/projetos/${estado.projeto.id}/rosto/detectar`, { method: "POST" })).trilha;
      } catch (err) { aviso(err.message, true); }
      infoRosto();
    });
  } else if (!tr.t.length) {
    el.textContent = "Não encontrei um rosto na maior parte do vídeo: os zooms ficam centralizados.";
  } else {
    el.textContent = `✓ Rosto encontrado em ${Math.round(tr.cobertura * 100)}% do vídeo.`;
  }
}

let refazerTimer = null;
function agendarRefazer() {
  clearTimeout(refazerTimer);
  refazerTimer = setTimeout(async () => {
    try {
      estado.mov = await enviar(`/api/projetos/${estado.projeto.id}/movimento/automatico`, "POST", { movimento: estado.mov });
      renderZooms();
      desenharLinhaTempo();
    } catch (e) { aviso(e.message, true); }
  }, 450);
}

$("#opcoes-movimento").addEventListener("input", (e) => {
  const i = e.target.closest("[data-chave]");
  if (!i || !estado.mov) return;
  const k = i.dataset.chave;
  estado.mov[k] = i.type === "checkbox" ? i.checked : parseFloat(i.value) / 100;
  if (k === "tracking" || k === "zoom_base") { transformAtual = "x"; agendarSalvar(); }
  else agendarRefazer();
});
$("#opcoes-movimento").addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg-mov] button");
  if (!b) return;
  $$("button", b.parentElement).forEach((x) => x.classList.toggle("ativo", x === b));
  estado.mov.estilo = b.dataset.v;
  agendarRefazer();
});
$("#refazer-zooms").addEventListener("click", () => {
  guardarHistorico();
  estado.mov.auto = true;
  montarMovimento();
  agendarRefazer();
  aviso("Zooms automáticos refeitos. Os que você mexeu ficam como estão.");
});
$("#adicionar-zoom").addEventListener("click", () => {
  if (!estado.mov) return;
  guardarHistorico();
  const t = video.currentTime;
  estado.mov.zooms.push({
    id: novoId(), inicio: +t.toFixed(3), fim: +Math.min(duracao(), t + 2.5).toFixed(3),
    intensidade: estado.mov.intensidade, estilo: estado.mov.estilo, origem: "manual", ativo: true,
  });
  estado.mov.zooms.sort((a, b) => a.inicio - b.inicio);
  alterouMovimento();
});

function alterouMovimento() {
  transformAtual = "x";
  renderZooms();
  desenharLinhaTempo();
  agendarSalvar();
}

function renderZooms() {
  const lista = $("#lista-zooms");
  const zs = estado.mov?.zooms || [];
  $("#contagem-zooms").textContent = zs.length ? `(${zs.filter((z) => z.ativo).length} ativos)` : "";
  if (!zs.length) {
    lista.innerHTML = `<li class="vazio">Nenhum zoom. Ligue os automáticos ou use “＋ Zoom aqui”.</li>`;
    return;
  }
  lista.innerHTML = zs.map((z, i) => `
    <li class="zoom-item ${z.ativo ? "" : "inativo"}" data-id="${z.id}">
      <div class="zoom-titulo" data-ir>Zoom ${i + 1} · ${fmt(z.inicio, true)}
        <small>${(z.fim - z.inicio).toFixed(1)}s · ${z.origem === "auto" ? "automático" : "seu"}</small></div>
      <div class="zoom-acoes">
        <button class="icone" data-ver title="Ver este zoom">▶</button>
        <button class="icone" data-mover="-0.5" title="Mover para trás">◀</button>
        <button class="icone" data-mover="0.5" title="Mover para frente">▶▶</button>
        <label class="alternar" title="Ligar/desligar"><input type="checkbox" data-ativo ${z.ativo ? "checked" : ""}><span class="alternar-trilho"></span></label>
        <button class="icone" data-apagar title="Remover">✕</button>
      </div>
      <div class="zoom-ajustes">
        <span>Duração <button class="btn-mini" data-dur="-0.5">−</button> <button class="btn-mini" data-dur="0.5">+</button></span>
        <label>Intensidade <input type="range" min="3" max="25" step="1" value="${Math.round(z.intensidade * 100)}" data-intens> ${Math.round(z.intensidade * 100)}%</label>
        <select data-estilo><option value="suave" ${z.estilo === "suave" ? "selected" : ""}>Suave</option>
          <option value="corte" ${z.estilo === "corte" ? "selected" : ""}>Corte seco</option></select>
      </div>
    </li>`).join("");
}

function zoomPorId(id) { return estado.mov.zooms.find((z) => z.id === id); }
function mexeuNoZoom(z) { z.origem = "manual"; }   // os automáticos refeitos não apagam o que você ajustou

$("#lista-zooms").addEventListener("click", (e) => {
  const li = e.target.closest(".zoom-item");
  if (!li) return;
  const z = zoomPorId(li.dataset.id);
  const dur = duracao();
  if (e.target.closest("[data-ativo]")) { guardarHistorico(); z.ativo = e.target.checked; mexeuNoZoom(z); alterouMovimento(); return; }
  if (e.target.closest(".alternar")) return;
  if (e.target.closest("[data-apagar]")) {
    guardarHistorico();
    estado.mov.zooms = estado.mov.zooms.filter((x) => x !== z);
    alterouMovimento();
    return;
  }
  const mover = e.target.closest("[data-mover]");
  if (mover) {
    guardarHistorico();
    const d = Math.max(-z.inicio, Math.min(dur - z.fim, parseFloat(mover.dataset.mover)));
    z.inicio = +(z.inicio + d).toFixed(3); z.fim = +(z.fim + d).toFixed(3);
    mexeuNoZoom(z); alterouMovimento(); irPara(z.inicio - 0.3);
    return;
  }
  const dd = e.target.closest("[data-dur]");
  if (dd) {
    guardarHistorico();
    z.fim = +Math.max(z.inicio + 0.6, Math.min(dur, z.fim + parseFloat(dd.dataset.dur))).toFixed(3);
    mexeuNoZoom(z); alterouMovimento();
    return;
  }
  if (e.target.closest("[data-ver]") || e.target.closest("[data-ir]")) {
    estado.ouvindo = { fim: Math.min(dur, z.fim + 0.5) };
    video.currentTime = Math.max(0, z.inicio - 0.6);
    video.play();
  }
});
$("#lista-zooms").addEventListener("change", (e) => {
  const li = e.target.closest(".zoom-item");
  if (!li) return;
  const z = zoomPorId(li.dataset.id);
  if (e.target.matches("[data-intens]")) { guardarHistorico(); z.intensidade = e.target.value / 100; }
  else if (e.target.matches("[data-estilo]")) { guardarHistorico(); z.estilo = e.target.value; }
  else return;
  mexeuNoZoom(z);
  alterouMovimento();
});

/* ------------------------------------------------------------ linha do tempo */

const rolagem = $("#lt-rolagem");
const canvas = $("#lt-canvas");
const ctx = canvas.getContext("2d");
let ALTURA_LT = 120;
let pps = 60;   // pixels por segundo
const larguraLT = () => duracao() * pps;

function montarLegendaCores() {
  const usados = new Set(cortes().map((c) => c.tipo));
  $("#legenda-cores").innerHTML = Object.entries(TIPOS).filter(([t]) => usados.has(t))
    .map(([, i]) => `<span><span class="bolinha" style="background:${i.cor}"></span>${i.nome}</span>`).join("");
}

function redimensionarLinhaTempo() {
  const dpr = window.devicePixelRatio || 1;
  const largura = rolagem.clientWidth;
  ALTURA_LT = rolagem.clientHeight || 120;
  canvas.width = largura * dpr;
  canvas.height = ALTURA_LT * dpr;
  canvas.style.width = `${largura}px`;
  canvas.style.height = `${ALTURA_LT}px`;
  canvas.style.marginTop = `-1px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Ao abrir, ajusta o zoom para o vídeo inteiro caber na tela.
  if (!rolagem.dataset.ajustado && duracao()) {
    pps = Math.max(10, Math.min(400, (largura - 20) / duracao()));
    $("#zoom").value = pps;
    rolagem.dataset.ajustado = "1";
  }
  $("#lt-espaco").style.width = `${larguraLT()}px`;
  desenharLinhaTempo();
}
new ResizeObserver(redimensionarLinhaTempo).observe(rolagem);
rolagem.addEventListener("scroll", desenharLinhaTempo);

function mudarZoomLT(novo, t = video.currentTime) {
  const x = t * pps - rolagem.scrollLeft;   // o ponto t fica no mesmo lugar da tela
  const cabeTudo = duracao() ? (rolagem.clientWidth - 20) / duracao() : 10;   // vídeo inteiro na tela
  pps = Math.max(Math.min(10, cabeTudo), Math.min(400, novo));
  $("#zoom").value = pps;
  $("#lt-espaco").style.width = `${larguraLT()}px`;
  rolagem.scrollLeft = t * pps - x;
  desenharLinhaTempo();
}
$("#zoom").addEventListener("input", (e) => mudarZoomLT(+e.target.value));

// Rodinha do mouse na linha do tempo: aproxima/afasta no ponto do mouse (como no CapCut).
// Shift + rodinha (ou deslizar de lado no touchpad) rola para os lados.
rolagem.addEventListener("wheel", (e) => {
  e.preventDefault();
  const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (horizontal) {
    rolagem.scrollLeft += e.deltaX || e.deltaY;
    return;
  }
  const passo = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;   // linhas -> pixels (Firefox)
  const t = (rolagem.scrollLeft + e.clientX - rolagem.getBoundingClientRect().left) / pps;
  mudarZoomLT(pps * Math.exp(-passo * 0.0018), t);
}, { passive: false });

// Toque (celular): o dedo leva a agulha — tocar pula para o ponto e arrastar vai junto
// (perto das bordas a linha do tempo anda sozinha). Dois dedos aproximam e rolam.
let toqueLT = null, bordaLT = null;
const distDedos = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
const meioDedos = (ts) => (ts[0].clientX + ts[1].clientX) / 2;
const xNaLT = (clientX) => clientX - rolagem.getBoundingClientRect().left;

let buscaPendente = null;
function buscarSuave(t) {
  estado.tempoAlvo = t;   // a agulha anda junto com o dedo, mesmo antes do vídeo chegar lá
  if (video.seeking) { buscaPendente = t; return; }
  if (Math.abs(t - video.currentTime) > 0.01) video.currentTime = t;
}
videos.forEach((v) => v.addEventListener("seeked", (e) => {
  if (e.target !== video || buscaPendente == null) return;
  const t = buscaPendente;
  buscaPendente = null;
  if (Math.abs(t - video.currentTime) > 0.01) video.currentTime = t;
}));

function agulhaNoDedo(clientX) {
  buscarSuave(Math.max(0, Math.min(duracao(), (rolagem.scrollLeft + xNaLT(clientX)) / pps)));
  estado.ouvindo = null;
  desenharLinhaTempo(true);
}

// Borda de um corte perto do dedo/mouse (para arrastar e ajustar o corte)
function bordaPerto(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (clientY - r.top < 16 || clientY - r.top > ALTURA_LT - FAIXA_ZOOM - 2) return null;
  const x = rolagem.scrollLeft + clientX - r.left, raio = 14;
  let melhor = null;
  for (const c of cortes()) {
    if (!c.ativo || (c.fim - c.inicio) * pps < 18) continue;
    for (const lado of ["inicio", "fim"]) {
      const d = Math.abs(c[lado] * pps - x);
      if (d <= raio && (!melhor || d < melhor.d)) melhor = { c, lado, d };
    }
  }
  return melhor;
}

function arrastarBorda(b, clientX) {
  if (!b.mexeu) { guardarHistorico(); b.mexeu = true; }
  const r = canvas.getBoundingClientRect();
  let t = Math.max(0, Math.min(duracao(), (rolagem.scrollLeft + clientX - r.left) / pps));
  if (b.lado === "inicio") t = Math.min(t, b.c.fim - 0.05); else t = Math.max(t, b.c.inicio + 0.05);
  b.c[b.lado] = +t.toFixed(3);
  b.c.origem = "manual";   // você ajustou: "Aplicar ajustes" não desfaz
  buscarSuave(t);
  $("#lt-dica").textContent = `${b.c.titulo || "Corte"}: ${fmt(b.c.inicio, true)} – ${fmt(b.c.fim, true)} (${(b.c.fim - b.c.inicio).toFixed(2)}s)`;
  mesclarAtivos();
  desenharLinhaTempo();
}

function andarNaBorda() {
  clearInterval(bordaLT);
  bordaLT = setInterval(() => {
    if (!toqueLT || toqueLT.pinca) return clearInterval(bordaLT);
    const x = xNaLT(toqueLT.x), w = rolagem.clientWidth, faixa = 36;
    const v = x < faixa ? -(faixa - x) : x > w - faixa ? x - (w - faixa) : 0;
    if (!v) return;
    rolagem.scrollLeft += v * 0.6;
    agulhaNoDedo(toqueLT.x);
  }, 30);
}

rolagem.addEventListener("touchstart", (e) => {
  e.preventDefault();   // sem "clique" emulado e sem rolar a página
  if (!video.paused) video.pause();
  if (e.touches.length >= 2) {
    const mx = meioDedos(e.touches);
    toqueLT = { pinca: true, d: distDedos(e.touches), pps, t: (rolagem.scrollLeft + xNaLT(mx)) / pps };
    return;
  }
  cancelarEmbalo();
  const x = e.touches[0].clientX;
  const borda = bordaPerto(x, e.touches[0].clientY);
  if (borda) { toqueLT = { borda }; return; }
  // pegou na agulha: arrasta a agulha (o vídeo acompanha)
  const xAgulha = rolagem.getBoundingClientRect().left + video.currentTime * pps - rolagem.scrollLeft;
  if (Math.abs(x - xAgulha) <= 22) {
    toqueLT = { x, agulha: true };
    agulhaNoDedo(x);
    andarNaBorda();
    return;
  }
  // senão: arrastar rola a linha do tempo para os lados; um toque leva a agulha até ali
  toqueLT = { x, x0: x, sl0: rolagem.scrollLeft, t0: performance.now(), vel: 0, ultX: x, ultT: performance.now() };
}, { passive: false });
rolagem.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!toqueLT) return;
  if (toqueLT.pinca && e.touches.length >= 2) {
    // o ponto entre os dedos fica embaixo deles: aproxima/afasta e rola ao mesmo tempo
    pps = Math.max(10, Math.min(400, toqueLT.pps * distDedos(e.touches) / toqueLT.d));
    $("#zoom").value = pps;
    $("#lt-espaco").style.width = `${larguraLT()}px`;
    rolagem.scrollLeft = toqueLT.t * pps - xNaLT(meioDedos(e.touches));
    desenharLinhaTempo();
  } else if (toqueLT.borda) {
    arrastarBorda(toqueLT.borda, e.touches[0].clientX);
  } else if (toqueLT.agulha) {
    toqueLT.x = e.touches[0].clientX;
    agulhaNoDedo(toqueLT.x);
  } else if (!toqueLT.pinca) {
    const x = e.touches[0].clientX, agora = performance.now();
    rolagem.scrollLeft = toqueLT.sl0 - (x - toqueLT.x0);
    const dt = Math.max(1, agora - toqueLT.ultT);
    toqueLT.vel = 0.8 * ((toqueLT.ultX - x) / dt) + 0.2 * toqueLT.vel;   // px por ms
    toqueLT.ultX = x;
    toqueLT.ultT = agora;
    toqueLT.x = x;
  }
}, { passive: false });

// Embalo depois de soltar o dedo (como rolar uma lista no celular).
let embalo = 0;
function cancelarEmbalo() { cancelAnimationFrame(embalo); embalo = 0; }
function rolarComEmbalo(vel) {
  cancelarEmbalo();
  let ultimo = performance.now();
  const passo = (agora) => {
    const dt = agora - ultimo;
    ultimo = agora;
    rolagem.scrollLeft += vel * dt;
    vel *= Math.pow(0.995, dt);   // vai freando
    if (Math.abs(vel) > 0.02) embalo = requestAnimationFrame(passo); else embalo = 0;
  };
  embalo = requestAnimationFrame(passo);
}
const fimToque = (e) => {
  if (e.touches.length) return;
  if (toqueLT?.borda?.mexeu) alterou();
  if (toqueLT && toqueLT.sl0 !== undefined) {
    const andou = Math.abs(toqueLT.x - toqueLT.x0);
    if (andou < 8 && performance.now() - toqueLT.t0 < 400) {
      agulhaNoDedo(toqueLT.x0);   // toque rápido: a agulha vai até o dedo
    } else if (Math.abs(toqueLT.vel) > 0.15 && performance.now() - toqueLT.ultT < 80) {
      rolarComEmbalo(toqueLT.vel);
    }
  }
  toqueLT = null;
  estado.tempoAlvo = null;
  clearInterval(bordaLT);
};
rolagem.addEventListener("touchend", fimToque);
rolagem.addEventListener("touchcancel", fimToque);

async function carregarQuadros(pid) {
  estado.quadros = null;
  const info = await api(`/api/projetos/${pid}/quadros`).catch(() => null);
  if (!info || estado.projeto?.id !== pid) return;
  const img = new Image();
  img.onload = () => {
    if (estado.projeto?.id !== pid) return;
    estado.quadros = { ...info, img };
    desenharLinhaTempo();
  };
  img.src = `/api/projetos/${pid}/quadros.jpg?n=${info.n}`;
}

// Faixa de imagens do vídeo (como no CapCut): uma miniatura atrás da outra.
function desenharFilme(X, t0, largura, y, alt, c = cctx) {
  const q = estado.quadros, fimX = Math.min(largura, X(duracao()));
  c.save();
  c.beginPath();
  c.rect(Math.max(0, X(0)), y, fimX - Math.max(0, X(0)), alt);
  c.clip();
  if (!q) {
    c.fillStyle = "#1c2130";
    c.fillRect(0, y, largura, alt);
  } else {
    const dw = q.largura * alt / q.altura;
    const inicio = X(0) + Math.floor((0 - X(0)) / dw) * dw;
    for (let x = inicio; x < fimX; x += dw) {
      const t = t0 + (x + dw / 2) / pps;
      const i = Math.max(0, Math.min(q.n - 1, Math.floor(t / q.passo)));
      c.drawImage(q.img, i * q.largura, 0, q.largura, q.altura, Math.round(x), y, Math.ceil(dw), alt);
    }
  }
  c.restore();
}

function passoRegua() {
  for (const p of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (p * pps >= 70) return p;
  return 1200;
}

// A parte que não muda a cada quadro (régua, imagens, onda, cortes, zooms) fica guardada numa
// camada: enquanto o vídeo toca só a agulha é redesenhada — bem mais leve no celular.
const camadaLT = document.createElement("canvas");
const cctx = camadaLT.getContext("2d");
let chaveLT = "";

function desenharLinhaTempo(doLaco = false) {
  if (!estado.projeto || $("#tela-editor").hidden || !canvas.width || !canvas.height) return;
  const dpr = window.devicePixelRatio || 1;
  const largura = canvas.width / (window.devicePixelRatio || 1);
  const t0 = rolagem.scrollLeft / pps;
  const t1 = t0 + largura / pps;
  const X = (t) => (t - t0) * pps;
  // régua | imagens do vídeo | forma de onda | zooms
  const FILME = ALTURA_LT >= 140 ? 50 : 42;
  const topo = 18, base = ALTURA_LT - 15;
  const ondaTopo = topo + FILME + 3, meio = (ondaTopo + base) / 2, amp = (base - ondaTopo) / 2;

  const chave = [rolagem.scrollLeft, pps, canvas.width, canvas.height, estado.quadros ? 1 : 0].join("|");
  if (!doLaco || chave !== chaveLT) {
    chaveLT = chave;
    if (camadaLT.width !== canvas.width || camadaLT.height !== canvas.height) {
      camadaLT.width = canvas.width;
      camadaLT.height = canvas.height;
    }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, largura, ALTURA_LT);
    cctx.fillStyle = "#0f1115";
    cctx.fillRect(0, 0, largura, ALTURA_LT);

    // régua
    const passo = passoRegua();
    cctx.fillStyle = "#6c7384";
    cctx.font = "10px system-ui";
    cctx.strokeStyle = "#2a2f3a";
    cctx.beginPath();
    for (let t = Math.max(0, Math.floor(t0 / passo) * passo); t <= Math.min(t1, duracao()); t += passo) {
      const x = Math.round(X(t)) + 0.5;
      cctx.moveTo(x, 0); cctx.lineTo(x, 14);
      cctx.fillText(passo < 1 ? fmt(t, true) : fmt(t), x + 3, 10);
    }
    cctx.stroke();

    desenharFilme(X, t0, largura, topo, FILME);

    // forma de onda (50 pontos por segundo)
    const onda = estado.onda;
    cctx.fillStyle = "#4a5570";
    for (let x = 0; x < largura; x++) {
      const ia = Math.floor((t0 + x / pps) * 50), ib = Math.max(ia + 1, Math.floor((t0 + (x + 1) / pps) * 50));
      let v = 0;
      for (let i = ia; i < ib && i < onda.length; i++) if (onda[i] > v) v = onda[i];
      const h = Math.max(1, v * amp);
      cctx.fillRect(x, meio - h, 1, h * 2);
    }

    // cortes
    for (const c of cortes()) {
      if (c.fim < t0 || c.inicio > t1) continue;
      const cor = tipoInfo(c.tipo).cor;
      const xa = X(c.inicio), xb = X(c.fim);
      if (c.ativo) {
        cctx.fillStyle = "rgba(8,10,14,.55)";   // trecho cortado fica escuro nas imagens
        cctx.fillRect(xa, topo, xb - xa, FILME);
        cctx.fillStyle = hexParaRgba(cor, 0.33);
        cctx.fillRect(xa, topo, xb - xa, base - topo);
        cctx.fillStyle = cor;
        cctx.fillRect(xa, topo - 3, xb - xa, 3);
        if (xb - xa > 18) {   // alças: arraste a borda para ajustar o corte
          cctx.fillStyle = "rgba(255,255,255,.9)";
          cctx.fillRect(xa, topo + FILME / 2 - 9, 3, 18);
          cctx.fillRect(xb - 3, topo + FILME / 2 - 9, 3, 18);
        }
      } else {
        cctx.setLineDash([3, 3]);
        cctx.strokeStyle = hexParaRgba(cor, 0.9);
        cctx.strokeRect(xa + 0.5, topo + 0.5, xb - xa - 1, base - topo - 1);
        cctx.setLineDash([]);
      }
    }

    // zooms: faixa roxa embaixo (arraste para mover, puxe as pontas para mudar a duração)
    for (const z of estado.mov?.zooms || []) {
      if (z.fim < t0 || z.inicio > t1) continue;
      const xa = X(z.inicio), xb = X(z.fim);
      const y = ALTURA_LT - FAIXA_ZOOM;
      cctx.fillStyle = z.ativo ? "rgba(165,124,255,.9)" : "rgba(165,124,255,.25)";
      cctx.fillRect(xa, y, xb - xa, FAIXA_ZOOM - 2);
      if (z.ativo) {
        cctx.fillStyle = "rgba(255,255,255,.85)";
        cctx.fillRect(xa, y, 2, FAIXA_ZOOM - 2);
        cctx.fillRect(xb - 2, y, 2, FAIXA_ZOOM - 2);
        if (xb - xa > 46) {
          cctx.fillStyle = "#1b1530";
          cctx.font = "bold 9px system-ui";
          cctx.fillText(`ZOOM ${Math.round(z.intensidade * 100)}%`, xa + 5, y + 9);
        }
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(camadaLT, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // seleção
  if (estado.selecao) {
    const xa = X(estado.selecao.a), xb = X(estado.selecao.b);
    ctx.fillStyle = "rgba(255,255,255,.13)";
    ctx.fillRect(xa, 14, xb - xa, ALTURA_LT - 14);
    ctx.fillStyle = "#fff";
    ctx.fillRect(xa, 14, 1, ALTURA_LT - 14);
    ctx.fillRect(xb - 1, 14, 1, ALTURA_LT - 14);
  }

  // cursor de reprodução
  const xp = X(estado.tempoAlvo ?? video.currentTime);
  ctx.fillStyle = "#19d3c5";
  ctx.fillRect(xp - 1, 0, 2, ALTURA_LT);
  ctx.beginPath();
  ctx.moveTo(xp - 6, 0); ctx.lineTo(xp + 6, 0); ctx.lineTo(xp, 8);
  ctx.fill();
}

function seguirCursor(t) {
  if (video.paused || arrastandoLT) return;
  const x = t * pps;
  if (x < rolagem.scrollLeft || x > rolagem.scrollLeft + rolagem.clientWidth - 40) {
    rolagem.scrollLeft = x - 40;
  }
}

const tempoNoCanvas = (e) => (rolagem.scrollLeft + e.clientX - canvas.getBoundingClientRect().left) / pps;
const corteEm = (t) => [...cortes()].reverse().find((c) => t >= c.inicio && t <= c.fim && (c.tipo !== "silencio" || c.ativo))
  || cortes().find((c) => t >= c.inicio && t <= c.fim);

const FAIXA_ZOOM = 13;
const naFaixaZoom = (e) => e.clientY - canvas.getBoundingClientRect().top >= ALTURA_LT - FAIXA_ZOOM - 2;
function zoomNoPonto(e) {
  if (!estado.mov || !naFaixaZoom(e)) return null;
  const t = tempoNoCanvas(e), folga = 6 / pps;
  const z = estado.mov.zooms.find((x) => t >= x.inicio - folga && t <= x.fim + folga);
  if (!z) return null;
  const modo = Math.abs(t - z.inicio) <= folga ? "inicio" : Math.abs(t - z.fim) <= folga ? "fim" : "mover";
  return { z, modo };
}

let arrastandoLT = null;
let arrastandoZoom = null;
let bordaMouse = null;
canvas.addEventListener("mousedown", (e) => {
  const borda = bordaPerto(e.clientX, e.clientY);
  if (borda) { bordaMouse = borda; return; }
  const alvo = zoomNoPonto(e);
  if (alvo) {
    arrastandoZoom = { ...alvo, x: e.clientX, t: tempoNoCanvas(e), ini: alvo.z.inicio, fim: alvo.z.fim, mexeu: false };
    return;
  }
  arrastandoLT = { x: e.clientX, t: tempoNoCanvas(e) };
});
window.addEventListener("mousemove", (e) => {
  if (bordaMouse) { arrastarBorda(bordaMouse, e.clientX); return; }
  if (e.target === canvas && !arrastandoZoom && !arrastandoLT && bordaPerto(e.clientX, e.clientY)) {
    canvas.style.cursor = "ew-resize";
    $("#lt-dica").textContent = "Arraste a borda para ajustar onde o corte começa ou termina";
    return;
  }
  if (arrastandoZoom) {
    const a = arrastandoZoom;
    if (!a.mexeu && Math.abs(e.clientX - a.x) <= 3) return;
    if (!a.mexeu) { guardarHistorico(); a.mexeu = true; }
    const d = tempoNoCanvas(e) - a.t, dur = duracao();
    if (a.modo === "mover") {
      const dd = Math.max(-a.ini, Math.min(dur - a.fim, d));
      a.z.inicio = +(a.ini + dd).toFixed(3); a.z.fim = +(a.fim + dd).toFixed(3);
    } else if (a.modo === "inicio") {
      a.z.inicio = +Math.max(0, Math.min(a.fim - 0.6, a.ini + d)).toFixed(3);
    } else {
      a.z.fim = +Math.min(dur, Math.max(a.ini + 0.6, a.fim + d)).toFixed(3);
    }
    $("#lt-dica").textContent = `Zoom: ${fmt(a.z.inicio, true)} – ${fmt(a.z.fim, true)} (${(a.z.fim - a.z.inicio).toFixed(1)}s)`;
    transformAtual = "x";
    desenharLinhaTempo();
    return;
  }
  if (arrastandoLT) {
    if (Math.abs(e.clientX - arrastandoLT.x) > 4) {
      const t = Math.max(0, Math.min(duracao(), tempoNoCanvas(e)));
      estado.selecao = { a: Math.min(arrastandoLT.t, t), b: Math.max(arrastandoLT.t, t) };
      $("#cortar-trecho").hidden = false;
      $("#lt-dica").textContent = `Seleção: ${fmt(estado.selecao.a, true)} – ${fmt(estado.selecao.b, true)} (${(estado.selecao.b - estado.selecao.a).toFixed(1)}s) · Delete corta`;
      desenharLinhaTempo();
    }
    return;
  }
  if (e.target !== canvas) return;
  const zAlvo = zoomNoPonto(e);
  canvas.style.cursor = !zAlvo ? "crosshair" : zAlvo.modo === "mover" ? "grab" : "ew-resize";
  if (zAlvo) {
    $("#lt-dica").textContent = `Zoom ${Math.round(zAlvo.z.intensidade * 100)}% ${zAlvo.z.estilo === "corte" ? "corte seco" : "suave"} — arraste para mover, puxe as pontas para mudar a duração`;
    return;
  }
  const c = corteEm(tempoNoCanvas(e));
  $("#lt-dica").textContent = c
    ? `${c.titulo}${c.ativo ? "" : " (desligado)"} — ${c.motivo}`
    : "Clique para ir até o ponto · arraste para selecionar um trecho e cortar";
});
window.addEventListener("mouseup", (e) => {
  if (bordaMouse) {
    const b = bordaMouse;
    bordaMouse = null;
    if (b.mexeu) alterou();
    return;
  }
  if (arrastandoZoom) {
    const a = arrastandoZoom;
    arrastandoZoom = null;
    if (a.mexeu) {
      a.z.origem = "manual";
      estado.mov.zooms.sort((x, y) => x.inicio - y.inicio);
      alterouMovimento();
    } else {
      irPara(a.z.inicio);
      $$(".aba").find((b) => b.dataset.aba === "zoom").click();
      $$(".zoom-item.foco").forEach((el) => el.classList.remove("foco"));
      const el = $(`.zoom-item[data-id="${a.z.id}"]`);
      if (el) { el.classList.add("foco"); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
    return;
  }
  if (!arrastandoLT) return;
  const clique = Math.abs(e.clientX - arrastandoLT.x) <= 4;
  const t = arrastandoLT.t;
  arrastandoLT = null;
  if (clique) {
    estado.selecao = null;
    $("#cortar-trecho").hidden = true;
    irPara(t);
    const c = corteEm(t);
    if (c) {
      $$(".aba").find((a) => a.dataset.aba === "cortes").click();
      if (estado.filtro && estado.filtro !== c.tipo) { estado.filtro = null; renderFiltros(); renderCortes(); }
      focarCorte(c.id);
    }
  }
});

$("#cortar-trecho").addEventListener("click", cortarSelecaoLT);
function cortarSelecaoLT() {
  if (!estado.selecao) return;
  cortarIntervalo(estado.selecao.a, estado.selecao.b);
  estado.selecao = null;
  $("#cortar-trecho").hidden = true;
  $("#lt-dica").textContent = "Trecho cortado. Ctrl+Z desfaz.";
}

/* ------------------------------------------------------------ atalhos */

// Só não vale atalho quando a pessoa está digitando (caixas de texto, listas, diálogos).
function digitando(el) {
  if (!el || !el.closest) return false;
  if (el.closest("textarea, select, dialog[open], [contenteditable=true]")) return true;
  const i = el.closest("input");
  return !!i && !["checkbox", "radio", "range", "button", "submit", "color", "file"].includes(i.type);
}

// Espaço = tocar/pausar em qualquer lugar do editor (mesmo depois de clicar num botão ou chave:
// o espaço não "aperta" de novo o último botão clicado).
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || $("#tela-editor").hidden || digitando(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  alternarPlay();
}, true);
document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && !$("#tela-editor").hidden && !digitando(e.target)) e.preventDefault();
}, true);

document.addEventListener("keydown", (e) => {
  if ($("#tela-editor").hidden || e.target.closest("input, select, textarea, dialog[open]")) return;
  if (e.code === "Space") return;   // tratado acima
  else if (e.key === "Escape" && $("#video-caixa").classList.contains("cheia")) telaCheia(false);
  else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
    e.preventDefault(); refazer();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); desfazer(); }
  else if (e.key === "Delete" || e.key === "Backspace") {
    if (estado.selecao) cortarSelecaoLT();
    else if (estado.selPalavras) $("#cortar-selecao").click();
  } else if (e.key === "ArrowLeft") irPara(video.currentTime - (e.shiftKey ? 5 : 1));
  else if (e.key === "ArrowRight") irPara(video.currentTime + (e.shiftKey ? 5 : 1));
});

/* ------------------------------------------------------------ exportação */

const dlgExp = $("#dlg-exportar");

function renderExportacoes() {
  const p = estado.projeto;
  $("#exp-lista").innerHTML = (p.exportacoes || []).slice().reverse().map((x) => `
    <li><b>${escapar(x.video)}</b><span>${x.largura}×${x.altura} · ${fmt(x.duracao)}</span>
      <a href="/api/projetos/${p.id}/arquivos/${x.video}" download>Baixar vídeo</a>
      ${x.legenda ? `<a href="/api/projetos/${p.id}/arquivos/${x.legenda}" download>Legenda .srt</a>` : ""}
    </li>`).join("");
}

$("#btn-exportar").addEventListener("click", () => {
  const p = estado.projeto;
  const m = p.meta;
  const formato = enq().formato === "original" ? "formato original" : `formato ${enq().formato}`;
  $("#exp-info").textContent = `Vídeo final com ${fmt(tempoFinal(m.duracao))} · ${formato} · original ${m.largura}×${m.altura} a ${Math.round(m.fps)} fps.`;
  // a escolha de legenda da exportação segue o liga/desliga da legenda
  const selLeg = $('#exp-opcoes select[name="legenda"]');
  if (estilo().ativa === false) selLeg.value = "nenhuma";
  else if (selLeg.value === "nenhuma") selLeg.value = "gravada";
  $("#exp-progresso").hidden = true;
  $("#exp-erro").hidden = true;
  $("#exp-opcoes").hidden = false;
  $("#exp-iniciar").disabled = false;
  renderExportacoes();
  dlgExp.showModal();
});

$('#exp-opcoes select[name="legenda"]').addEventListener("change", (e) => {
  const ligar = e.target.value !== "nenhuma";
  if ((estilo().ativa !== false) !== ligar) {
    mudarEstilo("ativa", ligar);
    montarFormLegenda();
  }
});

$("#exp-iniciar").addEventListener("click", async () => {
  const p = estado.projeto;
  const opcoes = Object.fromEntries($$("#exp-opcoes select").map((s) => [s.name, s.value]));
  await salvarAgora();
  try {
    await enviar(`/api/projetos/${p.id}/exportar`, "POST", opcoes);
  } catch (e) {
    $("#exp-erro").textContent = e.message;
    $("#exp-erro").hidden = false;
    return;
  }
  $("#exp-iniciar").disabled = true;
  $("#exp-opcoes").hidden = true;
  $("#exp-progresso").hidden = false;
  $("#exp-erro").hidden = true;
  const timer = setInterval(async () => {
    const atual = await api(`/api/projetos/${p.id}`).catch(() => null);
    const tarefa = atual?.tarefa;
    if (!tarefa) return;
    $("#exp-barra").style.width = `${(tarefa.progresso || 0) * 100}%`;
    $("#exp-pct").textContent = tarefa.status === "na_fila" ? "Na fila…" : `Exportando… ${Math.round((tarefa.progresso || 0) * 100)}%`;
    if (tarefa.status === "concluida") {
      clearInterval(timer);
      p.exportacoes = atual.exportacoes;
      $("#exp-pct").textContent = "Pronto! Baixe abaixo.";
      $("#exp-iniciar").disabled = false;
      $("#exp-opcoes").hidden = false;
      renderExportacoes();
    } else if (tarefa.status === "erro") {
      clearInterval(timer);
      $("#exp-erro").textContent = tarefa.erro;
      $("#exp-erro").hidden = false;
      $("#exp-progresso").hidden = true;
      $("#exp-opcoes").hidden = false;
      $("#exp-iniciar").disabled = false;
    }
  }, 800);
});

/* ------------------------------------------------------------ atualização */

async function procurarAtualizacao(avisar = false) {
  const info = await api("/api/atualizacao").catch(() => null);
  estado.atualizacao = info;
  const tem = !!info?.ha_atualizacao;
  $("#btn-atualizar").hidden = !tem;
  if (tem) $("#btn-atualizar").textContent = `⬆ Atualizar para ${info.disponivel}`;
  $("#cfg-versao-status").textContent = !info ? "" : info.erro ? `· ${info.erro}`
    : tem ? `· versão ${info.disponivel} disponível` : "· você está na versão mais nova";
  if (avisar && tem) abrirAtualizacao();
  return info;
}

function abrirAtualizacao() {
  const info = estado.atualizacao;
  $("#atu-versoes").textContent = `Você está na versão ${info.atual}. A nova é a ${info.disponivel}. Seus projetos são mantidos.`;
  $("#atu-novidades").innerHTML = (info.novidades || []).map((n) => `<li>${escapar(n)}</li>`).join("");
  $("#atu-progresso").hidden = true;
  $("#atu-erro").hidden = true;
  $("#atu-acoes").hidden = false;
  if ($("#dlg-config").open) $("#dlg-config").close();
  $("#dlg-atualizar").showModal();
}
$("#btn-atualizar").addEventListener("click", abrirAtualizacao);

$("#atu-aplicar").addEventListener("click", async () => {
  const alvo = estado.atualizacao.disponivel;
  $("#atu-acoes").hidden = true;
  $("#atu-erro").hidden = true;
  $("#atu-progresso").hidden = false;
  $("#atu-texto").textContent = "Baixando a atualização…";
  try {
    if (estado.projeto) await salvarAgora();
    await api("/api/atualizacao/aplicar", { method: "POST" });
  } catch (e) {
    $("#atu-progresso").hidden = true;
    $("#atu-acoes").hidden = false;
    $("#atu-erro").textContent = e.message;
    $("#atu-erro").hidden = false;
    return;
  }
  $("#atu-texto").textContent = "Reiniciando o CorteFácil…";
  const limite = Date.now() + 180000;
  const esperar = async () => {
    const st = await api("/api/status").catch(() => null);
    if (st?.versao === alvo) { location.reload(); return; }
    if (Date.now() > limite) {
      $("#atu-texto").textContent = "Atualizado! Feche a janela preta e abra o CorteFácil de novo pelo ícone.";
      return;
    }
    setTimeout(esperar, 1500);
  };
  setTimeout(esperar, 2500);
});

/* ------------------------------------------------------------ celular */

const dlgCel = $("#dlg-celular");

async function abrirCelular() {
  const info = await api("/api/celular");
  $("#cel-desligado").hidden = info.ativo;
  $("#cel-ligado").hidden = !info.ativo || !info.escutando;
  $("#cel-reiniciando").hidden = !(info.ativo && !info.escutando);
  if (info.ativo) {
    $("#cel-qr").innerHTML = info.qr;
    $("#cel-endereco").textContent = info.endereco;
    $("#cel-senha").textContent = info.senha;
  }
  if (!dlgCel.open) dlgCel.showModal();
  return info;
}

async function mudarCelular(ativo) {
  try {
    await enviar("/api/celular", "POST", { ativo });
  } catch (e) { aviso(e.message, true); return; }
  $("#cel-desligado").hidden = $("#cel-ligado").hidden = true;
  $("#cel-reiniciando").hidden = false;
  // O programa reabre escutando a rede; espera ele voltar.
  const limite = Date.now() + 120000;
  const esperar = async () => {
    const info = await api("/api/celular").catch(() => null);
    if (info && info.ativo === ativo && info.escutando === ativo) {
      if (ativo) abrirCelular(); else { dlgCel.close(); aviso("Acesso pelo celular desligado."); }
      return;
    }
    if (Date.now() > limite) {
      $("#cel-reiniciando").textContent = "Feche a janela preta e abra o CorteFácil de novo pelo ícone.";
      return;
    }
    setTimeout(esperar, 1500);
  };
  setTimeout(esperar, 2500);
}

$("#btn-celular").addEventListener("click", abrirCelular);
$("#cel-ativar").addEventListener("click", () => mudarCelular(true));
$("#cel-desativar").addEventListener("click", () => mudarCelular(false));
$("#cel-nova-senha").addEventListener("click", async () => {
  const r = await api("/api/celular/nova-senha", { method: "POST" });
  $("#cel-senha").textContent = r.senha;
  aviso("Senha trocada. Os celulares que já tinham entrado vão pedir a senha nova.");
});

/* ------------------------------------------------------------ configurações */

function abrirConfig() {
  $("#cfg-chave").value = "";
  $("#cfg-chave").placeholder = estado.status.ia_disponivel ? "Chave já configurada (digite para trocar)" : "sk-ant-...";
  $("#cfg-versao").textContent = estado.status.versao;
  $("#cfg-onde").textContent = estado.status.servidor
    ? "A chave fica guardada no servidor e vale para todos os usuários (só você vê e troca)."
    : "A chave fica salva só neste computador.";
  $("#dlg-config").showModal();
}
$("#btn-config").addEventListener("click", abrirConfig);
$("#cfg-procurar").addEventListener("click", async () => {
  $("#cfg-versao-status").textContent = "· procurando…";
  await procurarAtualizacao(true);
});
$("#cfg-salvar").addEventListener("click", async () => {
  const r = await enviar("/api/config", "POST", { anthropic_api_key: $("#cfg-chave").value });
  estado.status.ia_disponivel = r.ia_disponivel;
  $("#dlg-config").close();
  aviso(r.ia_disponivel ? "Revisão com IA ativada." : "Chave removida.");
  rotear();
});

/* ------------------------------------------------------------ contas de usuário */

function senhaAleatoria() {
  const letras = "abcdefghjkmnpqrstuvwxyz23456789";
  const n = crypto.getRandomValues(new Uint32Array(8));
  return Array.from(n, (x) => letras[x % letras.length]).join("");
}

async function carregarUsuarios() {
  const lista = await api("/api/usuarios");
  mostrarPendentes(lista.filter((u) => u.pendente).length);
  $("#lista-usuarios").innerHTML = lista.map((u) => u.pendente ? `
    <div class="usuario-linha pendente">
      <span class="nome">🕓 <b>${escapar(u.nome || u.login)}</b> <span class="dica">pediu acesso · usuário ${escapar(u.login)}</span></span>
      <button type="button" class="btn-mini" data-aprovar="${escapar(u.login)}">✓ Aceitar</button>
      <button type="button" class="btn-mini perigo" data-recusar="${escapar(u.login)}">Recusar</button>
    </div>` : `
    <div class="usuario-linha">
      <span class="nome"><b>${escapar(u.login)}</b>${u.admin ? " (você)" : u.nome ? ` <span class="dica">${escapar(u.nome)}</span>` : ""}</span>
      <span class="dica">${u.projetos} vídeo${u.projetos === 1 ? "" : "s"}</span>
      ${u.admin ? "" : `
        <button type="button" class="btn-mini" data-senha="${escapar(u.login)}">Nova senha</button>
        <button type="button" class="btn-mini perigo" data-remover="${escapar(u.login)}">Remover</button>`}
    </div>`).join("");
}

function mostrarPendentes(n) {
  $("#badge-pendentes").hidden = !n;
  $("#badge-pendentes").textContent = n;
}

function mostrarConvite(login, senha) {
  $("#convite").textContent = `Acesse o CorteFácil:\n${location.origin}\nUsuário: ${login}\nSenha: ${senha}`;
  $("#convite-caixa").hidden = false;
}

$("#btn-usuarios").addEventListener("click", async () => {
  $("#usuarios-erro").textContent = "";
  $("#convite-caixa").hidden = true;
  $("#novo-login").value = "";
  $("#nova-senha-usuario").value = senhaAleatoria();
  await carregarUsuarios().catch((e) => aviso(e.message, true));
  $("#dlg-usuarios").showModal();
});

$("#criar-usuario").addEventListener("click", async () => {
  const login = $("#novo-login").value.trim().toLowerCase(), senha = $("#nova-senha-usuario").value.trim();
  $("#usuarios-erro").textContent = "";
  try {
    const r = await enviar("/api/usuarios", "POST", { login, senha });
    mostrarConvite(r.login, senha);
    $("#novo-login").value = "";
    $("#nova-senha-usuario").value = senhaAleatoria();
    await carregarUsuarios();
  } catch (e) { $("#usuarios-erro").textContent = e.message; }
});

$("#lista-usuarios").addEventListener("click", async (e) => {
  const trocar = e.target.closest("[data-senha]"), remover = e.target.closest("[data-remover]");
  const aprovar = e.target.closest("[data-aprovar]"), recusar = e.target.closest("[data-recusar]");
  $("#usuarios-erro").textContent = "";
  try {
    if (aprovar) {
      await api(`/api/usuarios/${encodeURIComponent(aprovar.dataset.aprovar)}/aprovar`, { method: "POST" });
      aviso(`Acesso liberado para ${aprovar.dataset.aprovar}. A pessoa já pode entrar.`);
    } else if (recusar) {
      if (!confirm(`Recusar o pedido de "${recusar.dataset.recusar}"?`)) return;
      await api(`/api/usuarios/${encodeURIComponent(recusar.dataset.recusar)}`, { method: "DELETE" });
    } else if (trocar) {
      const login = trocar.dataset.senha, senha = senhaAleatoria();
      if (!confirm(`Criar uma senha nova para "${login}"? A senha antiga para de funcionar.`)) return;
      await enviar(`/api/usuarios/${encodeURIComponent(login)}/senha`, "POST", { senha });
      mostrarConvite(login, senha);
    } else if (remover) {
      const login = remover.dataset.remover;
      if (!confirm(`Remover "${login}"? A pessoa não consegue mais entrar. Os vídeos dela passam para você.`)) return;
      await api(`/api/usuarios/${encodeURIComponent(login)}`, { method: "DELETE" });
      aviso(`Usuário ${login} removido.`);
    } else return;
    await carregarUsuarios();
    if (!estado.projeto) carregarInicio();
  } catch (err) { $("#usuarios-erro").textContent = err.message; }
});

$("#copiar-convite").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#convite").textContent); aviso("Copiado!"); }
  catch { aviso("Selecione o texto e copie.", true); }
});

$("#btn-conta").addEventListener("click", () => {
  const u = estado.status.usuario;
  $("#conta-titulo").textContent = u.login;
  $("#conta-trocar").hidden = u.admin;
  $("#conta-admin-dica").hidden = !u.admin;
  $("#conta-erro").textContent = "";
  $("#conta-atual").value = $("#conta-nova").value = "";
  $("#dlg-conta").showModal();
});
$("#conta-salvar").addEventListener("click", async () => {
  try {
    await enviar("/api/minha-senha", "POST", { atual: $("#conta-atual").value, senha: $("#conta-nova").value });
    $("#dlg-conta").close();
    aviso("Senha trocada.");
  } catch (e) { $("#conta-erro").textContent = e.message; }
});
$("#conta-sair").addEventListener("click", async () => {
  await api("/api/sair", { method: "POST" }).catch(() => null);
  location.href = "/entrar.html";
});

/* ------------------------------------------------------------ app no celular (instalar) */

const comoApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ehIphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let pedidoInstalar = null;   // Android/Chrome: o próprio navegador mostra a janela de instalar

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  pedidoInstalar = e;
  $("#btn-instalar").hidden = comoApp();
});
window.addEventListener("appinstalled", () => {
  $("#btn-instalar").hidden = true;
  aviso("App instalado! Procure o ícone ✂ CorteFácil na tela inicial.");
});
// no celular, aberto pelo navegador: oferece instalar
$("#btn-instalar").hidden = comoApp() || !(celular.matches || ehIphone);
$("#btn-instalar").addEventListener("click", async () => {
  if (pedidoInstalar) {
    pedidoInstalar.prompt();
    await pedidoInstalar.userChoice.catch(() => null);
    pedidoInstalar = null;
    return;
  }
  $("#instalar-iphone").hidden = !ehIphone;
  $("#instalar-android").hidden = ehIphone;
  $("#dlg-instalar").showModal();
});

/* ------------------------------------------------------------ navegação */

$("#ir-inicio").addEventListener("click", (e) => { e.preventDefault(); location.hash = ""; });

async function rotear() {
  clearInterval(estado.poll);
  const m = location.hash.match(/^#\/p\/([a-f0-9]{12})$/);
  if (!m) {
    estado.projeto = null;
    carregarInicio();
    return;
  }
  let p;
  try { p = await api(`/api/projetos/${m[1]}`); } catch (e) {
    aviso("Projeto não encontrado.", true);
    location.hash = "";
    return;
  }
  if (p.status === "pronto") {
    rolagem.dataset.ajustado = "";
    abrirEditor(p);
  } else acompanhar(p.id);
}
window.addEventListener("hashchange", rotear);

(async function iniciar() {
  try {
    estado.status = await api("/api/status");
  } catch {
    document.body.innerHTML = "<p style='padding:40px'>Não consegui falar com o programa. Ele está aberto?</p>";
    return;
  }
  if (celular.matches) $("#lt-dica").textContent = "Arraste para rolar · toque para levar a agulha · arraste a agulha para percorrer · dois dedos aproximam";
  if (!estado.status.ffmpeg) aviso("ffmpeg não encontrado: instale-o para processar vídeos (veja o README).", true);
  rotear();
  requestAnimationFrame(quadro);
  procurarAtualizacao();
  // "📱 Celular" só no computador; num servidor (VPS) o acesso já é pela internet.
  $("#btn-celular").hidden = !(estado.status.local && !estado.status.servidor);
  const u = estado.status.usuario;
  $("#btn-config").hidden = !(estado.status.local || (estado.status.servidor && u?.admin));
  $("#btn-usuarios").hidden = !u?.admin;
  $("#btn-conta").hidden = !u;
  if (u) $("#conta-nome").textContent = u.login;
  if (u?.admin) {
    mostrarPendentes(estado.status.pendentes);
    if (estado.status.pendentes) aviso(`👥 ${estado.status.pendentes} pedido(s) de acesso esperando você aceitar.`);
    // Confere de tempos em tempos se chegou pedido novo.
    setInterval(async () => {
      const st = await api("/api/status").catch(() => null);
      if (st) mostrarPendentes(st.pendentes);
    }, 60000);
  }
})();
