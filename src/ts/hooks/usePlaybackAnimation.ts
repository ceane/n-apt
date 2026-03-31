import { useEffect, useRef, useCallback } from "react";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

interface UsePlaybackAnimationProps {
  hasStitchedData: boolean;
  isPaused: boolean;
  activeChannel: number;
  allChannelsRef: React.MutableRefObject<any[]>;
  precomputedFrames: React.MutableRefObject<Array<LiveFrameData | null>>;
  fftCanvasDataRef: React.MutableRefObject<LiveFrameData | null>;
  displayMode: "fft" | "iq";
}

export const usePlaybackAnimation = ({
  hasStitchedData,
  isPaused,
  activeChannel,
  allChannelsRef,
  precomputedFrames: _precomputedFrames,
  fftCanvasDataRef,
  displayMode: _displayMode,
}: UsePlaybackAnimationProps) => {
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  
  const activeChannelRef = useRef(activeChannel);
  const lastFrameTimeRef = useRef<number | null>(null);
  
  // Update activeChannel ref when it changes
  useEffect(() => {
    activeChannelRef.current = activeChannel;
    iqFrameIdxRef.current = 0;
    lastFrameTimeRef.current = null;
  }, [activeChannel]);

  const iqFrameIdxRef = useRef(0);

  useEffect(() => {
    if (!hasStitchedData) {
      iqFrameIdxRef.current = 0;
      lastFrameTimeRef.current = null;
    }
  }, [hasStitchedData]);

  const animateFrame = useCallback((timestamp: number) => {
    if (!lastFrameTimeRef.current) lastFrameTimeRef.current = timestamp;
    const elapsed = timestamp - lastFrameTimeRef.current;

    const channelData = allChannelsRef.current[activeChannelRef.current];
    if (channelData) {
      const frameRate = channelData.frame_rate || 30;
      const frameInterval = 1000 / frameRate;

      if (elapsed >= frameInterval) {
        const iqData = channelData.iq_data || channelData.iq;
        if (iqData && iqData.length > 0) {
          const fullIq = iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
          const fftSize = channelData.bins_per_frame || 2048;
          const chunkSize = fftSize * 2;
          const totalFrames = Math.max(1, Math.floor(fullIq.length / chunkSize));
          const frameIdx = iqFrameIdxRef.current % totalFrames;
          const offset = frameIdx * chunkSize;
          const chunk = fullIq.subarray(offset, Math.min(fullIq.length, offset + chunkSize));
          iqFrameIdxRef.current = frameIdx + 1;

          if (chunk.length >= 2) {
            fftCanvasDataRef.current = {
              type: "spectrum",
              center_frequency_hz: channelData.center_freq_hz,
              sample_rate: channelData.sample_rate_hz,
              data_type: "iq_raw",
              iq_data: chunk,
            };
          }
        }
        lastFrameTimeRef.current = timestamp;
      }
    }
  }, [allChannelsRef, fftCanvasDataRef]);

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
