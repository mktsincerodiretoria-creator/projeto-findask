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
  textosPendentes: {},
  ouvindo: null,
  poll: null,
};

const video = $("#video");

/* ------------------------------------------------------------ utilidades */

async function api(url, opcoes = {}) {
  const headers = typeof opcoes.body === "string" ? { "Content-Type": "application/json" } : {};
  const r = await fetch(url, { ...opcoes, headers });
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
  el.innerHTML = [
    campoAlternar("cortar_silencios", "Cortar silêncios", "Remove as pausas entre as falas", cfg.cortar_silencios),
    campoFaixa("silencio_minimo", "Pausa mínima para cortar", "Pausas menores que isso ficam (respiração natural)", cfg.silencio_minimo, 0.2, 2, 0.05, "s"),
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
      <span class="nome">${escapar(p.nome)}</span>
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
  estado.selecao = estado.selPalavras = null;
  estado.filtro = null;
  mostrarTela("editor");
  $("#nome-projeto").textContent = p.nome;
  $("#desfazer").disabled = true;
  if (video.dataset.pid !== p.id) {
    video.src = `/api/projetos/${p.id}/previa`;
    video.dataset.pid = p.id;
  }
  estado.onda = await api(`/api/projetos/${p.id}/onda`).catch(() => []);
  montarOpcoes($("#opcoes-ajustes"), p.config, { inicial: false });
  $("#modelo-retranscrever").innerHTML = estado.status.modelos
    .map((m) => `<option ${m === (p.config.modelo || "small") ? "selected" : ""}>${m}</option>`).join("");
  $("#dica-ia").textContent = p.ia_disponivel
    ? "O Claude lê a transcrição, encontra regravações, correções e trechos fora do roteiro, e explica cada erro."
    : "Para usar, coloque sua chave da API da Anthropic em ⚙ Configurações.";
  montarFormLegenda();
  montarLegendaCores();
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

function atualizarTudo() {
  mesclarAtivos();
  renderResumo();
  renderFiltros();
  renderCortes();
  renderTranscricao();
  desenharLinhaTempo();
}

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

function guardarHistorico() {
  estado.historico.push(JSON.stringify(cortes()));
  if (estado.historico.length > 80) estado.historico.shift();
  $("#desfazer").disabled = false;
}

function desfazer() {
  const anterior = estado.historico.pop();
  if (!anterior) return;
  estado.projeto.cortes = JSON.parse(anterior);
  $("#desfazer").disabled = !estado.historico.length;
  alterou();
}
$("#desfazer").addEventListener("click", desfazer);

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
    cortes: p.cortes, textos, estilo_legenda: p.estilo_legenda,
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
$("#transcricao").addEventListener("mousedown", (e) => {
  const span = e.target.closest(".p");
  if (!span || e.target.tagName === "INPUT") return;
  const i = +span.dataset.i;
  if (e.shiftKey && estado.ancoraPalavra != null) {
    selecionarPalavras(estado.ancoraPalavra, i);
  } else {
    estado.ancoraPalavra = i;
    selecionarPalavras(i, i);
    arrastandoPalavras = true;
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
  if (!span) return;
  const i = +span.dataset.i;
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
});

/* ---------- reprodução ---------- */

function irPara(t) {
  video.currentTime = Math.max(0, Math.min(duracao(), t));
  estado.ouvindo = null;
}

function ouvir(a, b) {
  estado.ouvindo = { fim: Math.min(duracao(), b + 0.6) };
  video.currentTime = Math.max(0, a - 1.0);
  video.play();
}

function alternarPlay() {
  if (video.paused) {
    if (video.currentTime >= duracao() - 0.05) video.currentTime = 0;
    video.play();
  } else video.pause();
}
$("#btn-play").addEventListener("click", alternarPlay);
video.addEventListener("click", alternarPlay);
video.addEventListener("play", () => ($("#btn-play").textContent = "❚❚"));
video.addEventListener("pause", () => ($("#btn-play").textContent = "▶"));

let palavraAtual = -1;
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
        else { video.currentTime = c[1]; t = c[1]; }
      }
    }
  }
  $("#tempo-atual").textContent = fmt(t, true);
  $("#tempo-final").textContent = fmt(tempoFinal(t), true);
  atualizarLegendaPrevia(t);
  destacarPalavra(t);
  seguirCursor(t);
  desenharLinhaTempo();
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
  const bloco = es.ativa ? estado.blocos.find((b) => t >= b.inicio_orig - 0.05 && t <= b.fim_orig + 0.25) : null;
  if (!bloco) {
    if (legendaAtual) { el.innerHTML = ""; legendaAtual = ""; }
    return;
  }
  // Área real da imagem dentro da caixa (o vídeo é centralizado).
  const caixa = $("#video-caixa").getBoundingClientRect();
  const vr = video.getBoundingClientRect();
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
    i === atual ? `<span style="color:${es.cor_destaque}">${escapar(p.texto)}</span>` : escapar(p.texto)).join(" ");
  const chave = html + JSON.stringify(es) + vr.width + vr.height;
  if (chave === legendaAtual) return;
  legendaAtual = chave;

  el.style.left = `${vr.left - caixa.left}px`;
  el.style.width = `${vr.width}px`;
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

