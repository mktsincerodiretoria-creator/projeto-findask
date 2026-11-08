// Série "sonegação fiscal no e-commerce": edição da parte 1 (27,5 s).
// O vídeo de origem fica em public/usuario/parte1.mp4 (fora do Git).
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CORES,
  CartaoTexto,
  FLASH_PICO,
  FlashLuz,
  Glitch,
  Granulacao,
  Palavra,
  PalavraPorPalavra,
  PretoEBranco,
  Som,
  useAreaSegura,
  useFontes,
} from "../estilo";

const FPS = 30;
export const DURACAO_PARTE1 = 824;
const q = (seg: number) => Math.round(seg * FPS);
const VERMELHO = "#FF3B30";

// Cartões em tela cheia (o rosto some só nesses trechos)
const CARTOES = [
  { de: 6.2, ate: 7.95, linhas: ["Bomba", "fiscal"], icone: "bomba" as const, cor: VERMELHO },
  { de: 11.5, ate: 13.1, linhas: ["Reforma", "tributária"], icone: "documento" as const, cor: CORES.amarelo },
];

const PALAVRAS: Palavra[] = [
  { texto: "Sonegação", em: q(0.32) },
  { texto: "fiscal", em: q(0.9) },
  { texto: "no e-commerce", em: q(1.58) },
  { texto: "está com os", em: q(2.22) },
  { texto: "dias contados", em: q(2.88), destaque: true, cor: VERMELHO, ate: q(3.7) },
  { texto: "Tem vendedor", em: q(3.74) },
  { texto: "no Mercado Livre", em: q(4.4), destaque: true, cor: CORES.amarelo },
  { texto: "na Shopee", em: q(5.44), destaque: true, cor: CORES.laranja, ate: q(6.2) },
  { texto: "achando que", em: q(8.14) },
  { texto: "nunca", em: q(8.82) },
  { texto: "vai ser", em: q(9.12) },
  { texto: "descoberto", em: q(9.62), destaque: true, cor: VERMELHO, ate: q(10.3) },
  { texto: "Eu vou te", em: q(10.34) },
  { texto: "explicar", em: q(10.76) },
  { texto: "por quê", em: q(11.06), ate: q(11.5) },
  { texto: "esse assunto", em: q(13.1) },
  { texto: "ainda mais", em: q(13.48) },
  { texto: "preocupante", em: q(14.14), destaque: true, cor: VERMELHO, ate: q(14.96) },
  { texto: "Existe uma", em: q(14.98) },
  { texto: "prática", em: q(15.54) },
  { texto: "de algumas", em: q(16.1) },
  { texto: "pessoas", em: q(16.78) },
  { texto: "no e-commerce", em: q(17.3) },
  { texto: "que precisa", em: q(17.98) },
  { texto: "ser discutida", em: q(18.78) },
  { texto: "hoje", em: q(19.96), destaque: true, cor: CORES.amarelo, ate: q(20.4) },
  { texto: "O vendedor", em: q(20.42) },
  { texto: "faz uma venda", em: q(21.12), ate: q(21.72) },
];

// ---------- Nota fiscal animada (abaixo do rosto, dentro da área segura) ----------
const VALORES_NOTA = [
  { em: q(25.36), valor: 40 },
  { em: q(26.04), valor: 30 },
  { em: q(26.94), valor: 10 },
];

