// Editor de corte: servidor local (só escuta em 127.0.0.1; acesse por túnel SSH).
// Vídeos de origem em videos/, cortes salvos em projetos/, exportações em out/.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const PASTA = {
  videos: path.join(RAIZ, "videos"),
  projetos: path.join(RAIZ, "projetos"),
  saida: path.join(RAIZ, "out"),
  cache: path.join(RAIZ, ".cache"),
  web: path.join(AQUI, "public"),
};
const PORTA = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";
const FFMPEG = process.env.FFMPEG_PATH || require("ffmpeg-static");
const EXTENSOES = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const AMOSTRAS_ONDA_POR_SEG = 100;
const LINUX_OU_MAC = process.platform === "linux" || process.platform === "darwin";

for (const p of Object.values(PASTA)) fs.mkdirSync(p, { recursive: true });

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

// Nome de arquivo seguro: sem pastas, sem arquivos ocultos.
function nomeSeguro(bruto) {
  let nome;
  try {
    nome = path.basename(decodeURIComponent(bruto || ""));
  } catch {
    return null;
  }
  if (!nome || nome.startsWith(".")) return null;
  return nome;
}

function videoValido(bruto) {
  const nome = nomeSeguro(bruto);
  if (!nome || !EXTENSOES.has(path.extname(nome).toLowerCase())) return null;
  const arquivo = path.join(PASTA.videos, nome);
  return fs.existsSync(arquivo) ? { nome, arquivo } : null;
}

function json(res, status, dados) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(dados));
}

function lerCorpo(req, limite = 5_000_000) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on("data", (c) => {
      tamanho += c.length;
      if (tamanho > limite) {
        reject(new Error("Corpo grande demais"));
        req.destroy();
      } else partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

function rodar(comando, args, { aoLerSaida } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, { cwd: RAIZ, shell: process.platform === "win32" });
    const saida = [];
    let erro = "";
    filho.stdout.on("data", (c) => (aoLerSaida ? aoLerSaida(c) : saida.push(c)));
    filho.stderr.on("data", (c) => (erro = (erro + c).slice(-4000)));
    filho.on("error", reject);
    filho.on("close", (codigo) =>
      codigo === 0 ? resolve(Buffer.concat(saida)) : reject(new Error(erro.trim() || `${comando} saiu com código ${codigo}`)),
    );
  });
}

