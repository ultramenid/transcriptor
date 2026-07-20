import { Composition } from "remotion";
import { Showcase } from "./Showcase";

const FPS = 30;
const DURATION_SECONDS = 12;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Showcase"
      component={Showcase}
      durationInFrames={FPS * DURATION_SECONDS}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
