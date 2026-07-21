import { Composition } from "remotion";
import { TranscribeFlow, DURATION_FRAMES, FPS } from "./TranscribeFlow";

export const Root = () => (
  <Composition
    id="TranscribeFlow"
    component={TranscribeFlow}
    durationInFrames={DURATION_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
