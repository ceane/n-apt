import { useCallback, useRef, useEffect } from "react";

export interface AnimationOptions {
  isPaused: boolean;
  isVisible: boolean;
  renderWaveformRef: React.MutableRefObject<Float32Array | null>;
  onRenderFrame: (runId: number) => void;
  targetFPS?: number;
}

export function useFFTAnimation({
  isPaused,
  isVisible,
  renderWaveformRef,
  onRenderFrame,
  targetFPS = 60,
}: AnimationOptions) {
  const animationFrameRef = useRef<number | null>(null);
  const animationRunIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const frameRateLimiterRef = useRef(1000 / targetFPS);

  // Main animation loop
  const animate = useCallback(() => {
    const runId = animationRunIdRef.current;
    
    // Early exit if component is unmounted or not visible
    if (!isVisibleRef.current) {
      animationFrameRef.current = null;
      return;
    }

    // Check if we have waveform data to render
    const waveform = renderWaveformRef.current;
    if (!waveform || waveform.length === 0) {
      // If paused and no waveform, don't schedule next frame
      if (isPaused) {
        animationFrameRef.current = null;
        return;
      }
      // If not paused, keep trying to get data
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
      return;
    }

    // Frame rate limiting
    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;
    if (elapsed >= frameRateLimiterRef.current) {
      lastFrameTimeRef.current = now;
      
      // Call the render callback
      onRenderFrame(runId);
    }

    // Schedule next frame only if not paused
    if (animationRunIdRef.current === runId && !isPaused) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
    } else {
      animationFrameRef.current = null;
    }
  }, [isPaused, renderWaveformRef, onRenderFrame]);

  // Visibility tracking ref to avoid stale closures
  const isVisibleRef = useRef(isVisible);
  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  // Start/stop animation based on visibility and pause state
  useEffect(() => {
    if (isVisible && !isPaused) {
      // Start animation loop
      animationRunIdRef.current += 1;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animate();
    } else {
      // Stop animation loop
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [isVisible, isPaused, animate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    animate,
    animationRunId: animationRunIdRef.current,
    forceRender: useCallback(() => {
      animationRunIdRef.current += 1;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      animate();
    }, [animate]),
    setTargetFPS: useCallback((fps: number) => {
      frameRateLimiterRef.current = 1000 / fps;
    }, []),
  };
}