/* ---------- legenda: formulário ---------- */

const FONTES = ["Arial", "Arial Black", "Verdana", "Tahoma", "Trebuchet MS", "Impact", "Georgia", "Courier New"];

function montarFormLegenda() {
  const es = estilo();
  const seg = (chave, opcoes) => `<div class="segmentado" data-seg="${chave}">${opcoes.map(([v, r]) =>
    `<button type="button" data-v="${v}" class="${es[chave] === v ? "ativo" : ""}">${r}</button>`).join("")}</div>`;
  $("#form-legenda").innerHTML = `
    ${campoAlternar("ativa", "Mostrar legenda", "Liga ou desliga a legenda na prévia", es.ativa)}
    <div class="campo">Estilo ${seg("modo", [["frase", "Frases (até 2 linhas)"], ["curta", "Curta (2-3 palavras)"]])}</div>
    <div class="campo">Posição ${seg("posicao", [["superior", "Em cima"], ["meio", "Meio"], ["inferior", "Embaixo"]])}</div>
    <label class="campo">Fonte<select data-chave="fonte">${FONTES.map((f) =>
      `<option ${f === es.fonte ? "selected" : ""}>${f}</option>`).join("")}</select></label>
    ${campoFaixa("tamanho", "Tamanho", "", es.tamanho, 3, 12, 0.5, "%")}
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
  legendaAtual = "";
  agendarSalvar();  // salvar recarrega os blocos (modo e maiúsculas mudam o agrupamento)
}

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
  mudarEstilo(grupo.dataset.seg, b.dataset.v);
});

/* ---------- abas ---------- */

$$(".aba").forEach((aba) => aba.addEventListener("click", () => {
  $$(".aba").forEach((a) => a.classList.toggle("ativa", a === aba));
  for (const c of $$(".aba-conteudo")) c.hidden = c.id !== `aba-${aba.dataset.aba}`;
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

/* ------------------------------------------------------------ linha do tempo */

const rolagem = $("#lt-rolagem");
const canvas = $("#lt-canvas");
const ctx = canvas.getContext("2d");
const ALTURA_LT = 120;
let pps = 60;   // pixels por segundo

function montarLegendaCores() {
  const usados = new Set(cortes().map((c) => c.tipo));
  $("#legenda-cores").innerHTML = Object.entries(TIPOS).filter(([t]) => usados.has(t))
    .map(([, i]) => `<span><span class="bolinha" style="background:${i.cor}"></span>${i.nome}</span>`).join("");
}

function redimensionarLinhaTempo() {
  const dpr = window.devicePixelRatio || 1;
  const largura = rolagem.clientWidth;
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
  $("#lt-espaco").style.width = `${duracao() * pps}px`;
  desenharLinhaTempo();
}
new ResizeObserver(redimensionarLinhaTempo).observe(rolagem);
rolagem.addEventListener("scroll", desenharLinhaTempo);

$("#zoom").addEventListener("input", (e) => {
  const t = video.currentTime;
  const x = t * pps - rolagem.scrollLeft;
  pps = +e.target.value;
  $("#lt-espaco").style.width = `${duracao() * pps}px`;
  rolagem.scrollLeft = t * pps - x;
  desenharLinhaTempo();
});

function passoRegua() {
  for (const p of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (p * pps >= 70) return p;
  return 1200;
}

function desenharLinhaTempo() {
  if (!estado.projeto || $("#tela-editor").hidden) return;
  const largura = canvas.width / (window.devicePixelRatio || 1);
  const t0 = rolagem.scrollLeft / pps;
  const t1 = t0 + largura / pps;
  const X = (t) => (t - t0) * pps;
  const topo = 20, base = ALTURA_LT - 6, meio = (topo + base) / 2, amp = (base - topo) / 2;

  ctx.clearRect(0, 0, largura, ALTURA_LT);
  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, largura, ALTURA_LT);

  // régua
  const passo = passoRegua();
  ctx.fillStyle = "#6c7384";
  ctx.font = "10px system-ui";
  ctx.strokeStyle = "#2a2f3a";
  ctx.beginPath();
  for (let t = Math.floor(t0 / passo) * passo; t <= t1; t += passo) {
    const x = Math.round(X(t)) + 0.5;
    ctx.moveTo(x, 0); ctx.lineTo(x, 14);
    ctx.fillText(fmt(t), x + 3, 10);
  }
  ctx.stroke();

  // forma de onda (50 pontos por segundo)
  const onda = estado.onda;
  ctx.fillStyle = "#4a5570";
  for (let x = 0; x < largura; x++) {
    const ia = Math.floor((t0 + x / pps) * 50), ib = Math.max(ia + 1, Math.floor((t0 + (x + 1) / pps) * 50));
    let v = 0;
    for (let i = ia; i < ib && i < onda.length; i++) if (onda[i] > v) v = onda[i];
    const h = Math.max(1, v * amp);
    ctx.fillRect(x, meio - h, 1, h * 2);
  }

  // cortes
  for (const c of cortes()) {
    if (c.fim < t0 || c.inicio > t1) continue;
    const cor = tipoInfo(c.tipo).cor;
    const xa = X(c.inicio), xb = X(c.fim);
    if (c.ativo) {
      ctx.fillStyle = hexParaRgba(cor, 0.33);
      ctx.fillRect(xa, topo, xb - xa, base - topo);
      ctx.fillStyle = cor;
      ctx.fillRect(xa, topo - 4, xb - xa, 4);
    } else {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = hexParaRgba(cor, 0.9);
      ctx.strokeRect(xa + 0.5, topo + 0.5, xb - xa - 1, base - topo - 1);
      ctx.setLineDash([]);
    }
  }

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
  const xp = X(video.currentTime);
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

let arrastandoLT = null;
canvas.addEventListener("mousedown", (e) => {
  arrastandoLT = { x: e.clientX, t: tempoNoCanvas(e) };
});
window.addEventListener("mousemove", (e) => {
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
  const c = corteEm(tempoNoCanvas(e));
  $("#lt-dica").textContent = c
    ? `${c.titulo}${c.ativo ? "" : " (desligado)"} — ${c.motivo}`
    : "Clique para ir até o ponto · arraste para selecionar um trecho e cortar";
});
window.addEventListener("mouseup", (e) => {
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

document.addEventListener("keydown", (e) => {
  if ($("#tela-editor").hidden || e.target.closest("input, select, textarea, dialog[open]")) return;
  if (e.code === "Space") { e.preventDefault(); alternarPlay(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); desfazer(); }
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
  $("#exp-info").textContent = `Vídeo final com ${fmt(tempoFinal(m.duracao))} · original ${m.largura}×${m.altura} a ${Math.round(m.fps)} fps.`;
  $("#exp-progresso").hidden = true;
  $("#exp-erro").hidden = true;
  $("#exp-opcoes").hidden = false;
  $("#exp-iniciar").disabled = false;
  renderExportacoes();
  dlgExp.showModal();
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

/* ------------------------------------------------------------ configurações */

function abrirConfig() {
  $("#cfg-chave").value = "";
  $("#cfg-chave").placeholder = estado.status.ia_disponivel ? "Chave já configurada (digite para trocar)" : "sk-ant-...";
  $("#dlg-config").showModal();
}
$("#btn-config").addEventListener("click", abrirConfig);
$("#cfg-salvar").addEventListener("click", async () => {
  const r = await enviar("/api/config", "POST", { anthropic_api_key: $("#cfg-chave").value });
  estado.status.ia_disponivel = r.ia_disponivel;
  $("#dlg-config").close();
  aviso(r.ia_disponivel ? "Revisão com IA ativada." : "Chave removida.");
  rotear();
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
  if (!estado.status.ffmpeg) aviso("ffmpeg não encontrado: instale-o para processar vídeos (veja o README).", true);
  rotear();
  requestAnimationFrame(quadro);
})();
