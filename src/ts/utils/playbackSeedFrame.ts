interface PlaybackSeedFrameOptions {
  displayMode: "fft" | "iq";
  precomputedFrames: any[];
  channelData: any;
}

export const buildPlaybackSeedFrame = ({
  displayMode,
  precomputedFrames,
  channelData,
}: PlaybackSeedFrameOptions) => {
  const stitchedFrame = precomputedFrames.length > 0 ? precomputedFrames[0] : null;
  if (stitchedFrame && displayMode === "iq" && channelData?.is_mock_apt) {
    return stitchedFrame;
  }

  const iqData = channelData?.iq_data || channelData?.iq;
  if (iqData && iqData.length > 0) {
    const fullIq = iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
    const fftSize = channelData?.bins_per_frame || 2048;
    const chunkSize = fftSize * 2;
    const chunk = fullIq.subarray(0, Math.min(fullIq.length, chunkSize));

    if (chunk.length >= 2) {
      return {
        type: "spectrum" as const,
        center_frequency_hz: channelData?.center_freq_hz,
        sample_rate: channelData?.sample_rate_hz,
        iq_data: chunk,
        data_type: "iq_raw" as const,
      };
    }
  }

  return stitchedFrame;
};