// Envia arquivo com suporte a Range (necessário para o player conseguir pular no vídeo).
function enviarArquivo(req, res, arquivo, extras = {}) {
  let stat;
  try {
    stat = fs.statSync(arquivo);
  } catch {
    return json(res, 404, { erro: "Arquivo não encontrado" });
  }
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let inicio = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let fim = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    if (!range[1] && !range[2]) inicio = 0;
    fim = Math.min(fim, stat.size - 1);
    if (inicio > fim || inicio < 0) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...extras,
      "Content-Type": tipo,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${inicio}-${fim}/${stat.size}`,
      "Content-Length": fim - inicio + 1,
    });
    fs.createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
  } else {
    res.writeHead(200, { ...extras, "Content-Type": tipo, "Accept-Ranges": "bytes", "Content-Length": stat.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(arquivo).pipe(res);
  }
}

// ---------- Informações, onda de áudio e miniaturas ----------

const infoCache = new Map();

async function lerInfo({ nome, arquivo }) {
  const mtime = fs.statSync(arquivo).mtimeMs;
  const guardado = infoCache.get(nome);
  if (guardado && guardado.mtime === mtime) return guardado.info;

  // "ffmpeg -i" sem saída imprime os dados do arquivo e sai com erro; lemos o texto.
  const texto = await new Promise((resolve) => {
    const filho = spawn(FFMPEG, ["-hide_banner", "-i", arquivo]);
    let t = "";
    filho.stderr.on("data", (c) => (t += c));
    filho.on("close", () => resolve(t));
    filho.on("error", () => resolve(t));
  });
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(texto);
  const linhaVideo = /Stream #[^\n]*Video:[^\n]*/.exec(texto)?.[0] || "";
  const dim = /, (\d{2,5})x(\d{2,5})/.exec(linhaVideo);
  const fps = /([\d.]+) fps/.exec(linhaVideo) || /([\d.]+) tbr/.exec(linhaVideo);
  const rot = /rotation of (-?[\d.]+) degrees/.exec(texto) || /rotate\s*:\s*(-?\d+)/.exec(texto);
  if (!dur || !dim) throw new Error("Não consegui ler este vídeo");

  let largura = Number(dim[1]);
  let altura = Number(dim[2]);
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [largura, altura] = [altura, largura];
  const info = {
    nome,
    duracao: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    largura,
    altura,
    fps: fps ? Number(fps[1]) : 30,
    temAudio: /Stream #[^\n]*Audio:/.test(texto),
  };
  infoCache.set(nome, { mtime, info });
  return info;
}

const emAndamento = new Map();
function umaVez(chave, fn) {
  if (!emAndamento.has(chave)) emAndamento.set(chave, fn().finally(() => emAndamento.delete(chave)));
  return emAndamento.get(chave);
}

function arquivoCache(nome, sufixo, arquivoOrigem) {
  const mtime = Math.round(fs.statSync(arquivoOrigem).mtimeMs);
  return path.join(PASTA.cache, `${nome}.${mtime}.${sufixo}`);
}

async function gerarOnda(video) {
  const destino = arquivoCache(video.nome, "onda", video.arquivo);
  if (fs.existsSync(destino)) return destino;
  return umaVez(destino, async () => {
    const info = await lerInfo(video);
    if (!info.temAudio) {
      await fsp.writeFile(destino, Buffer.alloc(0));
      return destino;
    }
    // Áudio mono a 8 kHz; guardamos o pico de cada 10 ms (0 a 255).
    const porBloco = 8000 / AMOSTRAS_ONDA_POR_SEG;
    const picos = [];
    let resto = Buffer.alloc(0);
    let pico = 0;
    let contados = 0;
    await rodar(FFMPEG, ["-v", "error", "-i", video.arquivo, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], {
      aoLerSaida: (c) => {
        const dados = resto.length ? Buffer.concat([resto, c]) : c;
        const pares = dados.length - (dados.length % 2);
        for (let i = 0; i < pares; i += 2) {
          const v = Math.abs(dados.readInt16LE(i));
          if (v > pico) pico = v;
          if (++contados === porBloco) {
            picos.push(Math.min(255, Math.round((pico / 32768) * 255)));
            pico = 0;
            contados = 0;
          }
        }
        resto = dados.subarray(pares);
      },
    });
    if (contados) picos.push(Math.min(255, Math.round((pico / 32768) * 255)));
    await fsp.writeFile(destino, Buffer.from(picos));
    return destino;
  });
}

async function gerarMiniaturas(video) {
  const destinoImg = arquivoCache(video.nome, "miniaturas.jpg", video.arquivo);
  const destinoJson = destinoImg.replace(/\.jpg$/, ".json");
  if (fs.existsSync(destinoJson)) return JSON.parse(await fsp.readFile(destinoJson, "utf8"));
  return umaVez(destinoJson, async () => {
    const info = await lerInfo(video);
    const altura = 90;
    const largura = Math.max(2, Math.round((altura * info.largura) / info.altura / 2) * 2);
    // Até ~600 miniaturas: 1 por segundo em vídeos curtos, mais espaçadas nos longos.
    const intervalo = Math.max(1, Math.ceil(info.duracao / 600));
    const total = Math.max(1, Math.ceil(info.duracao / intervalo));
    const colunas = Math.max(1, Math.min(total, Math.floor(16000 / largura), 40));
    const linhas = Math.ceil(total / colunas);
    await rodar(FFMPEG, [
      "-v", "error", "-skip_frame", "nokey", "-i", video.arquivo, "-an",
      "-vf", `fps=1/${intervalo},scale=${largura}:${altura},tile=${colunas}x${linhas}`,
      "-frames:v", "1", "-q:v", "5", "-y", destinoImg,
    ]);
    const dados = { url: `/cache/${encodeURIComponent(path.basename(destinoImg))}`, intervalo, total, colunas, largura, altura };
    await fsp.writeFile(destinoJson, JSON.stringify(dados));
    return dados;
  });
}

// ---------- Projetos (lista de trechos mantidos) ----------

function arquivoProjeto(nome) {
  return path.join(PASTA.projetos, `${nome}.json`);
}

function validarClipes(clipes, duracao) {
  if (!Array.isArray(clipes) || clipes.length > 5000) return null;
  const limpos = [];
  for (const c of clipes) {
    const inicio = Number(c?.inicio);
    const fim = Number(c?.fim);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
    const a = Math.max(0, inicio);
    const b = Math.min(duracao, fim);
    if (b - a > 0.001) limpos.push({ inicio: a, fim: b });
  }
  return limpos;
}

// ---------- Exportação ----------

let exportacao = { estado: "parado" };

async function exportar(video) {
  const info = await lerInfo(video);
  const projeto = JSON.parse(await fsp.readFile(arquivoProjeto(video.nome), "utf8").catch(() => "null"));
  const clipes = validarClipes(projeto?.clipes ?? [{ inicio: 0, fim: info.duracao }], info.duracao);
  if (!clipes?.length) throw new Error("Não sobrou nenhum trecho para exportar");

  const base = path.parse(video.nome).name;
  const saida = `${base}-editado.mp4`;
  const temporario = path.join(PASTA.saida, `.${saida}.parcial.mp4`);
  const duracaoFinal = clipes.reduce((t, c) => t + (c.fim - c.inicio), 0);

  const filtros = [];
  const entradas = [];
  clipes.forEach((c, i) => {
    const a = c.inicio.toFixed(4);
    const b = c.fim.toFixed(4);
    filtros.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
    entradas.push(`[v${i}]`);
    if (info.temAudio) {
      filtros.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
      entradas.push(`[a${i}]`);
    }
  });
  filtros.push(`${entradas.join("")}concat=n=${clipes.length}:v=1:a=${info.temAudio ? 1 : 0}[v]${info.temAudio ? "[a]" : ""}`);

  // O concat perde a taxa de quadros (cairia para 25); mantemos a do original.
  const ntsc = [24, 30, 60].find((n) => Math.abs(info.fps - n * (1000 / 1001)) < 0.01);
  const taxa = ntsc ? `${ntsc * 1000}/1001` : String(info.fps);

  // Usa só metade dos núcleos e prioridade baixa para não derrubar outros serviços da VPS.
  const threads = String(Math.max(1, Math.floor(os.cpus().length / 2)));
  const args = [
    "-v", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", video.arquivo,
    "-filter_complex", filtros.join(";"), "-map", "[v]",
    ...(info.temAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
    "-r", taxa, "-fps_mode", "cfr",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-threads", threads,
    "-movflags", "+faststart", temporario,
  ];
  const [comando, argsFinais] = LINUX_OU_MAC ? ["nice", ["-n", "19", FFMPEG, ...args]] : [FFMPEG, args];

  exportacao = { estado: "exportando", nome: video.nome, progresso: 0, saida };
  let texto = "";
  await rodar(comando, argsFinais, {
    aoLerSaida: (c) => {
      texto = (texto + c).slice(-500);
      const m = [...texto.matchAll(/out_time_us=(\d+)/g)].pop();
      if (m) exportacao.progresso = Math.min(0.99, Number(m[1]) / 1e6 / duracaoFinal);
    },
  });
  await fsp.rename(temporario, path.join(PASTA.saida, saida));
  exportacao = { estado: "pronto", nome: video.nome, progresso: 1, saida, url: `/saida/${encodeURIComponent(saida)}` };
}

// ---------- Rotas ----------

async function tratar(req, res) {
  const url = new URL(req.url, "http://localhost");
  const partes = url.pathname.split("/").filter(Boolean);
  const [rota, param] = [partes.slice(0, 2).join("/"), partes.slice(2).join("/")];

  if (req.method === "GET" && rota === "api/videos") {
    const nomes = (await fsp.readdir(PASTA.videos)).filter((n) => !n.startsWith(".") && EXTENSOES.has(path.extname(n).toLowerCase()));
    return json(res, 200, nomes.sort((a, b) => a.localeCompare(b, "pt-BR")));
  }

  if (rota === "api/info" || rota === "api/onda" || rota === "api/miniaturas" || rota === "api/projeto" || (rota === "api/exportar" && param)) {
    const video = videoValido(param);
    if (!video) return json(res, 404, { erro: "Vídeo não encontrado" });

    if (rota === "api/info") return json(res, 200, await lerInfo(video));
    if (rota === "api/onda") return enviarArquivo(req, res, await gerarOnda(video), { "Cache-Control": "no-store" });
    if (rota === "api/miniaturas") return json(res, 200, await gerarMiniaturas(video));

    if (rota === "api/projeto" && req.method === "GET") {
      const texto = await fsp.readFile(arquivoProjeto(video.nome), "utf8").catch(() => null);
      return json(res, 200, texto ? JSON.parse(texto) : null);
    }
    if (rota === "api/projeto" && req.method === "PUT") {
      const info = await lerInfo(video);
      const corpo = JSON.parse((await lerCorpo(req)).toString("utf8"));
      const clipes = validarClipes(corpo.clipes, info.duracao);
      if (!clipes) return json(res, 400, { erro: "Lista de trechos inválida" });
      const destino = arquivoProjeto(video.nome);
      await fsp.writeFile(`${destino}.tmp`, JSON.stringify({ versao: 1, video: video.nome, clipes }, null, 2));
      await fsp.rename(`${destino}.tmp`, destino);
      return json(res, 200, { ok: true });
    }
    if (rota === "api/exportar" && req.method === "POST") {
      if (exportacao.estado === "exportando") return json(res, 409, { erro: "Já existe uma exportação em andamento" });
      exportacao = { estado: "exportando", nome: video.nome, progresso: 0 };
      exportar(video).catch((e) => (exportacao = { estado: "erro", nome: video.nome, erro: e.message }));
      return json(res, 202, exportacao);
    }
  }

  if (req.method === "GET" && rota === "api/exportar") return json(res, 200, exportacao);

  if (req.method === "PUT" && rota === "api/enviar") {
    const nome = nomeSeguro(param);
    if (!nome || !EXTENSOES.has(path.extname(nome).toLowerCase())) {
      return json(res, 400, { erro: "Envie um vídeo .mp4, .mov, .m4v, .webm ou .mkv" });
    }
    const destino = path.join(PASTA.videos, nome);
    const parcial = path.join(PASTA.videos, `.${nome}.parcial`);
    await new Promise((resolve, reject) => {
      const escrita = fs.createWriteStream(parcial);
      req.pipe(escrita);
      escrita.on("finish", resolve);
      escrita.on("error", reject);
      req.on("aborted", () => reject(new Error("Envio interrompido")));
    }).catch(async (e) => {
      await fsp.rm(parcial, { force: true });
      throw e;
    });
    await fsp.rename(parcial, destino);
    infoCache.delete(nome);
    return json(res, 200, { ok: true, nome });
  }

  if ((req.method === "GET" || req.method === "HEAD") && partes[0] === "media") {
    const video = videoValido(partes.slice(1).join("/"));
    return video ? enviarArquivo(req, res, video.arquivo) : json(res, 404, { erro: "Vídeo não encontrado" });
  }
  if ((req.method === "GET" || req.method === "HEAD") && partes[0] === "saida") {
    const nome = nomeSeguro(partes.slice(1).join("/"));
    if (!nome) return json(res, 404, { erro: "Arquivo não encontrado" });
    return enviarArquivo(req, res, path.join(PASTA.saida, nome), {
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
    });
  }
  if (req.method === "GET" && partes[0] === "cache") {
    const nome = nomeSeguro(partes.slice(1).join("/"));
    return nome ? enviarArquivo(req, res, path.join(PASTA.cache, nome)) : json(res, 404, { erro: "Não encontrado" });
  }

  if (req.method === "GET") {
    const nome = url.pathname === "/" ? "index.html" : nomeSeguro(partes.join("/"));
    if (nome) return enviarArquivo(req, res, path.join(PASTA.web, nome), { "Cache-Control": "no-cache" });
  }
  json(res, 404, { erro: "Não encontrado" });
}

http
  .createServer((req, res) =>
    tratar(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { erro: e.message });
      else res.end();
    }),
  )
  .listen(PORTA, HOST, () => {
    console.log(`Editor de corte pronto em http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORTA}`);
  });
