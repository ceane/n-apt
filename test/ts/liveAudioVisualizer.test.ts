import {
  getSystemAudioLevelStatus,
  getSystemAudioTestStatusTone,
  isSystemAudioTestErrorStatus,
  shouldShowLiveAudioPermissionMessage,
} from "@n-apt/demodulation/utils/liveAudioVisualizer";

describe("shouldShowLiveAudioPermissionMessage", () => {
  test.each([
    { selected: false, hasAnalyser: false, muted: true, expected: false },
    { selected: true, hasAnalyser: false, muted: true, expected: true },
    { selected: true, hasAnalyser: true, muted: true, expected: true },
    { selected: true, hasAnalyser: true, muted: false, expected: false },
  ])(
    "returns $expected for selected=$selected, analyser=$hasAnalyser, muted=$muted",
    ({ selected, hasAnalyser, muted, expected }) => {
      expect(
        shouldShowLiveAudioPermissionMessage({ selected, hasAnalyser, muted }),
      ).toBe(expected);
    },
  );
});

describe("isSystemAudioTestErrorStatus", () => {
  test.each([
    ["Screen/audio sharing permission was denied.", true],
    ["This browser does not support screen or tab audio capture.", true],
    ["The browser ended the system audio share.", true],
    ["Screen audio capture was not started: unknown error", true],
    ["System audio test failed: device unavailable", true],
    ["Audio detected at -12.0 dBFS.", false],
    ["Listening · no sound right now", false],
    ["System audio test stopped.", false],
    ["System audio test was canceled.", false],
  ])("classifies %j as error=%s", (status, expected) => {
    expect(isSystemAudioTestErrorStatus(status)).toBe(expected);
  });
});

describe("getSystemAudioTestStatusTone", () => {
  test.each([
    ["Test browser tab or system audio and preview it in the visualizer.", "warning"],
    ["Choose a browser tab or screen and enable audio in the sharing picker.", "warning"],
    ["Screen/audio sharing permission was denied.", "error"],
    ["Audio detected at -12.0 dBFS.", "neutral"],
    ["System audio test was canceled.", "neutral"],
  ] as const)("returns %s for status %j", (status, expected) => {
    expect(getSystemAudioTestStatusTone(status)).toBe(expected);
  });
});

describe("getSystemAudioLevelStatus", () => {
  test("keeps the status listening until silence lasts 500 ms", () => {
    const initial = getSystemAudioLevelStatus({
      rms: 0,
      nowMs: 1000,
      silenceStartedAtMs: null,
      hasDetectedAudio: false,
    });
    expect(initial.status).toBe("Waiting for audio.");

    const beforeTimeout = getSystemAudioLevelStatus({
      rms: 0,
      nowMs: 1499,
      silenceStartedAtMs: initial.silenceStartedAtMs,
      hasDetectedAudio: initial.hasDetectedAudio,
    });
    expect(beforeTimeout.status).toBe("Waiting for audio.");

    const afterTimeout = getSystemAudioLevelStatus({
      rms: 0,
      nowMs: 1500,
      silenceStartedAtMs: beforeTimeout.silenceStartedAtMs,
      hasDetectedAudio: beforeTimeout.hasDetectedAudio,
    });
    expect(afterTimeout.status).toBe(
      "No audio detected. Playback may be paused or muted; the visualizer will update when audio resumes.",
    );
  });

  test("resets the silence timer as soon as audio returns", () => {
    const result = getSystemAudioLevelStatus({
      rms: 0.05,
      nowMs: 2500,
      silenceStartedAtMs: 2000,
      hasDetectedAudio: true,
    });

    expect(result.status).toMatch(/^Audio detected at .* \(speaker output not verified\)\.$/);
    expect(result.silenceStartedAtMs).toBeNull();
  });

  test("reports when captured audio is detected but browser playback is suppressed", () => {
    const result = getSystemAudioLevelStatus({
      rms: 0.05,
      nowMs: 2500,
      silenceStartedAtMs: null,
      hasDetectedAudio: false,
      localPlaybackSuppressed: true,
    });

    expect(result.status).toBe(
      "Audio detected, but local playback is suppressed by the browser.",
    );
  });

  test("keeps reporting listening through a speech pause shorter than 500 ms", () => {
    const result = getSystemAudioLevelStatus({
      rms: 0,
      nowMs: 2499,
      silenceStartedAtMs: 2000,
      hasDetectedAudio: true,
    });

    expect(result.status).toBe("Audio detected recently · waiting for more audio.");
  });
});
