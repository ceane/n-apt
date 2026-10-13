import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TestWrapper } from "./testUtils";

jest.mock("@n-apt/shared/ui/loadEncryptedMlModule", () => ({
  loadEncryptedMlModule: jest.fn(() =>
    Promise.reject(new Error("The encrypted ML feature bundle is unavailable.")),
  ),
}));

jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  useDemod: () => ({
    selectedBaseline: "audio",
    analysisSession: { state: "idle" },
    demodQualityStatus: null,
    audioSurveyJob: null,
    audioSurveyCandidates: [],
    audioSurveyTraining: false,
    audioSurveyNeuralModelReady: false,
    audioSurveyNeuralBackend: null,
    audioSurveyOnnxModelAvailable: false,
    audioSurveyOnnxLoading: false,
  }),
}));

jest.mock("@n-apt/demodulation/context/DemodAudioContext", () => ({
  useDemodAudio: () => ({ audioPlayback: { isPlaying: false } }),
}));

jest.mock("@n-apt/spectrum", () => ({ Channels: () => null }));
jest.mock("@n-apt/spectrum/public/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    manualVisualizerPaused: false,
    selectedSourceId: null,
    setVisualizerPause: jest.fn(),
    toggleVisualizerPause: jest.fn(),
  }),
}));
jest.mock("@n-apt/spectrum/public/activeAcquisitionOperations", () => ({
  registerActiveAcquisitionOperation: jest.fn(() => jest.fn()),
}));

import { DemodReadinessNode } from "@n-apt/demodulation/react-flow/nodes/DemodReadinessNode";

describe("encrypted demod readiness adapter", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("shows a retryable fallback when the protected readiness node cannot load", async () => {
    const { loadEncryptedMlModule } = jest.requireMock(
      "@n-apt/shared/ui/loadEncryptedMlModule",
    ) as { loadEncryptedMlModule: jest.Mock };
    loadEncryptedMlModule.mockClear();

    render(
      <TestWrapper>
        <DemodReadinessNode data={{ label: "Demod Readiness" }} />
      </TestWrapper>,
    );

    expect(
      await screen.findByRole("button", { name: "Retry Demod readiness" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The encrypted ML feature bundle could not be loaded."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry Demod readiness" }));
    await waitFor(() => expect(loadEncryptedMlModule).toHaveBeenCalledTimes(2));
  });
});
