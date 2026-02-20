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
  const frameRateLimiterRef = useRef(1000 / targetFPS);
  const isVisibleRef = useRef(true);

  const animate = useCallback(() => {
    const runId = animationRunIdRef.current;

    if (!isVisibleRef.current) {
      animationFrameRef.current = null;
      return;
    }

    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;
    if (elapsed >= frameRateLimiterRef.current) {
      lastFrameTimeRef.current = now;
      onRenderFrame(runId);
    }

    if (animationRunIdRef.current === runId && !isPaused) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
    } else {
      animationFrameRef.current = null;
    }
  }, [isPaused, onRenderFrame]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === "visible";
      if (isVisibleRef.current) {
        onBecomeVisible?.();
        if (!animationFrameRef.current) {
          animationRunIdRef.current += 1;
          animate();
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
      animate();
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
    animate();
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
