import { useEffect, useRef, useCallback } from "react";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { getIqComponentStorageBytes } from "@n-apt/math/iqSamples";

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

type PlaybackFrameUpdate = {
  sample_offset: number;
  timestamp_us?: number;
  kind?: string;
  frame_sequence?: number;
  patch?: Record<string, unknown>;
};

export function getIqFrameTimestampAtOffset(
  updates: PlaybackFrameUpdate[],
  sampleOffset: number,
): number | null {
  let timestamp: number | null = null;
  for (const update of updates) {
    if (update.sample_offset > sampleOffset) break;
    if (update.kind === "Frame" && Number.isFinite(update.timestamp_us)) {
      timestamp = update.timestamp_us! / 1000;
    }
  }
  return timestamp;
}

export function getIqFrameAtOffset(
  iq: Uint8Array,
  sampleOffset: number,
  initialFftSize: number,
  updates: PlaybackFrameUpdate[],
  bytesPerComplexSample = 2,
): { data: Uint8Array; nextOffset: number; fftSize: number } | null {
  let fftSize = initialFftSize;
  for (const update of updates) {
    if (Number(update.sample_offset) > sampleOffset) break;
    const patchedSize = Number(update.patch?.fft_size);
    if (Number.isInteger(patchedSize) && patchedSize > 0) fftSize = patchedSize;
  }
  const byteLength = fftSize * bytesPerComplexSample;
  const byteOffset = sampleOffset * bytesPerComplexSample;
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteOffset + byteLength > iq.length) {
    return null;
  }
  return {
    data: iq.subarray(byteOffset, byteOffset + byteLength),
    nextOffset: sampleOffset + fftSize,
    fftSize,
  };
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

  const iqFrameOffsetRef = useRef(0);
  const currentFftSizeRef = useRef(0);

  // Cached per-channel derived values — avoids recomputing on every rAF tick
  const cachedIqRef = useRef<Uint8Array | null>(null);
  const cachedDemodIqRef = useRef<Uint8Array | null>(null);
  const cachedChannelIdRef = useRef<any>(null); // identity check for channel object
  const playbackMetadataRef = useRef<Record<string, unknown> | null>(null);
  const frameUpdateIndexRef = useRef(0);

  useEffect(() => {
    if (!hasStitchedData) {
      iqFrameOffsetRef.current = 0;
      lastFrameTimeRef.current = null;
      cachedIqRef.current = null;
      cachedDemodIqRef.current = null;
      cachedChannelIdRef.current = null;
      playbackMetadataRef.current = null;
      frameUpdateIndexRef.current = 0;
      iqFrameOffsetRef.current = 0;
      currentFftSizeRef.current = 0;
    }
  }, [hasStitchedData]);

  const animateFrame = useCallback(
    (timestamp: number, forceFrame = false) => {
      const channelData = allChannelsRef.current[activeChannel];
      if (!channelData) return;

      const inferredIqFrameRate =
        Number(channelData.sample_rate_hz) > 0 &&
        Number(channelData.bins_per_frame || fftSize) > 0
          ? Number(channelData.sample_rate_hz) /
            Number(channelData.bins_per_frame || fftSize)
          : 0;
      const frameRate =
        channelData.frame_rate || inferredIqFrameRate || 30;
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
          playbackMetadataRef.current = {
            center_frequency_hz: channelData.center_freq_hz,
            sample_rate_hz: channelData.sample_rate_hz,
            fft_size: channelData.bins_per_frame || fftSize || 2048,
            fft_window: channelData.fft_window,
          };
          frameUpdateIndexRef.current = 0;
          const iqData = channelData.iq_data || channelData.iq;
          if (iqData && iqData.length > 0) {
            const rawIq =
              iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
            const displayIq = channelData.display_iq_data;
            cachedIqRef.current =
              displayIq instanceof Uint8Array ? displayIq : rawIq;
            cachedDemodIqRef.current =
              displayIq instanceof Uint8Array && displayIq !== rawIq
                ? rawIq
                : null;
            const frameFftSize = channelData.bins_per_frame || fftSize || 2048;
            currentFftSizeRef.current = frameFftSize;
            iqFrameOffsetRef.current = 0;

            // Start each channel at the first complete captured frame.
          } else {
            cachedIqRef.current = null;
            cachedDemodIqRef.current = null;
          }
        }

        const fullIq = cachedIqRef.current;
        if (fullIq) {
          const sampleEncoding = channelData.sample_encoding;
          const rawIq = cachedDemodIqRef.current;
          const bytesPerDemodComplexSample = rawIq
            ? getIqComponentStorageBytes(sampleEncoding) * 2
            : 2;
          const updates = (channelData.frame_updates || []) as PlaybackFrameUpdate[];
          while (
            frameUpdateIndexRef.current < updates.length &&
            Number(updates[frameUpdateIndexRef.current].sample_offset) <= iqFrameOffsetRef.current
          ) {
            const update = updates[frameUpdateIndexRef.current++];
            playbackMetadataRef.current = {
              ...playbackMetadataRef.current,
              ...update.patch,
            };
            const patchedFftSize = Number(update.patch?.fft_size);
            if (Number.isInteger(patchedFftSize) && patchedFftSize > 0) {
              currentFftSizeRef.current = patchedFftSize;
            }
          }

          let frame = getIqFrameAtOffset(
            fullIq,
            iqFrameOffsetRef.current,
            currentFftSizeRef.current,
            updates,
          );
          if (!frame && iqFrameOffsetRef.current !== 0) {
            iqFrameOffsetRef.current = 0;
            frameUpdateIndexRef.current = 0;
            playbackMetadataRef.current = {
              center_frequency_hz: channelData.center_freq_hz,
              sample_rate_hz: channelData.sample_rate_hz,
              fft_size: channelData.bins_per_frame || fftSize || 2048,
              fft_window: channelData.fft_window,
            };
            currentFftSizeRef.current = channelData.bins_per_frame || fftSize || 2048;
            while (
              frameUpdateIndexRef.current < updates.length &&
              Number(updates[frameUpdateIndexRef.current].sample_offset) <= 0
            ) {
              const update = updates[frameUpdateIndexRef.current++];
              playbackMetadataRef.current = { ...playbackMetadataRef.current, ...update.patch };
              const patchedFftSize = Number(update.patch?.fft_size);
              if (Number.isInteger(patchedFftSize) && patchedFftSize > 0) {
                currentFftSizeRef.current = patchedFftSize;
              }
            }
            frame = getIqFrameAtOffset(fullIq, 0, currentFftSizeRef.current, updates);
          }

          const demodFrame = rawIq && frame
            ? getIqFrameAtOffset(
                rawIq,
                frame.nextOffset - frame.fftSize,
                frame.fftSize,
                updates,
                bytesPerDemodComplexSample,
              )
            : null;

          const chunk = frame?.data;
          if (frame) {
            currentFftSizeRef.current = frame.fftSize;
            iqFrameOffsetRef.current = frame.nextOffset;
          }

          if (chunk && chunk.length >= 2) {
            const playbackMetadata = playbackMetadataRef.current || {};
            const capturedTimestamp = getIqFrameTimestampAtOffset(
              updates,
              iqFrameOffsetRef.current - (frame?.fftSize ?? chunk.byteLength / 2),
            );
            fftCanvasDataRef.current = {
              type: "spectrum",
              center_frequency_hz: Number(
                playbackMetadata.center_frequency_hz ?? channelData.center_freq_hz,
              ),
              sample_rate: Number(
                playbackMetadata.sample_rate_hz ?? channelData.sample_rate_hz,
              ),
              timestamp: capturedTimestamp ?? timestamp,
              data_type: "iq_raw",
              iq_data: chunk,
              ...(demodFrame
                ? {
                    demod_iq_data: demodFrame.data,
                    iq_sample_encoding: sampleEncoding,
                  }
                : {}),
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
