import { Composition } from "remotion";
import { AberturaXadrez } from "./AberturaXadrez";
import { DURACAO_DEMO, EstiloSuspenseDemo } from "./EstiloSuspenseDemo";
import { NeonDemo } from "./NeonDemo";
import { Teste } from "./Teste";

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="Teste"
      component={Teste}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ titulo: "Remotion funcionando" }}
    />
    <Composition id="NeonDemo" component={NeonDemo} durationInFrames={90} fps={30} width={1080} height={1920} />
    <Composition id="AberturaXadrez" component={AberturaXadrez} durationInFrames={240} fps={24} width={1080} height={960} />
    <Composition id="EstiloSuspenseDemo" component={EstiloSuspenseDemo} durationInFrames={DURACAO_DEMO} fps={30} width={1080} height={1920} />
    </>
  );
};
