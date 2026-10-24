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
  interactionRenderRef?: React.MutableRefObject<
    ((reprocessFrame?: boolean) => void) | null
  >;
}

/** Owns animation cadence and exposes the imperative repaint bridge. */
export function useFftRenderCoordinator({
  forceRenderRef,
  requestRenderRef,
  interactionRenderRef,
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
    if (interactionRenderRef) {
      interactionRenderRef.current = animation.requestInteractionRender;
    }
    return () => {
      if (forceRenderRef?.current === animation.forceRender) {
        forceRenderRef.current = null;
      }
      if (requestRenderRef?.current === animation.requestRender) {
        requestRenderRef.current = null;
      }
      if (
        interactionRenderRef?.current === animation.requestInteractionRender
      ) {
        interactionRenderRef.current = null;
      }
    };
  }, [
    animation.forceRender,
    animation.requestRender,
    animation.requestInteractionRender,
    forceRenderRef,
    requestRenderRef,
    interactionRenderRef,
  ]);

  return animation;
}
