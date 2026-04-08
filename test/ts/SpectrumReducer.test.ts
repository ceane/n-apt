// Mock heavy dependencies that SpectrumRoute.tsx imports but reducer tests don't need
jest.mock("@n-apt/hooks/useWebSocket", () => ({
  useWebSocket: jest.fn(() => ({
    isConnected: false,
    deviceState: "disconnected",
    spectrumFrames: [],
    sdrSettings: null,
    sendFrequencyRange: jest.fn(),
    sendPauseCommand: jest.fn(),
    sendSettings: jest.fn(),
    sendRestartDevice: jest.fn(),
    sendTrainingCommand: jest.fn(),
    sendCaptureCommand: jest.fn(),
    sendGetAutoFftOptions: jest.fn(),
  })),
}));

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: jest.fn(() => ({
    authState: "idle",
    isAuthenticated: false,
    sessionToken: null,
    aesKey: null,
    hasPasskeys: false,
    isInitialAuthCheck: false,
    handlePasswordAuth: jest.fn(),
    handlePasskeyAuth: jest.fn(),
    handleRegisterPasskey: jest.fn(),
  })),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useSnapshot", () => ({
  useSnapshot: () => ({ handleSnapshot: jest.fn() }),
}));

jest.mock("@n-apt/services/auth", () => ({
  buildWsUrl: jest.fn(),
}));

jest.mock("@n-apt/components/sidebar/SidebarNew", () => ({
  default: () => null,
}));

jest.mock("@n-apt/components/AuthenticationPrompt", () => ({
  default: () => null,
}));

jest.unmock("@n-apt/hooks/useSpectrumStore");

jest.mock("@n-apt/components/FFTPlaybackCanvas", () => ({
  default: () => null,
}));

jest.mock("@n-apt/components", () => ({
  FFTCanvas: () => null,
}));

