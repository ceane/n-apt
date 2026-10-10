import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { createPortal } from "react-dom";
import type { AnalysisSession } from "@n-apt/consts/types";
import {
  VISION_PRESETS,
  type VisionPreset,
} from "@n-apt/demodulation/public";

const FullscreenOverlay = styled.div<{ $preset: VisionPreset }>`
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background-color: ${({ $preset }) => `rgb(${VISION_PRESETS[$preset].join(",")})`};
  z-index: 9999;
`;
const ProgressTrack = styled.div`
  position: absolute;
  inset: 0 auto auto 0;
  width: 100vw;
  height: 1vh;
  background: rgba(0, 0, 0, 0.86);
  border-bottom: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
  mix-blend-mode: normal;
`;
const Progress = styled.div<{ $remaining: number }>`
  width: ${({ $remaining }) => $remaining * 100}%;
  height: 100%;
  background: #ffe600;
  box-shadow: inset -2px 0 0 rgba(0, 0, 0, 0.92);
`;

export interface VisionSceneProps {
  session: AnalysisSession;
  preset: VisionPreset;
}
export const VisionScene: React.FC<VisionSceneProps> = ({
  session,
  preset,
}) => {
  const [remaining, setRemaining] = useState(1);
  const durationMs = Math.max(1, (session.durationS ?? 5) * 1_000);

  useEffect(() => {
    if (session.state !== "starting" && session.state !== "capturing") return;
    const startedAt = session.startTime ?? Date.now();
    let frameId = 0;
    const update = () => {
      setRemaining(
        Math.max(0, Math.min(1, 1 - (Date.now() - startedAt) / durationMs)),
      );
      frameId = window.requestAnimationFrame(update);
    };
    update();
    return () => window.cancelAnimationFrame(frameId);
  }, [durationMs, session.startTime, session.state]);

  return createPortal(
    <FullscreenOverlay $preset={preset} data-testid="vision-stimulus-screen">
      <ProgressTrack
        role="progressbar"
        aria-label="Vision stimulus countdown"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((1 - remaining) * 100)}
      >
        <Progress $remaining={remaining} />
      </ProgressTrack>
    </FullscreenOverlay>,
    document.body,
  );
};

export default VisionScene;
