import { useCallback, useRef, useEffect } from "react";

export interface AnimationOptions {
  isPaused: boolean;
  onRenderFrame: (runId: number) => void;
  onBecomeVisible?: () => void;
  targetFPS?: number;
}

export function useFFTAnimation({
  isPaused,
  onRenderFrame,
  onBecomeVisible,
  targetFPS = 60,
}: AnimationOptions) {
  const animationFrameRef = useRef<number | null>(null);
  const animationRunIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  // Dynamically adjust FPS based on paused state to save resources while keeping canvas alive
  const currentFPS = isPaused ? 15 : Math.max(targetFPS, 30);
  const frameRateLimiterRef = useRef(1000 / currentFPS);

  useEffect(() => {
    frameRateLimiterRef.current = 1000 / currentFPS;
    // Re-anchor cadence so a new logical FPS does not inherit the previous
    // interval's phase and create visible jitter during rate changes.
    lastFrameTimeRef.current = performance.now();
  }, [currentFPS]);

  const isVisibleRef = useRef(true);

  const animate = useCallback(
    (force: boolean = false) => {
      const runId = animationRunIdRef.current;

      if (!isVisibleRef.current) {
        animationFrameRef.current = null;
        return;
      }

      const now = performance.now();
      const elapsed = now - lastFrameTimeRef.current;

      // Use a small fudge factor (4ms) to account for rAF jitter on same-rate displays
      if (force || elapsed >= frameRateLimiterRef.current - 4) {
        // Adjust lastFrameTime by the interval to maintain cadence
        // but don't let it drift too far behind actual time
        if (force || elapsed > frameRateLimiterRef.current * 2) {
          lastFrameTimeRef.current = now;
        } else {
          lastFrameTimeRef.current += frameRateLimiterRef.current;
        }
        onRenderFrame(runId);
      }

      // Keep the animation loop running even when paused to prevent blank canvases
      // WebGPU and Canvas2D contexts can be lost or cleared if not actively presented,
      // especially during window resizes or tab switches. Throttling FPS saves CPU.
      if (animationRunIdRef.current === runId) {
        animationFrameRef.current = requestAnimationFrame(() => {
          if (animationRunIdRef.current === runId) {
            animate(false);
          }
        });
      } else {
        animationFrameRef.current = null;
      }
    },
    [onRenderFrame],
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === "visible";
      if (isVisibleRef.current) {
        onBecomeVisible?.();
        if (!animationFrameRef.current) {
          animationRunIdRef.current += 1;
          animate(true);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [animate, onBecomeVisible]);

  useEffect(() => {
    if (isVisibleRef.current) {
      animationRunIdRef.current += 1;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Force an immediate render when unpausing or when render logic changes to prevent flicker
      animate(!isPaused);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [isPaused, animate, onRenderFrame]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const forceRender = useCallback(() => {
    animationRunIdRef.current += 1;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    animate(true);
  }, [animate]);

  return {
    animate,
    forceRender,
    isVisibleRef,
    setTargetFPS: useCallback((fps: number) => {
      frameRateLimiterRef.current = 1000 / fps;
    }, []),
  };
}
