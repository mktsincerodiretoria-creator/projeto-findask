import { AbsoluteFill, OffthreadVideo, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const AZUL = "34, 150, 255";
const AMARELO = "255, 214, 0";

// Partícula de luz subindo devagar, com o brilho somado à cena (mix-blend-mode: screen).
const Particula: React.FC<{ i: number }> = ({ i }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const ladoEsquerdo = random(`lado-${i}`) < 0.5;
  const x = (ladoEsquerdo ? 0 : width / 2) + random(`x-${i}`) * (width / 2);
  const velocidade = 0.4 + random(`v-${i}`) * 0.9;
  const inicio = random(`y-${i}`) * height;
  const y = height - ((inicio + frame * velocidade * 2) % (height + 40));
  const tamanho = 3 + random(`t-${i}`) * 5;
  const piscar = interpolate(Math.sin((frame + i * 13) / 9), [-1, 1], [0.25, 0.9]);
  const cor = ladoEsquerdo ? AZUL : AMARELO;
  const fade = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: tamanho,
        height: tamanho,
        borderRadius: "50%",
        background: `radial-gradient(circle, rgba(${cor},1) 0%, rgba(${cor},0) 70%)`,
        boxShadow: `0 0 ${tamanho * 3}px rgba(${cor},0.9)`,
        opacity: piscar * fade,
      }}
    />
  );
};

export const AberturaXadrez: React.FC = () => {
  const frame = useCurrentFrame();
  const pulso = interpolate(Math.sin(frame / 10), [-1, 1], [0.35, 0.8]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Vídeo 960x960 do Runway cobrindo 1080x960 (corta 60 px em cima e embaixo). */}
      <OffthreadVideo
        src={staticFile("runway/xadrez-gen45.mp4")}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {/* Neon nas bordas: azul (Amazon) à esquerda, amarelo (Mercado Livre) à direita. */}
      <AbsoluteFill
        style={{
          mixBlendMode: "screen",
          opacity: pulso,
          background: `linear-gradient(90deg, rgba(${AZUL},0.45) 0%, rgba(${AZUL},0) 14%, rgba(${AMARELO},0) 86%, rgba(${AMARELO},0.45) 100%)`,
        }}
      />
      <AbsoluteFill style={{ mixBlendMode: "screen" }}>
        {new Array(40).fill(0).map((_, i) => (
          <Particula key={i} i={i} />
        ))}
      </AbsoluteFill>
      {/* Vinheta leve para fechar o quadro. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 60%, rgba(0,0,0,0.45) 100%)" }} />
    </AbsoluteFill>
  );
};
