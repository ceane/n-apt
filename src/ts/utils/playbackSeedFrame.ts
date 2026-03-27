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
  if (displayMode === "iq") {
    const iqData = channelData?.iq_data || channelData?.iq;
    if (!iqData || iqData.length === 0) {
      return null;
    }

    const fullIq = iqData instanceof Uint8Array ? iqData : new Uint8Array(iqData);
    const fftSize = channelData?.bins_per_frame || 2048;
    const chunkSize = fftSize * 2;

    return {
      iq_data: fullIq.subarray(0, chunkSize),
      data_type: "iq_raw" as const,
    };
  }

  return precomputedFrames.length > 0 ? precomputedFrames[0] : null;
};