const NotaFiscal: React.FC = () => {
  const frame = useCurrentFrame(); // 0 = início do painel (21,72 s)
  const { fps } = useVideoConfig();
  const area = useAreaSegura();
  const inicio = q(21.72);
  const abs = frame + inicio;
  const entrada = spring({ frame, fps, config: { damping: 16, stiffness: 180 } });
  const linhaNota = spring({ frame: abs - q(24.32), fps, config: { damping: 16, stiffness: 180 } });
  const atual = [...VALORES_NOTA].reverse().find((v) => abs >= v.em);
  const valorNota = atual?.valor ?? 100;
  const ultimoImpacto = atual ? abs - atual.em : 99;
  const tremor = ultimoImpacto < 6 ? Math.sin(ultimoImpacto * 3) * (6 - ultimoImpacto) * 2.2 : 0;
  const pulo = atual ? interpolate(ultimoImpacto, [0, 5], [1.25, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 1;
  const barra = interpolate(valorNota, [0, 100], [0, 1]);
  const largura = area.largura * 0.95;

  const rotulo: React.CSSProperties = { fontFamily: "Montserrat", fontWeight: 900, fontSize: 30, letterSpacing: 3, color: "#A8A8AE" };
  const valor: React.CSSProperties = { fontFamily: "Oswald", fontWeight: 700, fontSize: 112, lineHeight: 1, letterSpacing: -1 };

  return (
    <div
      style={{
        position: "absolute",
        left: area.cx - largura / 2,
        top: 1010,
        width: largura,
        padding: "30px 40px 36px",
        borderRadius: 28,
        background: "rgba(10,10,12,0.82)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        opacity: entrada,
        transform: `translateY(${interpolate(entrada, [0, 1], [80, 0])}px) translateX(${tremor}px)`,
      }}
    >
      <div style={rotulo}>VENDA</div>
      <div style={{ ...valor, color: CORES.branco }}>R$ 100,00</div>
      <div
        style={{
          marginTop: 22,
          opacity: linhaNota,
          transform: `translateY(${interpolate(linhaNota, [0, 1], [30, 0])}px)`,
        }}
      >
        <div style={{ ...rotulo, color: valorNota < 100 ? VERMELHO : "#A8A8AE" }}>NOTA FISCAL EMITIDA</div>
        <div
          style={{
            ...valor,
            color: valorNota < 100 ? VERMELHO : CORES.branco,
            transform: `scale(${pulo})`,
            transformOrigin: "left center",
            textShadow: valorNota < 100 ? `0 0 30px ${VERMELHO}88` : undefined,
          }}
        >
          R$ {valorNota},00
        </div>
        <div style={{ marginTop: 18, height: 14, borderRadius: 7, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
          <div style={{ width: `${barra * 100}%`, height: "100%", background: valorNota < 100 ? VERMELHO : CORES.branco }} />
        </div>
      </div>
    </div>
  );
};

// ---------- Vídeo da fala, com cor levemente realçada e zoom contido ----------
const Fala: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Zoom total no máximo ~5%: deriva lenta + um único toque no plano aberto (15 s).
  // Entre 10 s e 15 s o plano já está próximo, então não há zoom extra ali.
  const escala =
    1 +
    interpolate(frame, [0, q(3.6)], [0, 0.02], { extrapolateRight: "clamp" }) +
    0.03 * spring({ frame: frame - q(14.98), fps, config: { damping: 18, stiffness: 200 } }) -
    0.03 * spring({ frame: frame - q(20.42), fps, config: { damping: 18, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ transform: `scale(${escala})`, transformOrigin: "50% 30%" }}>
      <OffthreadVideo
        src={staticFile("usuario/parte1.mp4")}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.07) saturate(1.06)" }}
      />
    </AbsoluteFill>
  );
};

export const Parte1: React.FC = () => {
  useFontes();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fimAudio = (f: number) => interpolate(f, [durationInFrames - 5, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <PretoEBranco de={q(8.82)} ate={q(10.3)}>
        <AbsoluteFill style={{ filter: frame >= q(8.82) && frame < q(10.3) ? "brightness(0.78)" : undefined }}>
          <Fala />
        </AbsoluteFill>
      </PretoEBranco>

      <Granulacao forca={0.07} />

      <PalavraPorPalavra palavras={PALAVRAS} y={1250} tamanhoMax={118} volumeSom={0.35} />

      <Sequence from={q(21.72)}>
        <NotaFiscal />
      </Sequence>

      {CARTOES.map((c) => (
        <Sequence key={c.de} from={q(c.de)} durationInFrames={q(c.ate) - q(c.de)}>
          <CartaoTexto linhas={c.linhas} icone={c.icone} cor={c.cor} />
          <Granulacao forca={0.08} />
        </Sequence>
      ))}

      {CARTOES.flatMap((c) => [c.de, c.ate]).map((corte) => (
        <Sequence key={corte} from={q(corte) - FLASH_PICO} durationInFrames={22}>
          <FlashLuz volume={0.7} />
        </Sequence>
      ))}

      <Sequence from={q(0.32)}>
        <Glitch duracao={6} />
      </Sequence>
      <Sequence from={q(26.94)}>
        <Glitch duracao={8} som={false} />
      </Sequence>

      {/* trilha sonora de efeitos, sempre abaixo da voz */}
      <Som nome="01-abertura-braam" volume={0.65} />
      <Som nome="02-impacto-sub-drop" em={q(6.2)} volume={0.55} />
      <Som nome="06-pulso-batimento" em={q(7.95)} volume={0.45} />
      <Som nome="03-riser-tensao" em={q(10.1)} volume={0.4} />
      <Som nome="07-stinger-revelacao" em={q(14.98)} volume={0.5} />
      <Sequence from={q(14.98)} durationInFrames={q(20.42) - q(14.98)}>
        <Som
          nome="05-drone-suspense-loop"
          loop
          volume={(f) => interpolate(f, [0, 20, q(20.42) - q(14.98) - 20, q(20.42) - q(14.98)], [0, 0.14, 0.14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      </Sequence>
      <Som nome="12-texto-impacto" em={q(21.72)} volume={0.55} />
      {VALORES_NOTA.map((v) => (
        <Som key={v.em} nome="12-texto-impacto" em={v.em} volume={0.6} />
      ))}
      <Sequence from={q(26.94)}>
        <Som nome="02-impacto-sub-drop" volume={(f) => 0.6 * fimAudio(f + q(26.94))} />
      </Sequence>
    </AbsoluteFill>
  );
};
