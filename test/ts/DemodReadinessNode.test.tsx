import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TestWrapper } from "./testUtils";

const mockDemodContext = {
  selectedBaseline: "audio",
  visionPreset: "M",
  analysisSession: { state: "idle" },
  demodQualityStatus: {
    fit: "unmet",
    reasons: ["Configured FFT size must be at least 32768."],
  },
  audioSurveyJob: null,
  audioSurveyCandidates: [],
  audioSurveyTraining: false,
  audioSurveyNeuralModelReady: false,
  audioSurveyNeuralBackend: null,
  audioSurveyOnnxModelAvailable: false,
  audioSurveyOnnxLoading: false,
};
const mockSpectrumStore = {
  manualVisualizerPaused: false,
  selectedSourceId: null as string | null,
  setVisualizerPause: jest.fn(),
  toggleVisualizerPause: jest.fn(),
};
const mockReleaseReadinessLease = jest.fn();
const mockRegisterActiveAcquisitionOperation = jest.fn(
  (_kind: string, _sourceId?: string | null) => mockReleaseReadinessLease,
);

jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  useDemod: () => mockDemodContext,
}));

jest.mock("@n-apt/demodulation/context/DemodAudioContext", () => ({
  useDemodAudio: () => ({ audioPlayback: { isPlaying: false } }),
}));

jest.mock("@n-apt/spectrum", () => ({
  Channels: ({ channelLabels }: { channelLabels: string[] }) => (
    <div data-testid="channel-tune-controls">
      {channelLabels.map((label) => (
        <button key={label}>Tune Channel {label}</button>
      ))}
    </div>
  ),
}));

jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => mockSpectrumStore,
}));

jest.mock("@n-apt/spectrum/activeAcquisitionOperations", () => ({
  registerActiveAcquisitionOperation: (
    kind: string,
    sourceId?: string | null,
  ) => mockRegisterActiveAcquisitionOperation(kind, sourceId),
}));

import { DemodReadinessNode } from "@n-apt/demodulation/react-flow/nodes/DemodReadinessNode";

