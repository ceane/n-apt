import { useEffect, useRef, useCallback } from "react";

interface UsePlaybackAnimationProps {
  hasStitchedData: boolean;
  isPaused: boolean;
  activeChannel: number;
  allChannelsRef: React.MutableRefObject<any[]>;
  precomputedFrames: React.MutableRefObject<any[]>;
  fftCanvasDataRef: React.MutableRefObject<any>;
}

export const usePlaybackAnimation = ({
  hasStitchedData,
  isPaused,
  activeChannel,
  allChannelsRef,
  precomputedFrames,
  fftCanvasDataRef,
}: UsePlaybackAnimationProps) => {
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  
  const activeChannelRef = useRef(activeChannel);
  
  // Update activeChannel ref when it changes
  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  // Playback loop: runs only when unpaused + has data
  const animateFrame = useCallback(
    (timestamp: number) => {
      if (isPausedRef.current) return;

      const channels = allChannelsRef.current;
      const chIdx = activeChannelRef.current;

      if (channels.length > 0 && channels[chIdx]) {
        const ch = channels[chIdx];
        const frames = ch.spectrum_frames || [];
        if (frames.length > 0) {
          const frameIdx = Math.floor(timestamp / 50) % frames.length;
          // Frames from the file are already Float32Arrays
          fftCanvasDataRef.current = { waveform: frames[frameIdx] };
        }
      } else if (precomputedFrames.current.length > 0) {
        const frameIdx = Math.floor(timestamp / 50) % precomputedFrames.current.length;
        // Precomputed frames are already objects like { waveform, range }
        fftCanvasDataRef.current = precomputedFrames.current[frameIdx];
      }
    },
    [], // No dependencies - all values read from refs
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
