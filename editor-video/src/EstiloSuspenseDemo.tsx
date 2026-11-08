import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CORES,
  CartaoTexto,
  Escurecer,
  FLASH_PICO,
  FlashLuz,
  Glitch,
  GradeNeon,
  Granulacao,
  PalavraPorPalavra,
  PretoEBranco,
  Som,
  ZoomEnfase,
  useFontes,
} from "./estilo";

// Demonstração do kit de suspense (30 fps, 17 s). Sem voz: só imagem, texto e efeitos.
export const DURACAO_DEMO = 510;

const CenaXadrez: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* fundo: o mesmo clipe ampliado e desfocado, para preencher o 9:16 */}
      <OffthreadVideo
        src={staticFile("runway/xadrez-gen45.mp4")}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(28px) brightness(0.6)", transform: "scale(1.15)" }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <OffthreadVideo
          src={staticFile("runway/xadrez-gen45.mp4")}
          muted
          trimBefore={24}
          style={{ width: 1080, height: 1080, objectFit: "cover", transform: `translateY(${interpolate(frame, [0, 150], [10, -10])}px)` }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const EstiloSuspenseDemo: React.FC = () => {
  useFontes();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const volumeDrone = (f: number) =>
    interpolate(f, [0, 30, durationInFrames - 30, durationInFrames], [0, 0.22, 0.22, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* 0–2,5 s: grade neon + palavra por palavra */}
      <Sequence durationInFrames={75}>
        <GradeNeon />
        <PalavraPorPalavra
          palavras={[
            { texto: "Você", em: 4 },
            { texto: "está", em: 18 },
            { texto: "perdendo", em: 32 },
            { texto: "dinheiro", em: 48, destaque: true },
          ]}
        />
        <Sequence from={48}>
          <Glitch />
        </Sequence>
      </Sequence>

      {/* 2,5–5 s: cartão de texto */}
      <Sequence from={75} durationInFrames={75}>
        <CartaoTexto linhas={["E não", "percebe"]} icone="alerta" />
      </Sequence>

      {/* 5–10 s: cena de apoio escurecida, zoom de ênfase e preto e branco */}
      <Sequence from={150} durationInFrames={150}>
        <PretoEBranco de={85} ate={118}>
          <ZoomEnfase batidas={[10, 40]}>
            <Escurecer nivel={0.42}>
              <CenaXadrez />
            </Escurecer>
          </ZoomEnfase>
        </PretoEBranco>
        <PalavraPorPalavra
          palavras={[
            { texto: "O jogo", em: 10 },
            { texto: "é", em: 28 },
            { texto: "outro", em: 40, destaque: true },
            { texto: "e você", em: 85 },
            { texto: "nem viu", em: 100 },
          ]}
        />
        <Som nome="03-riser-tensao" em={5} volume={0.55} />
      </Sequence>

      {/* 10–13 s: revelação */}
      <Sequence from={300} durationInFrames={90}>
        <CartaoTexto linhas={["Margem", "é tudo"]} cor={CORES.amarelo} icone="seta" />
        <Som nome="07-stinger-revelacao" volume={0.7} />
        <Glitch duracao={6} som={false} />
      </Sequence>

      {/* 13–15,5 s: grade neon + tique-taque */}
      <Sequence from={390} durationInFrames={75}>
        <GradeNeon />
        <PalavraPorPalavra
          palavras={[
            { texto: "Anota", em: 4 },
            { texto: "isso", em: 22 },
            { texto: "agora", em: 40, destaque: true },
          ]}
        />
        <Som nome="09-tique-taque-tensao" volume={0.45} />
      </Sequence>

      {/* 15,5–17 s: fechamento */}
      <Sequence from={465} durationInFrames={45}>
        <CartaoTexto linhas={["Parte 2"]} cor={CORES.branco} som={false} />
        <Som nome="02-impacto-sub-drop" volume={0.85} />
      </Sequence>

      {/* clarões nos cortes (o pico cai exatamente no corte) */}
      {[75, 150, 300, 465].map((corte) => (
        <Sequence key={corte} from={corte - FLASH_PICO} durationInFrames={22}>
          <FlashLuz />
        </Sequence>
      ))}

      <Granulacao />

      {/* trilha de fundo e abertura */}
      <Som nome="01-abertura-braam" volume={0.75} />
      <Som nome="05-drone-suspense-loop" volume={volumeDrone} loop />

      {/* fade final para o preto */}
      <AbsoluteFill
        style={{ backgroundColor: "#000", opacity: interpolate(frame, [durationInFrames - 12, durationInFrames], [0, 1], { extrapolateLeft: "clamp" }) }}
      />
    </AbsoluteFill>
  );
};
