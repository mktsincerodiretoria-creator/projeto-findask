import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Teste: React.FC<{ titulo: string }> = ({ titulo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const escala = spring({ frame, fps });
  const opacidade = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#111", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ color: "white", fontSize: 90, fontFamily: "sans-serif", textAlign: "center", opacity: opacidade, transform: `scale(${escala})` }}>
        {titulo}
      </h1>
    </AbsoluteFill>
  );
};
