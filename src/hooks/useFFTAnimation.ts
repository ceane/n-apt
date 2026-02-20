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
  const currentFPS = isPaused ? 15 : targetFPS;
  const frameRateLimiterRef = useRef(1000 / currentFPS);

  useEffect(() => {
    frameRateLimiterRef.current = 1000 / currentFPS;
  }, [currentFPS]);

  const isVisibleRef = useRef(true);

  const animate = useCallback((force: boolean = false) => {
    const runId = animationRunIdRef.current;

    if (!isVisibleRef.current) {
      animationFrameRef.current = null;
      return;
    }

    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;
    
    // Always render if forced, or if enough time has passed
    if (force || elapsed >= frameRateLimiterRef.current) {
      lastFrameTimeRef.current = now;
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
  }, [onRenderFrame]);

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
    if (isVisibleRef.current && !isPaused) {
      animationRunIdRef.current += 1;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animate(false);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [isPaused, animate]);

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
