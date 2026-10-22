import { useEffect } from "react";
import { useFFTAnimation } from "@n-apt/spectrum/hooks/useFFTAnimation";

export interface FftRenderCoordinatorOptions {
  isPaused: boolean;
  onRenderFrame: (runId: number, force?: boolean) => void;
  onBecomeVisible?: () => void;
  targetFPS?: number;
  forceRenderRef?: React.MutableRefObject<
    ((reprocessFrame?: boolean) => void) | null
  >;
  requestRenderRef?: React.MutableRefObject<(() => void) | null>;
}

/** Owns animation cadence and exposes the imperative repaint bridge. */
export function useFftRenderCoordinator({
  forceRenderRef,
  requestRenderRef,
  ...animationOptions
}: FftRenderCoordinatorOptions) {
  const animation = useFFTAnimation(animationOptions);

  useEffect(() => {
    if (forceRenderRef) {
      forceRenderRef.current = animation.forceRender;
    }
    if (requestRenderRef) {
      requestRenderRef.current = animation.requestRender;
    }
    return () => {
      if (forceRenderRef?.current === animation.forceRender) {
        forceRenderRef.current = null;
      }
      if (requestRenderRef?.current === animation.requestRender) {
        requestRenderRef.current = null;
      }
    };
  }, [animation.forceRender, animation.requestRender, forceRenderRef, requestRenderRef]);

  return animation;
}
