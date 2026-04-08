import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureControlsSection } from "../../src/ts/components/sidebar/IQCaptureControlsSection";
import { TestWrapper } from "./testUtils";

// Mock useAuthentication
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
  }),
}));

const defaultProps = {
  activeCaptureAreas: [],
  availableCaptureAreas: [{ label: "Area A", min: 10, max: 20 }],
  captureDurationS: 5,
  captureDurationMode: "timed" as const,
  captureFileType: ".napt" as const,
  acquisitionMode: "stepwise" as const,
  captureEncrypted: true,
  capturePlayback: false,
  captureGeolocation: false,
  captureRange: { min: 10, max: 20, segments: [{ label: "Area A", min: 10, max: 20 }] },
  maxSampleRate: 3200000,
  captureStatus: null,
  isConnected: true,
  deviceState: "connected" as const,
  onActiveCaptureAreasChange: jest.fn(),
  onCaptureDurationSChange: jest.fn(),
  onCaptureFileTypeChange: jest.fn(),
  onAcquisitionModeChange: jest.fn(),
  onCaptureEncryptedChange: jest.fn(),
  onCapturePlaybackChange: jest.fn(),
  onCaptureGeolocationChange: jest.fn(),
  onCapture: jest.fn(),
  onStopCapture: jest.fn(),
  onClearStatus: jest.fn(),
};

describe("IQCaptureControlsSection", () => {
  it("should render correctly when open", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    expect(screen.getByText("Area A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByText("Capture")).toBeInTheDocument();
  });

  it("should handle area selection", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    const checkbox = screen.getByLabelText("Area A");
    fireEvent.click(checkbox);
    expect(defaultProps.onActiveCaptureAreasChange).toHaveBeenCalledWith(["Area A"]);
  });

  it("should handle duration change", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    const input = screen.getByDisplayValue("5");
    fireEvent.change(input, { target: { value: "10" } });
    expect(defaultProps.onCaptureDurationSChange).toHaveBeenCalledWith(10);
  });

  it("should disable capture button when not connected", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} isConnected={false} />
      </TestWrapper>
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    const button = screen.getByText("Capture");
    expect(button).toBeDisabled();
  });

  it("should keep Stop enabled during an active capture and call the stop handler", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{ status: "started", jobId: "job-1" }}
        />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText("IQ Capture Controls"));

    const stopButton = screen.getByText("Stop");
    expect(stopButton).toBeEnabled();

    fireEvent.click(stopButton);
    expect(defaultProps.onStopCapture).toHaveBeenCalled();
    expect(defaultProps.onCapture).not.toHaveBeenCalled();
  });

  it("should show 'Capturing...' status", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{ status: "started", jobId: "job-1" }}
        />
      </TestWrapper>
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    expect(screen.getByText("Capturing now...")).toBeInTheDocument();
  });

  it("should show success status and download link", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{
            status: "done",
            jobId: "job-1",
            downloadUrl: "/api/download?id=job-1",
            filename: "test.napt"
          }}
        />
      </TestWrapper>
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("IQ Capture Controls"));

    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("test.napt")).toBeInTheDocument();
  });
});
