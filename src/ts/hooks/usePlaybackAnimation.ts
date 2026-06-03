import { useEffect, useRef, useCallback } from "react";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

interface UsePlaybackAnimationProps {
  hasStitchedData: boolean;
  isPaused: boolean;
  activeChannel: number;
  fftSize?: number;
  allChannelsRef: React.MutableRefObject<any[]>;
  precomputedFrames: React.MutableRefObject<Array<LiveFrameData | null>>;
  fftCanvasDataRef: React.MutableRefObject<LiveFrameData | null>;
  displayMode: "fft" | "iq";
  onFrameEmitted?: () => void;
}

export const usePlaybackAnimation = ({
  hasStitchedData,
  isPaused,
  activeChannel,
  fftSize,
  allChannelsRef,
  precomputedFrames: _precomputedFrames,
  fftCanvasDataRef,
  displayMode: _displayMode,
  onFrameEmitted,
}: UsePlaybackAnimationProps) => {
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const lastFrameTimeRef = useRef<number | null>(null);

  const iqFrameIdxRef = useRef(0);

  // Cached per-channel derived values — avoids recomputing on every rAF tick
  const cachedIqRef = useRef<Uint8Array | null>(null);
  const cachedTotalFramesRef = useRef(0);
  const cachedChunkSizeRef = useRef(0);
  const cachedChannelIdRef = useRef<any>(null); // identity check for channel object

  useEffect(() => {
    if (!hasStitchedData) {
      iqFrameIdxRef.current = 0;
      lastFrameTimeRef.current = null;
      cachedIqRef.current = null;
      cachedChannelIdRef.current = null;
    }
  }, [hasStitchedData]);

  const animateFrame = useCallback(
    (timestamp: number, forceFrame = false) => {
      const channelData = allChannelsRef.current[activeChannel];
      if (!channelData) return;

      const frameRate = channelData.frame_rate || 30;
      const frameInterval = 1000 / frameRate;

      // Reset timer if we just started or resumed from pause
      if (!lastFrameTimeRef.current || forceFrame) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;

      // Use a small fudge factor (4ms) to account for rAF jitter on same-rate displays
      if (elapsed >= frameInterval - 4 || forceFrame) {
        // Rebuild cached values only when the channel object changes
        if (cachedChannelIdRef.current !== channelData) {
          cachedChannelIdRef.current = channelData;
          const iqData = channelData.iq_data || channelData.iq;
          if (iqData && iqData.length > 0) {
            // Zero-copy when already Uint8Array (our worker now always provides this)
            cachedIqRef.current =
              iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
            const frameFftSize = fftSize || channelData.bins_per_frame || 2048;
            cachedChunkSizeRef.current = frameFftSize * 2;
            cachedTotalFramesRef.current = Math.max(
              1,
              Math.floor(
                cachedIqRef.current.length / cachedChunkSizeRef.current,
              ),
            );

            // Auto-reset frame index when channel changes or at start
            iqFrameIdxRef.current = 0;
          } else {
            cachedIqRef.current = null;
          }
        }

        const fullIq = cachedIqRef.current;
        if (fullIq) {
          const chunkSize = cachedChunkSizeRef.current;
          const totalFrames = cachedTotalFramesRef.current;
          const frameIdx = iqFrameIdxRef.current % totalFrames;
          const offset = frameIdx * chunkSize;
          const chunk = fullIq.subarray(
            offset,
            Math.min(fullIq.length, offset + chunkSize),
          );
          iqFrameIdxRef.current = frameIdx + 1;

          if (chunk.length >= 2) {
            fftCanvasDataRef.current = {
              type: "spectrum",
              center_frequency_hz: channelData.center_freq_hz,
              sample_rate: channelData.sample_rate_hz,
              timestamp,
              data_type: "iq_raw",
              iq_data: chunk,
            };
            onFrameEmitted?.();
          }
        }

        // Adjust lastFrameTime by the interval to maintain cadence
        // but don't let it drift too far behind actual time (e.g. more than 2 frames)
        if (elapsed > frameInterval * 2) {
          lastFrameTimeRef.current = timestamp;
        } else {
          lastFrameTimeRef.current += frameInterval;
        }
      }
    },
    [allChannelsRef, activeChannel, fftCanvasDataRef, fftSize, onFrameEmitted],
  );

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
