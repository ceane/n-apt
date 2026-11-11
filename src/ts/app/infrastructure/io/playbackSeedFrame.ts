interface PlaybackSeedFrameOptions {
  displayMode: "fft" | "iq";
  precomputedFrames: any[];
  channelData: any;
  fftSize?: number;
}

export const buildPlaybackSeedFrame = ({
  displayMode,
  precomputedFrames,
  channelData,
  fftSize,
}: PlaybackSeedFrameOptions) => {
  const stitchedFrame =
    precomputedFrames.length > 0 ? precomputedFrames[0] : null;
  if (stitchedFrame && displayMode === "iq" && channelData?.is_mock_apt) {
    return stitchedFrame;
  }

  const iqData = channelData?.iq_data || channelData?.iq;
  if (iqData && iqData.length > 0) {
    const originalIq =
      iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
    const displayIqData = channelData?.display_iq_data;
    const fullIq = displayIqData instanceof Uint8Array
      ? displayIqData
      : originalIq;
    const frameFftSize = fftSize || channelData?.bins_per_frame || 2048;
    const chunkSize = frameFftSize * 2;
    const chunk = fullIq.subarray(0, Math.min(fullIq.length, chunkSize));
    const encoding = channelData?.sample_encoding;
    const storageBytes = encoding?.storage_bits_per_element ??
      (encoding?.bits_per_element === 8 ? 8 : 16);
    const demodChunk =
      encoding &&
      (encoding.bits_per_element > 8 || encoding.signed) &&
      originalIq !== fullIq
        ? originalIq.subarray(
            0,
            Math.min(originalIq.length, frameFftSize * 2 * (storageBytes / 8)),
          )
        : undefined;

    if (chunk.length >= 2) {
      return {
        type: "spectrum" as const,
        center_frequency_hz: channelData?.center_freq_hz,
        sample_rate: channelData?.sample_rate_hz,
        iq_data: chunk,
        ...(demodChunk ? { demod_iq_data: demodChunk } : {}),
        ...(encoding ? { iq_sample_encoding: encoding } : {}),
        data_type: "iq_raw" as const,
      };
    }
  }

  return stitchedFrame;
};
