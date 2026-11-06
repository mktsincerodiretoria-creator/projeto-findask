import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const CIANO = "#22e6ff";
const MAGENTA = "#ff2bd6";

// Anel neon 2D girando, com brilho em camadas (drop-shadow).
const AnelNeon: React.FC<{ tamanho: number; cor: string; velocidade: number; atraso: number }> = ({ tamanho, cor, velocidade, atraso }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrada = spring({ frame: frame - atraso, fps, config: { damping: 12 } });
  return (
    <div
      style={{
        position: "absolute",
        width: tamanho,
        height: tamanho,
        borderRadius: "50%",
        border: `6px solid ${cor}`,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        transform: `rotate(${frame * velocidade}deg) scale(${entrada})`,
        filter: `drop-shadow(0 0 8px ${cor}) drop-shadow(0 0 24px ${cor}) drop-shadow(0 0 60px ${cor})`,
      }}
    />
  );
};

// Objeto 3D (nó toroidal) girando, com material emissivo neon.
const No3D: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <mesh rotation={[frame * 0.02, frame * 0.035, 0]}>
      <torusKnotGeometry args={[1.1, 0.32, 220, 32]} />
      <meshStandardMaterial color="#120018" emissive={MAGENTA} emissiveIntensity={1.4} metalness={0.6} roughness={0.25} wireframe />
    </mesh>
  );
};

export const NeonDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pulso = interpolate(Math.sin(frame / 6), [-1, 1], [0.7, 1]);
  return (
    <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%, #1a0830 0%, #05030a 70%)", alignItems: "center", justifyContent: "center" }}>
      <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, 6], fov: 45 }}>
        <ambientLight intensity={0.3} />
        <pointLight position={[3, 3, 4]} color={CIANO} intensity={60} />
        <pointLight position={[-3, -2, 3]} color={MAGENTA} intensity={60} />
        <No3D />
      </ThreeCanvas>
      <AnelNeon tamanho={720} cor={CIANO} velocidade={4} atraso={0} />
      <AnelNeon tamanho={860} cor={MAGENTA} velocidade={-2.5} atraso={6} />
      <div
        style={{
          position: "absolute",
          bottom: 520,
          fontFamily: "sans-serif",
          fontWeight: 800,
          fontSize: 96,
          letterSpacing: 6,
          color: "#fff",
          opacity: pulso,
          textShadow: `0 0 10px ${CIANO}, 0 0 30px ${CIANO}, 0 0 70px ${CIANO}`,
        }}
      >
        NEON IA
      </div>
    </AbsoluteFill>
  );
};
