import { useEffect, useRef, useCallback } from "react";

interface UsePlaybackAnimationProps {
  hasStitchedData: boolean;
  isPaused: boolean;
  activeChannel: number;
  allChannelsRef: React.MutableRefObject<any[]>;
  precomputedFrames: React.MutableRefObject<any[]>;
  fftCanvasDataRef: React.MutableRefObject<any>;
  displayMode: "fft" | "iq";
}

export const usePlaybackAnimation = ({
  hasStitchedData,
  isPaused,
  activeChannel,
  allChannelsRef,
  precomputedFrames,
  fftCanvasDataRef,
  displayMode,
}: UsePlaybackAnimationProps) => {
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  
  const activeChannelRef = useRef(activeChannel);
  const lastFrameTimeRef = useRef<number | null>(null);
  
  // Update activeChannel ref when it changes
  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  const iqFrameIdxRef = useRef(0);

  const animateFrame = useCallback((timestamp: number) => {
    if (!lastFrameTimeRef.current) lastFrameTimeRef.current = timestamp;
    const elapsed = timestamp - lastFrameTimeRef.current;

    const channelData = allChannelsRef.current[activeChannelRef.current];
    if (channelData) {
      const frameRate = channelData.frame_rate || 30;
      const frameInterval = 1000 / frameRate;

      if (elapsed >= frameInterval) {
        if (displayMode === "iq") {
          const iqData = channelData.iq_data || channelData.iq;
          if (iqData && iqData.length > 0) {
            // FFTCanvas expects Uint8Array for IQ processing
            const fullIq = iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
            // Chunk into fftSize*2 byte windows (I/Q pairs) for frame-by-frame playback
            const fftSize = channelData.bins_per_frame || 2048;
            const chunkSize = fftSize * 2;
            const totalFrames = Math.max(1, Math.floor(fullIq.length / chunkSize));
            const frameIdx = iqFrameIdxRef.current % totalFrames;
            const offset = frameIdx * chunkSize;
            const chunk = fullIq.subarray(offset, offset + chunkSize);
            iqFrameIdxRef.current = frameIdx + 1;
            fftCanvasDataRef.current = { iq_data: chunk, data_type: "iq_raw" };
          }
        } else {
          const frames = precomputedFrames.current;
          if (frames.length > 0) {
            const frameIdx = Math.floor(timestamp / frameInterval) % frames.length;
            fftCanvasDataRef.current = frames[frameIdx];
          }
        }
        lastFrameTimeRef.current = timestamp;
      }
    }
  }, [displayMode, allChannelsRef, precomputedFrames, fftCanvasDataRef]);

  useEffect(() => {
    if (!hasStitchedData || isPaused) return;

    let animationFrameId: number | null = null;
    const currentRunId = Math.random();
    const runIdRef = { current: currentRunId };

    const loop = (timestamp: number) => {
      if (isPausedRef.current || runIdRef.current !== currentRunId) {
        animationFrameId = null;
        return;
      }

      animateFrame(timestamp);
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      runIdRef.current = 0;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [hasStitchedData, isPaused, animateFrame]);

  return { animateFrame };
};
