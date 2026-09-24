import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TestWrapper } from "./testUtils";

const mockDemodContext = {
  audioSurveyJob: null as any,
  audioSurveyCandidates: [] as any[],
  audioSurveyStorageUsage: { usedBytes: 0, capBytes: 1_000_000_000, artifactCount: 0 },
  audioSurveyTraining: null as any,
  audioSurveyError: null as string | null,
  startAudioSurvey: jest.fn().mockResolvedValue(undefined),
  resumeAudioSurvey: jest.fn().mockResolvedValue(undefined),
  pauseAudioSurvey: jest.fn(),
  stopAudioSurvey: jest.fn(),
  trainAudioSurveyModel: jest.fn().mockResolvedValue(undefined),
  pauseAudioSurveyTraining: jest.fn(),
  playAudioSurveyCandidate: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  useDemod: () => mockDemodContext,
}));

import { CoreMLNode } from "@n-apt/demodulation/react-flow/nodes/CoreMLNode";

describe("local audio survey controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts the selected A/B source workflow and displays local storage usage", async () => {
    render(
      <TestWrapper>
        <CoreMLNode data={{ coremlOptions: true, label: "ML Audio Demodulator" }} />
      </TestWrapper>,
    );

    expect(screen.getByText("Local ML audio demodulation")).toBeInTheDocument();
    expect(screen.getByText(/independent 3.2 MS\/s views/)).toBeInTheDocument();
    expect(screen.getByText(/Storage: 0.0 MB \/ 1.00 GB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start survey" }));

    await waitFor(() =>
      expect(mockDemodContext.startAudioSurvey).toHaveBeenCalledWith(
        "combined",
        256_000_000,
      ),
    );
  });
});
