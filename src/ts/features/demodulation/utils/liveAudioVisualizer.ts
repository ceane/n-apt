export const shouldShowLiveAudioPermissionMessage = (input: {
  selected: boolean;
  hasAnalyser: boolean;
  muted: boolean;
}): boolean => input.selected && (!input.hasAnalyser || input.muted);

export const isSystemAudioTestErrorStatus = (status: string): boolean =>
  /permission was denied|does not support|unavailable in safari|not supported in this browser|ended the system audio share|screen audio capture was not started|system audio test failed|local playback is suppressed by the browser/i.test(
    status,
  );

export const getSystemAudioTestStatusTone = (
  status: string,
): "error" | "warning" | "neutral" => {
  if (isSystemAudioTestErrorStatus(status)) return "error";
  if (
    status.startsWith("Test browser tab or system audio") ||
    status.startsWith("Choose a browser tab or screen")
  ) {
    return "warning";
  }
  return "neutral";
};

export const getSystemAudioLevelStatus = (input: {
  rms: number;
  nowMs: number;
  silenceStartedAtMs: number | null;
  hasDetectedAudio: boolean;
  localPlaybackSuppressed?: boolean;
}): {
  status: string;
  silenceStartedAtMs: number | null;
  hasDetectedAudio: boolean;
} => {
  if (input.rms > 0.001) {
    return {
      status: input.localPlaybackSuppressed
        ? "Audio detected, but local playback is suppressed by the browser."
        : `Audio detected at ${(20 * Math.log10(input.rms)).toFixed(1)} dBFS (speaker output not verified).`,
      silenceStartedAtMs: null,
      hasDetectedAudio: true,
    };
  }

  const silenceStartedAtMs = input.silenceStartedAtMs ?? input.nowMs;
  if (input.nowMs - silenceStartedAtMs >= 500) {
    return {
      status:
        "No audio detected. Playback may be paused or muted; the visualizer will update when audio resumes.",
      silenceStartedAtMs,
      hasDetectedAudio: input.hasDetectedAudio,
    };
  }

  return {
    status: input.hasDetectedAudio
      ? "Audio detected recently · waiting for more audio."
      : "Waiting for audio.",
    silenceStartedAtMs,
    hasDetectedAudio: input.hasDetectedAudio,
  };
};
