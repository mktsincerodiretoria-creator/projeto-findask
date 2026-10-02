import { Composition } from "remotion";
import { Teste } from "./Teste";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Teste"
      component={Teste}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ titulo: "Remotion funcionando" }}
    />
  );
};
