// Kit de edição "suspense": texto palavra por palavra, cartões de texto, clarão de luz,
// zoom de ênfase, preto e branco, chão de grade neon, glitch e granulação.
// Cada elemento toca o próprio efeito sonoro (public/sfx -> efeitos-sonoros/).
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const CORES = {
  amarelo: "#FFD000", // Mercado Livre
  laranja: "#FF6A00", // Shopee
  ouro: "#FFB21A",
  branco: "#F5F5F2",
};

// Área segura conservadora de Reels (1080x1920): x 80..880, y 320..1440.
// Escala proporcionalmente para outros tamanhos 9:16.
export const useAreaSegura = () => {
  const { width, height } = useVideoConfig();
  const left = (width * 80) / 1080;
  const top = (height * 320) / 1920;
  const largura = (width * 800) / 1080;
  const altura = (height * 1120) / 1920;
  return { left, top, largura, altura, cx: left + largura / 2, cy: top + altura / 2 };
};

// ---------- Fontes (Oswald e Montserrat, licença OFL) ----------
let fontesProntas: Promise<void> | null = null;
export const useFontes = () => {
  const [handle] = React.useState(() => delayRender("Carregando fontes"));
  React.useEffect(() => {
    if (!fontesProntas) {
      const fontes = [
        new FontFace("Oswald", `url(${staticFile("fontes/oswald-latin-700-normal.woff2")})`, { weight: "700" }),
        new FontFace("Montserrat", `url(${staticFile("fontes/montserrat-latin-900-normal.woff2")})`, { weight: "900" }),
      ];
      fontesProntas = Promise.all(fontes.map((f) => f.load().then((carregada) => void document.fonts.add(carregada)))).then(
        () => undefined,
      );
    }
    fontesProntas.then(() => continueRender(handle)).catch((e) => {
      console.error(e);
      continueRender(handle);
    });
  }, [handle]);
};

// ---------- Som ----------
export type NomeSom =
  | "01-abertura-braam"
  | "02-impacto-sub-drop"
  | "03-riser-tensao"
  | "04-whoosh-transicao"
  | "05-drone-suspense-loop"
  | "06-pulso-batimento"
  | "07-stinger-revelacao"
  | "08-reverse-swell"
  | "09-tique-taque-tensao"
  | "10-entrada-texto-sutil"
  | "11-flash-transicao"
  | "12-texto-impacto"
  | "13-palavra-pulso"
  | "14-pb-boom"
  | "15-glitch-sombrio";

// Os efeitos se somam quando tocam juntos; este ganho geral evita estourar (passar de 0 dBFS).
export const VOLUME_GERAL = 0.55;

export const Som: React.FC<{ nome: NomeSom; volume?: number | ((quadro: number) => number); em?: number; loop?: boolean }> = ({
  nome,
  volume = 1,
  em = 0,
  loop,
}) => (
  <Sequence from={em} layout="none" name={`som ${nome}`}>
    <Audio
      src={staticFile(`sfx/${nome}.wav`)}
      volume={typeof volume === "function" ? (f: number) => volume(f) * VOLUME_GERAL : volume * VOLUME_GERAL}
      loop={loop}
    />
  </Sequence>
);

// ---------- Texto palavra por palavra ----------
// Legendas com mais de 11 letras viram duas linhas, para a letra ficar grande.
const quebrarLegenda = (texto: string): string[] => {
  if (texto.length <= 11 || !texto.includes(" ")) return [texto];
  const meio = texto.length / 2;
  let melhor = -1;
  for (let i = 0; i < texto.length; i++) if (texto[i] === " " && (melhor < 0 || Math.abs(i - meio) < Math.abs(melhor - meio))) melhor = i;
  return [texto.slice(0, melhor), texto.slice(melhor + 1)];
};
export type Palavra = { texto: string; em: number; destaque?: boolean; cor?: string; ate?: number };

