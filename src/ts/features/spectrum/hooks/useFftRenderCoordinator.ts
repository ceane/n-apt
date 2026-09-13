import { useEffect } from "react";
import { useFFTAnimation } from "@n-apt/spectrum/hooks/useFFTAnimation";

export interface FftRenderCoordinatorOptions {
  isPaused: boolean;
  onRenderFrame: (runId: number, force?: boolean) => void;
  onBecomeVisible?: () => void;
  targetFPS?: number;
  forceRenderRef?: React.MutableRefObject<(() => void) | null>;
}

/** Owns animation cadence and exposes the imperative repaint bridge. */
export function useFftRenderCoordinator({
  forceRenderRef,
  ...animationOptions
}: FftRenderCoordinatorOptions) {
  const animation = useFFTAnimation(animationOptions);

  useEffect(() => {
    if (forceRenderRef) {
      forceRenderRef.current = animation.forceRender;
    }
    return () => {
      if (forceRenderRef?.current === animation.forceRender) {
        forceRenderRef.current = null;
      }
    };
  }, [animation.forceRender, forceRenderRef]);

  return animation;
}
