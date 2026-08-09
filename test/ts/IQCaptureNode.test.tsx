/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureNode } from "@n-apt/demodulation/react-flow/nodes/IQCaptureNode";
import { TestWrapper } from "./testUtils";
import {
  sendCaptureCommand,
  sendCaptureStopCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import { useAppDispatch, useAppSelector } from "@n-apt/redux/store";

// Mock the websocketThunks
jest.mock("@n-apt/redux/thunks/websocketThunks", () => ({
  sendCaptureCommand: jest.fn(() => ({ type: "MOCK_CAPTURE_COMMAND" })),
  sendCaptureStopCommand: jest.fn(() => ({
    type: "MOCK_CAPTURE_STOP_COMMAND",
  })),
}));

// Mock useAuthentication
jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
  }),
}));

// Mock useSpectrumStore
jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    effectiveFrames: [],
  }),
}));

// Mock the store hooks
jest.mock("@n-apt/redux/store", () => ({
  ...jest.requireActual("@n-apt/redux/store"),
  useAppDispatch: jest.fn(),
  useAppSelector: jest.fn(),
}));

jest.mock("@xyflow/react", () => ({
  Handle: () => <div />,
  Position: { Left: "left", Right: "right" },
  useNodes: () => [],
  useEdges: () => [],
  useNodeConnections: () => [],
  useHandleConnections: () => [],
}));

const mockState = {
  spectrum: {
    sampleRateHz: 3200000,
    centerFrequencyHz: 100000000,
    frequencyRange: { min: 98400000, max: 101600000 },
  },
  websocket: {
    isConnected: true,
    deviceState: "connected",
    captureStatus: null,
  },
  demod: {
    centerFreqHz: 200000000,
  },
  channels: {
    frames: [],
  },
  auth: {
    isAuthenticated: true,
    sessionToken: "mock-token",
  },
  waterfall: {
    sourceMode: "live",
  },
  settings: {
    acquisitionMode: "stepwise",
    captureDurationS: 5,
    captureDurationMode: "timed",
    captureFileType: ".napt",
    captureEncrypted: true,
    capturePlayback: false,
    captureGeolocation: false,
  },
};

describe("IQCaptureNode", () => {
  const mockDispatch = jest.fn();

  beforeEach(() => {
    (useAppDispatch as jest.Mock).mockReturnValue(mockDispatch);
    (useAppSelector as jest.Mock).mockImplementation((selector) =>
      selector(mockState),
    );
    jest.clearAllMocks();
  });

  it("dispatches sendCaptureCommand with bandwidth and center frequency when 'Custom Range' is toggled", async () => {
    render(
      <TestWrapper>
        <IQCaptureNode id="node-1" data={{ label: "Capture" }} />
      </TestWrapper>,
    );

    // Select 'Custom Range' button
    const customRangeButton = screen.getByLabelText("Custom Range");
    fireEvent.click(customRangeButton);

    // Click Capture button
    const captureButton = screen.getByRole("button", { name: "Capture" });
    fireEvent.click(captureButton);

    // Verify dispatch
    expect(sendCaptureCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        bandwidth: 3200000,
        bandwidthCenterFrequency: 100000000,
        liveMode: false,
      }),
    );
    expect(mockDispatch).toHaveBeenCalledWith({ type: "MOCK_CAPTURE_COMMAND" });
  });

  it("uses the displayed spectrum range for Onscreen captures", () => {
    render(
      <TestWrapper>
        <IQCaptureNode id="node-1" data={{ label: "Capture" }} />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByLabelText("Onscreen"));
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    expect(sendCaptureCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        fragments: [{ minFreq: 98400000, maxFreq: 101600000 }],
        bandwidth: 3200000,
        bandwidthCenterFrequency: 100000000,
        liveMode: false,
      }),
    );
  });

  it("respects manual bandwidth input changes", async () => {
    render(
      <TestWrapper>
        <IQCaptureNode id="node-1" data={{ label: "Capture" }} />
      </TestWrapper>,
    );

    // Find the 'Start' and 'End' inputs for Custom Range
    const startInput = screen.getByLabelText("Start");
    const endInput = screen.getByLabelText("End");

    // Change range to 95MHz - 105MHz (10MHz bandwidth)
    fireEvent.change(startInput, { target: { value: "95" } });
    fireEvent.change(endInput, { target: { value: "105" } });

    // Click Capture
    const captureButton = screen.getByRole("button", { name: "Capture" });
    fireEvent.click(captureButton);

    // Verify dispatch has 10MHz bandwidth and 100MHz center
    expect(sendCaptureCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        bandwidth: 10000000,
        bandwidthCenterFrequency: 100000000,
      }),
    );
  });
});