export const PalavraPorPalavra: React.FC<{
  palavras: Palavra[];
  corDestaque?: string;
  som?: boolean;
  volumeSom?: number;
  /** Centro vertical da legenda em px (padrão: centro da área segura). */
  y?: number;
  tamanhoMax?: number;
}> = ({ palavras, corDestaque = CORES.amarelo, som = true, volumeSom = 0.55, y, tamanhoMax = 150 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const area = useAreaSegura();
  const ultima = [...palavras].reverse().find((p) => p.em <= frame);
  const atual = ultima && (ultima.ate === undefined || frame < ultima.ate) ? ultima : undefined;

  let conteudo: React.ReactNode = null;
  if (atual) {
    const local = frame - atual.em;
    const s = spring({ frame: local, fps, config: { damping: 13, stiffness: 220 } });
    const escala = interpolate(s, [0, 1], [1.45, 1]);
    const desfoque = interpolate(local, [0, 4], [10, 0], { extrapolateRight: "clamp" });
    const tremor = local < 4 ? (random(`tr-${atual.em}-${local}`) - 0.5) * 14 : 0;
    const linhas = quebrarLegenda(atual.texto);
    const maior = Math.max(...linhas.map((l) => l.length));
    const tamanho = Math.min(tamanhoMax, (area.largura * 0.92) / (maior * 0.72));
    const cor = atual.cor ?? corDestaque;
    const base: React.CSSProperties = {
      fontFamily: "Montserrat",
      fontWeight: 900,
      fontSize: tamanho,
      lineHeight: 1.04,
      letterSpacing: -1,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      textAlign: "center",
    };
    const texto = linhas.map((l, i) => (
      <div key={i}>{l}</div>
    ));
    conteudo = (
      <div
        style={{
          position: "absolute",
          left: area.cx,
          top: y ?? area.cy,
          transform: `translate(-50%, -50%) translateX(${tremor}px) scale(${escala})`,
          filter: `blur(${desfoque}px)`,
        }}
      >
        {atual.destaque ? (
          <div
            style={{
              ...base,
              color: "#0B0B0D",
              background: cor,
              padding: "6px 22px 10px",
              borderRadius: 10,
              boxShadow: `0 0 40px ${cor}88, 0 0 120px ${cor}44`,
            }}
          >
            {texto}
          </div>
        ) : (
          <div
            style={{
              ...base,
              color: CORES.branco,
              textShadow:
                "-4px 0 rgba(255,30,70,0.65), 4px 0 rgba(0,190,255,0.65), 0 0 28px rgba(255,255,255,0.45), 0 0 80px rgba(255,255,255,0.18)",
            }}
          >
            {texto}
          </div>
        )}
      </div>
    );
  }

  return (
    <AbsoluteFill>
      {conteudo}
      {som && palavras.map((p) => <Som key={p.em} nome="13-palavra-pulso" em={p.em} volume={volumeSom} />)}
    </AbsoluteFill>
  );
};

// ---------- Cartão de texto em tela cheia ----------
export type TipoIcone = "alerta" | "cruz" | "seta" | "bomba" | "documento";
const Icone: React.FC<{ tipo: TipoIcone; cor: string; tamanho: number }> = ({ tipo, cor, tamanho }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 0 18px ${cor}99)` }}>
    {tipo === "alerta" && (
      <>
        <path d="M50 8 L94 88 H6 Z" fill="none" stroke={cor} strokeWidth="7" strokeLinejoin="round" />
        <rect x="46" y="36" width="8" height="28" rx="3" fill={cor} />
        <circle cx="50" cy="75" r="5" fill={cor} />
      </>
    )}
    {tipo === "cruz" && <path d="M44 6 H56 V36 H86 V48 H56 V94 H44 V48 H14 V36 H44 Z" fill={CORES.branco} />}
    {tipo === "bomba" && (
      <>
        <circle cx="44" cy="60" r="30" fill={CORES.branco} />
        <rect x="58" y="22" width="16" height="14" rx="3" transform="rotate(35 66 29)" fill={CORES.branco} />
        <path d="M70 22 Q78 8 90 12" fill="none" stroke={CORES.branco} strokeWidth="4" />
        <circle cx="90" cy="12" r="6" fill={cor} />
        <path d="M30 50 A16 16 0 0 1 44 40" fill="none" stroke="#0A0A0C" strokeWidth="5" strokeLinecap="round" />
      </>
    )}
    {tipo === "documento" && (
      <>
        <path d="M24 6 H62 L80 24 V94 H24 Z" fill="none" stroke={CORES.branco} strokeWidth="6" strokeLinejoin="round" />
        <path d="M62 6 V24 H80" fill="none" stroke={CORES.branco} strokeWidth="6" />
        <rect x="34" y="40" width="36" height="6" fill={cor} />
        <rect x="34" y="54" width="36" height="6" fill={CORES.branco} />
        <rect x="34" y="68" width="24" height="6" fill={CORES.branco} />
      </>
    )}
    {tipo === "seta" && <path d="M10 70 L40 40 L58 58 L86 28 M66 28 H86 V48" fill="none" stroke={cor} strokeWidth="8" />}
  </svg>
);

export const CartaoTexto: React.FC<{
  linhas: string[];
  cor?: string;
  icone?: TipoIcone;
  som?: boolean;
}> = ({ linhas, cor = CORES.ouro, icone, som = true }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const area = useAreaSegura();
  const maiorLinha = Math.max(...linhas.map((l) => l.length));
  const tamanho = Math.min(250, (area.largura * 0.95) / (maiorLinha * 0.47));
  const empurrao = interpolate(frame, [0, durationInFrames], [1, 1.06]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0A0C" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 45% 46%, #24180a 0%, #0A0A0C 62%)" }} />
      <div
        style={{
          position: "absolute",
          left: area.cx,
          top: area.cy,
          transform: `translate(-50%, -50%) scale(${empurrao})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        {icone && (
          <div style={{ opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" }) }}>
            <Icone tipo={icone} cor={cor} tamanho={tamanho * 1.15} />
          </div>
        )}
        {linhas.map((linha, i) => {
          const local = frame - i * 4;
          const p = interpolate(local, [0, 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
          return (
            <div
              key={i}
              style={{
                fontFamily: "Oswald",
                fontWeight: 700,
                fontSize: tamanho,
                lineHeight: 0.92,
                letterSpacing: -2,
                color: cor,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                opacity: p,
                transform: `scale(${interpolate(p, [0, 1], [1.7, 1])})`,
                filter: `blur(${interpolate(p, [0, 1], [14, 0])}px)`,
                textShadow: `0 0 30px ${cor}66, 0 8px 40px rgba(0,0,0,0.8)`,
              }}
            >
              {linha}
            </div>
          );
        })}
      </div>
      {som && <Som nome="12-texto-impacto" volume={0.9} />}
    </AbsoluteFill>
  );
};

// ---------- Clarão de luz (transição) ----------
// Duração 22 quadros. O pico do clarão (e o golpe do som) acontece no quadro 10:
// coloque o <FlashLuz> 10 quadros antes do corte.
export const FLASH_PICO = 10;
export const FlashLuz: React.FC<{ som?: boolean; volume?: number }> = ({ som = true, volume = 0.85 }) => {
  const frame = useCurrentFrame();
  const opacidade = interpolate(frame, [FLASH_PICO - 4, FLASH_PICO, FLASH_PICO + 2, 22], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const deriva = interpolate(frame, [0, 22], [-8, 8]);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          opacity: opacidade,
          background: `radial-gradient(ellipse at ${40 + deriva}% 45%, #ffffff 0%, #fff7ea 38%, rgba(255,196,128,0.92) 70%, rgba(255,120,40,0.75) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: opacidade * 0.6,
          mixBlendMode: "screen",
          background: `linear-gradient(${100 + deriva * 3}deg, rgba(255,90,20,0) 20%, rgba(255,150,60,0.9) 50%, rgba(255,90,20,0) 80%)`,
        }}
      />
      {som && <Som nome="11-flash-transicao" volume={volume} />}
    </AbsoluteFill>
  );
};

// ---------- Zoom de ênfase (punch-in) ----------
export const ZoomEnfase: React.FC<{ batidas: number[]; passo?: number; children: React.ReactNode }> = ({
  batidas,
  passo = 0.12,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const escala =
    interpolate(frame, [0, durationInFrames], [1, 1.04]) +
    batidas.reduce((soma, b) => soma + passo * spring({ frame: frame - b, fps, config: { damping: 14, stiffness: 260 } }), 0);
  return <AbsoluteFill style={{ transform: `scale(${escala})` }}>{children}</AbsoluteFill>;
};

// ---------- Preto e branco de impacto ----------
export const PretoEBranco: React.FC<{ de: number; ate: number; som?: boolean; children: React.ReactNode }> = ({
  de,
  ate,
  som = true,
  children,
}) => {
  const frame = useCurrentFrame();
  const ativo = frame >= de && frame < ate;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: ativo ? "grayscale(1) contrast(1.35) brightness(0.92)" : undefined }}>{children}</AbsoluteFill>
      {som && <Som nome="14-pb-boom" em={de} volume={0.85} />}
    </AbsoluteFill>
  );
};

// ---------- Escurecer a imagem por trás das palavras ----------
export const Escurecer: React.FC<{ nivel?: number; children: React.ReactNode }> = ({ nivel = 0.4, children }) => (
  <AbsoluteFill style={{ filter: `brightness(${nivel}) saturate(0.85)` }}>{children}</AbsoluteFill>
);

// ---------- Chão de grade neon em perspectiva ----------
export const GradeNeon: React.FC<{ cor?: string }> = ({ cor = "rgba(225,235,255,0.75)" }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const passo = 120;
  const desloc = (frame * 6) % passo;
  const chao = (filtro: string, dx: number, opacidade: number) => (
    <div
      style={{
        position: "absolute",
        left: -width + dx,
        width: width * 3,
        top: height * 0.55,
        height: height * 1.4,
        transformOrigin: "50% 0%",
        transform: "perspective(700px) rotateX(74deg)",
        backgroundImage: `linear-gradient(${filtro} 3px, transparent 3px), linear-gradient(90deg, ${filtro} 3px, transparent 3px)`,
        backgroundSize: `${passo}px ${passo}px`,
        backgroundPosition: `0px ${desloc}px`,
        opacity: opacidade,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "#030305", overflow: "hidden" }}>
      {chao("rgba(255,40,80,0.5)", -4, 0.6)}
      {chao("rgba(0,190,255,0.5)", 4, 0.6)}
      {chao(cor, 0, 1)}
      {/* horizonte some no escuro */}
      <AbsoluteFill
        style={{ background: `linear-gradient(180deg, #030305 0%, #030305 54%, rgba(3,3,5,0) 72%, rgba(3,3,5,0) 88%, rgba(3,3,5,0.7) 100%)` }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 45% 56%, rgba(120,150,255,0.12) 0%, rgba(0,0,0,0) 45%)" }} />
    </AbsoluteFill>
  );
};

// ---------- Glitch (faixas deslocadas e borda colorida) ----------
export const Glitch: React.FC<{ duracao?: number; som?: boolean }> = ({ duracao = 8, som = true }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const faixas = (frame < duracao ? new Array(7).fill(0) : []).map((_, i) => {
    const r = (k: string) => random(`g-${frame}-${i}-${k}`);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: (r("x") - 0.5) * 120,
          top: r("y") * height,
          width: width * 1.2,
          height: 6 + r("h") * 46,
          background: r("c") < 0.5 ? "rgba(255,30,70,0.35)" : "rgba(0,190,255,0.35)",
          mixBlendMode: "screen",
        }}
      />
    );
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {faixas}
      {som && <Som nome="15-glitch-sombrio" volume={0.6} />}
    </AbsoluteFill>
  );
};

// ---------- Granulação de filme e vinheta ----------
export const Granulacao: React.FC<{ forca?: number }> = ({ forca = 0.09 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ opacity: forca, mixBlendMode: "overlay" }}>
        <svg width="100%" height="100%">
          <filter id={`grao-${frame}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 97} />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grao-${frame})`} />
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};
