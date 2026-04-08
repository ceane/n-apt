import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureIntegrationTest } from "./IQCaptureIntegrationTest";
import { TestWrapper } from "../ts/testUtils";

const mockSendCaptureCommand = jest.fn();

jest.mock("../../src/ts/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: true,
    deviceState: "connected",
    captureStatus: { status: "idle", jobId: "" },
    maxSampleRateHz: 3200000,
    dataRef: { current: { deviceInfo: "Mock Device" } },
    sendCaptureCommand: mockSendCaptureCommand,
  }),
}));

jest.mock("../../src/ts/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
  }),
}));

describe("Onscreen Whole Sample Capture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends whole_sample when onscreen width matches hardware sample rate", async () => {
    render(
      <TestWrapper>
        <IQCaptureIntegrationTest />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    fireEvent.click(screen.getByLabelText("Onscreen"));

    await act(async () => {
      fireEvent.click(screen.getByText("Capture"));
    });

    expect(mockSendCaptureCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        acquisitionMode: "whole_sample",
        fragments: [{ minFreq: 0, maxFreq: 3.2 }],
      }),
    );
  });
});
