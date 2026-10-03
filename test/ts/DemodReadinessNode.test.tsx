import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TestWrapper } from "./testUtils";

const mockDemodContext = {
  selectedBaseline: "audio",
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

import { DemodReadinessNode } from "@n-apt/demodulation/react-flow/nodes/DemodReadinessNode";

describe("DemodReadinessNode", () => {
  it("owns capture warnings and offers the compatible Channels controls", () => {
    render(
      <TestWrapper
        preloadedState={{
          demod: { sourceMode: "live", centerFreqHz: 10_000_000 },
          spectrum: { frequencyRange: null },
          websocket: {
            channels: [
              { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
              { id: "b", label: "B", min_hz: 24_100_000, max_hz: 30_370_000 },
              { id: "c", label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
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
    expect(screen.getByText(/Audio and Speech require Channel A or B/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tune Channel A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tune Channel B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tune Channel C" })).not.toBeInTheDocument();
  });
});