jest.mock("@n-apt/hooks/useModel3D", () => ({
  useModel3D: () => ({
    selectedArea: null,
    setSelectedArea: jest.fn(),
    controlsRef: { current: null },
  }),
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useHotspotEditor", () => ({
  useHotspotEditor: () => ({}),
  HotspotEditorProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));





import * as React from "react";
import {
  spectrumReducer,
  INITIAL_SPECTRUM_STATE,
} from "@n-apt/hooks/useSpectrumStore";

// ────────────────────────────────────────────────────────────────────────────
// spectrumReducer
// ────────────────────────────────────────────────────────────────────────────

describe("spectrumReducer", () => {
  it("SET_SIGNAL_AREA updates activeSignalArea", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_SIGNAL_AREA",
      area: "B",
    });
    expect(next.activeSignalArea).toBe("B");
  });

  it("SET_FREQUENCY_RANGE updates frequencyRange", () => {
    const range = { min: 1, max: 5 };
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_FREQUENCY_RANGE",
      range,
    });
    expect(next.frequencyRange).toEqual(range);
  });

  it("SET_FREQUENCY_RANGE returns same reference when range unchanged", () => {
    const range = { min: 1, max: 5 };
    const withRange = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_FREQUENCY_RANGE",
      range,
    });
    const again = spectrumReducer(withRange, {
      type: "SET_FREQUENCY_RANGE",
      range: { min: 1, max: 5 },
    });
    expect(again).toBe(withRange); // same reference — identity optimization
  });

  it("SET_SIGNAL_AREA_AND_RANGE updates both", () => {
    const range = { min: 24.72, max: 29.88 };
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_SIGNAL_AREA_AND_RANGE",
      area: "B",
      range,
    });
    expect(next.activeSignalArea).toBe("B");
    expect(next.frequencyRange).toEqual(range);
  });

  it("SET_TEMPORAL_RESOLUTION updates resolution", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_TEMPORAL_RESOLUTION",
      resolution: "high",
    });
    expect(next.displayTemporalResolution).toBe("high");
  });

  it("SET_SELECTED_FILES updates files", () => {
    const files = [{ name: "test.iq", file: new File([], "test.iq") }];
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_SELECTED_FILES",
      files,
    });
    expect(next.selectedFiles).toEqual(files);
  });

  it("SET_SNAPSHOT_GRID toggles grid preference", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_SNAPSHOT_GRID",
      preference: false,
    });
    expect(next.snapshotGridPreference).toBe(false);
  });

  it("SET_DRAW_PARAMS updates draw params", () => {
    const params = {
      spikeCount: 20,
      spikeWidth: 0.8,
      centerSpikeBoost: 3.0,
      floorAmplitude: 0.3,
      decayRate: 0.1,
      envelopeWidth: 5,
    };
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_DRAW_PARAMS",
      params,
    });
    expect(next.drawParams).toEqual(params);
  });

  it("SET_SOURCE_MODE updates sourceMode", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_SOURCE_MODE",
      mode: "file",
    });
    expect(next.sourceMode).toBe("file");
  });

  it("SET_STITCH_STATUS updates stitchStatus", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_STITCH_STATUS",
      status: "Processing...",
    });
    expect(next.stitchStatus).toBe("Processing...");
  });

  it("SET_VISUALIZER_PAUSED updates visualizerPaused", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_VISUALIZER_PAUSED",
      paused: true,
    });
    expect(next.visualizerPaused).toBe(true);
  });

  it("TRAINING_START enables capture with label", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "TRAINING_START",
      label: "target",
    });
    expect(next.isTrainingCapturing).toBe(true);
    expect(next.trainingCaptureLabel).toBe("target");
  });

  it("TRAINING_STOP disables capture and increments samples", () => {
    const capturing = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "TRAINING_START",
      label: "noise",
    });
    const stopped = spectrumReducer(capturing, { type: "TRAINING_STOP" });
    expect(stopped.isTrainingCapturing).toBe(false);
    expect(stopped.trainingCaptureLabel).toBeNull();
    expect(stopped.trainingCapturedSamples).toBe(
      INITIAL_SPECTRUM_STATE.trainingCapturedSamples + 1,
    );
  });

  it("TRIGGER_STITCH auto-pauses and increments trigger", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "TRIGGER_STITCH",
    });
    expect(next.isStitchPaused).toBe(true);
    expect(next.stitchStatus).toBe("");
    expect(next.stitchTrigger).toBe(INITIAL_SPECTRUM_STATE.stitchTrigger + 1);
  });

  it("TOGGLE_STITCH_PAUSE toggles isStitchPaused", () => {
    const paused = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "TOGGLE_STITCH_PAUSE",
    });
    expect(paused.isStitchPaused).toBe(!INITIAL_SPECTRUM_STATE.isStitchPaused);
    const unpaused = spectrumReducer(paused, { type: "TOGGLE_STITCH_PAUSE" });
    expect(unpaused.isStitchPaused).toBe(INITIAL_SPECTRUM_STATE.isStitchPaused);
  });

  it("SET_STITCH_SOURCE_SETTINGS updates settings", () => {
    const settings = { gain: 20, ppm: 5 };
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_STITCH_SOURCE_SETTINGS",
      settings,
    });
    expect(next.stitchSourceSettings).toEqual(settings);
  });

  it("SET_STITCH_PAUSED sets paused explicitly", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_STITCH_PAUSED",
      paused: true,
    });
    expect(next.isStitchPaused).toBe(true);
  });

  it("LEAVE_VISUALIZER pauses both visualizer and stitch", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "LEAVE_VISUALIZER",
    });
    expect(next.visualizerPaused).toBe(true);
    expect(next.isStitchPaused).toBe(true);
  });

  it("SET_FFT_FRAME_RATE updates fftFrameRate", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "SET_FFT_FRAME_RATE",
      fftFrameRate: 30,
    });
    expect(next.fftFrameRate).toBe(30);
  });

  it("returns same state for unknown action type", () => {
    const next = spectrumReducer(INITIAL_SPECTRUM_STATE, {
      type: "UNKNOWN_ACTION",
    } as any);
    expect(next).toBe(INITIAL_SPECTRUM_STATE);
  });
});