describe("DemodReadinessNode", () => {
  beforeEach(() => {
    mockDemodContext.selectedBaseline = "audio";
    mockRegisterActiveAcquisitionOperation.mockClear();
    mockReleaseReadinessLease.mockClear();
  });

  it("holds acquisition while the readiness node is present and releases it on unmount", () => {
    const { unmount } = render(
      <TestWrapper
        preloadedState={{
          demod: { sourceMode: "live", centerFreqHz: 1_000_000 },
          spectrum: { frequencyRange: null },
          websocket: {
            activeSourceId: "radio-1",
            sources: [
              {
                id: "radio-1",
                name: "RTL-SDR Blog V4",
                kind: "rtl_sdr",
                capability: "rx",
                status: "receiving",
              },
            ],
            channels: [],
          },
        }}
      >
        <DemodReadinessNode data={{ label: "Demod Readiness" }} />
      </TestWrapper>,
    );

    expect(mockRegisterActiveAcquisitionOperation).toHaveBeenCalledWith(
      "demod-readiness-node",
      "radio-1",
    );
    unmount();
    expect(mockReleaseReadinessLease).toHaveBeenCalledTimes(1);
  });

  it("owns capture warnings and offers the compatible Channels controls", () => {
    render(
      <TestWrapper
        preloadedState={{
          demod: { sourceMode: "live", centerFreqHz: 10_000_000 },
          spectrum: { frequencyRange: null },
          websocket: {
            channels: [
              {
                id: "a",
                label: "A",
                min_hz: 18_000,
                max_hz: 4_390_000,
                prerequisite_for: {
                  "demod.stimulus.audio": "any",
                  "demod.stimulus.apt": "any",
                  "demod.stimulus.internal": "any",
                  "demod.stimulus.speech": "any",
                  "demod.audio_survey": "all",
                },
              },
              {
                id: "b",
                label: "B",
                min_hz: 24_100_000,
                max_hz: 30_370_000,
                prerequisite_for: {
                  "demod.stimulus.audio": "any",
                  "demod.stimulus.apt": "any",
                  "demod.stimulus.internal": "any",
                  "demod.stimulus.speech": "any",
                  "demod.audio_survey": "all",
                },
              },
              {
                id: "c",
                label: "C",
                min_hz: 4_750_000,
                max_hz: 23_000_000,
                prerequisite_for: { "demod.stimulus.vision": "all" },
              },
            ],
          },
        }}
      >
        <DemodReadinessNode data={{ label: "Demod Readiness" }} />
      </TestWrapper>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Configured FFT size must be at least 32768.",
    );
    expect(
      screen.getByTestId("capture-setup-primary-reason"),
    ).toHaveTextContent("Configured FFT size must be at least 32768.");
    expect(
      screen.getByText(/Audio and Speech require Channel A or B/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tune Channel A" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tune Channel B" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tune Channel C" }),
    ).not.toBeInTheDocument();
  });

  it("explains automatic audio pairing without pointing to a missing toggle", () => {
    render(
      <TestWrapper
        preloadedState={{
          demod: { sourceMode: "live", centerFreqHz: 1_000_000 },
          spectrum: { frequencyRange: null },
          websocket: {
            channels: [
              {
                id: "a",
                label: "A",
                min_hz: 18_000,
                max_hz: 4_390_000,
                prerequisite_for: {
                  "demod.stimulus.audio": "any",
                  "demod.audio_survey": "all",
                },
              },
              {
                id: "b",
                label: "B",
                min_hz: 24_100_000,
                max_hz: 30_370_000,
                prerequisite_for: {
                  "demod.stimulus.audio": "any",
                  "demod.audio_survey": "all",
                },
              },
            ],
          },
        }}
      >
        <DemodReadinessNode data={{ label: "Demod Readiness" }} />
      </TestWrapper>,
    );

    expect(
      screen.getByText(/Trigger waits for a fresh tuned Channel A\/B frame/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/enable.*Pair stimulus tone with captured RF audio/i),
    ).not.toBeInTheDocument();
  });
});

test("Vision switches readiness to the spatial reference and decoder stages", () => {
  mockDemodContext.selectedBaseline = "vision";
  render(
    <TestWrapper
      preloadedState={{
        demod: { sourceMode: "live", centerFreqHz: 10_000_000 },
        spectrum: { frequencyRange: null },
        websocket: {
          channels: [
            {
              id: "c",
              label: "C",
              min_hz: 4_750_000,
              max_hz: 23_000_000,
              prerequisite_for: { "demod.stimulus.vision": "all" },
            },
          ],
          activeSourceId: "radio-1",
          sources: [
            {
              id: "radio-1",
              name: "RTL-SDR Blog V4",
              kind: "rtl_sdr",
              capability: "rx",
              status: "receiving",
            },
          ],
        },
      }}
    >
      <DemodReadinessNode data={{ label: "Demod Readiness" }} />
    </TestWrapper>,
  );
  expect(screen.getByTestId("vision-demod-workflow")).toBeInTheDocument();
  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveTextContent(
    "RF source",
  );
  expect(
    screen.getByTestId("vision-demod-flow-node-stimulus"),
  ).toHaveTextContent("Known visual stimulus");
  expect(
    screen.getByTestId("vision-demod-flow-node-stimulus"),
  ).toHaveTextContent(/S.*violet.*blue.*M.*green.*L.*yellow.*green.*red/i);
  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveTextContent(
    "Live RTL-SDR selected",
  );
  expect(
    screen.getByTestId("vision-demod-flow-node-channel"),
  ).toHaveTextContent(/4\.75 ?MHz.*23 ?MHz/);
  expect(
    screen.getByTestId("vision-demod-flow-node-paired-reference"),
  ).toHaveTextContent(/No aligned spatial references/);
  expect(screen.getByTestId("vision-demod-flow-node-labels")).toHaveTextContent(
    /Timed RGB \+ preset labels/,
  );
  expect(screen.getByTestId("vision-demod-flow-node-output")).toHaveTextContent(
    /Local ONNX reconstruction.*16 × 16 RGB.*experimental/,
  );
  expect(
    screen.getByTestId("vision-demod-flow-node-apt-baseline"),
  ).toHaveTextContent(
    /N-APT spike\/valley DSP.*walk measured peak\/valley pairs/i,
  );
  expect(
    screen.getByTestId("vision-demod-flow-node-apt-baseline"),
  ).toHaveTextContent(/34 kHz.*spacing prior/i);
  expect(
    screen.getByTestId("vision-demod-flow-node-apt-output"),
  ).toHaveTextContent(
    /partial-band spatial estimator.*channel band may cover only part of the frame.*spatial references/i,
  );
  expect(screen.getByTestId("vision-demod-workflow")).not.toHaveTextContent(
    /NOAA|2\.4 kHz|2 lines\/s/i,
  );
  expect(screen.getByTestId("vision-demod-flow-node-output")).toHaveTextContent(
    /opponent|ONNX.*experimental/i,
  );
  expect(
    screen.queryByTestId("vision-demod-flow-node-opponent"),
  ).not.toBeInTheDocument();
  expect(
    document.querySelectorAll('[data-testid^="vision-demod-flow-node-"]'),
  ).toHaveLength(10);
  expect(
    screen
      .getByTestId("vision-demod-workflow")
      .querySelector("[data-edge-count]"),
  ).toHaveAttribute("data-edge-count", "11");
  expect(screen.getByText(/Channel C source ready/)).toBeInTheDocument();
  expect(screen.getByText(/No aligned spatial references/)).toBeInTheDocument();
  expect(
    screen.getByTestId("vision-demod-flow-node-decoder"),
  ).toHaveTextContent(
    /Python offline train.*Versioned JSONL.*whole-session splits.*untouched test/i,
  );
  expect(screen.getByTestId("vision-demod-flow-node-output")).toHaveTextContent(
    /Local ONNX reconstruction.*Browser inference/i,
  );
  expect(screen.queryByTestId("audio-demod-workflow")).not.toBeInTheDocument();
});

test("Vision readiness qualifies a live HackRF One receiver", () => {
  mockDemodContext.selectedBaseline = "vision";
  render(
    <TestWrapper
      preloadedState={{
        demod: { sourceMode: "live", centerFreqHz: 10_000_000 },
        spectrum: { frequencyRange: null },
        websocket: {
          channels: [
            {
              id: "c",
              label: "C",
              min_hz: 4_750_000,
              max_hz: 23_000_000,
              prerequisite_for: { "demod.stimulus.vision": "all" },
            },
          ],
          activeSourceId: "hackrf-1",
          sources: [
            {
              id: "hackrf-1",
              name: "HackRF One",
              kind: "hackrf_one",
              capability: "tx_rx",
              status: "receiving",
              active_duplex_mode: "rx",
            },
          ],
        },
      }}
    >
      <DemodReadinessNode data={{ label: "Demod Readiness" }} />
    </TestWrapper>,
  );

  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveTextContent(
    "Live HackRF One selected",
  );
});

test("Vision readiness does not qualify an unrelated live receiver", () => {
  mockDemodContext.selectedBaseline = "vision";
  render(
    <TestWrapper
      preloadedState={{
        demod: { sourceMode: "live", centerFreqHz: 10_000_000 },
        spectrum: { frequencyRange: null },
        websocket: {
          channels: [],
          activeSourceId: "other-radio",
          sources: [
            {
              id: "other-radio",
              name: "Generic SDR",
              kind: "other_sdr",
              capability: "rx",
              status: "receiving",
            },
          ],
        },
      }}
    >
      <DemodReadinessNode data={{ label: "Demod Readiness" }} />
    </TestWrapper>,
  );

  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveTextContent(
    "Select a live RTL-SDR or HackRF One",
  );
  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveAttribute(
    "data-state",
    "waiting",
  );
  expect(
    screen.getByTestId("vision-demod-flow-node-channel"),
  ).toHaveTextContent("range unavailable");
});

test("Vision readiness requires live mode even with a supported receiver selected", () => {
  mockDemodContext.selectedBaseline = "vision";
  render(
    <TestWrapper
      preloadedState={{
        demod: { sourceMode: "file", centerFreqHz: 10_000_000 },
        waterfall: { sourceMode: "file", selectedFiles: [] },
        spectrum: { frequencyRange: null },
        websocket: {
          channels: [
            {
              id: "c",
              label: "C",
              min_hz: 4_750_000,
              max_hz: 23_000_000,
              prerequisite_for: { "demod.stimulus.vision": "all" },
            },
          ],
          activeSourceId: "radio-1",
          sources: [
            {
              id: "radio-1",
              name: "RTL-SDR Blog V4",
              kind: "rtl_sdr",
              capability: "rx",
              status: "receiving",
            },
          ],
        },
      }}
    >
      <DemodReadinessNode data={{ label: "Demod Readiness" }} />
    </TestWrapper>,
  );

  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveTextContent(
    "Replay selected · live RTL-SDR or HackRF One required",
  );
  expect(screen.getByTestId("vision-demod-flow-node-source")).toHaveAttribute(
    "data-state",
    "waiting",
  );
});
