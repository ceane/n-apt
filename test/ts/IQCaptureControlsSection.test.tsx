import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { ThemeProvider } from "styled-components";

// Mock useAuthentication
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
  }),
}));

const mockTheme = {
  primary: "#00d4ff",
  primaryAnchor: "rgba(0, 212, 255, 0.1)",
};

const defaultProps = {
  isOpen: true,
  onToggle: jest.fn(),
  activeCaptureAreas: [],
  availableCaptureAreas: [{ label: "Area A", min: 10, max: 20 }],
  captureDurationS: 5,
  captureFileType: ".napt" as const,
  acquisitionMode: "stepwise" as const,
  captureEncrypted: true,
  capturePlayback: false,
  captureRange: { min: 10, max: 20, segments: [{ label: "Area A", min: 10, max: 20 }] },
  maxSampleRate: 3200000,
  captureStatus: { status: "idle" as const },
  isConnected: true,
  deviceState: "connected" as const,
  onActiveCaptureAreasChange: jest.fn(),
  onCaptureDurationSChange: jest.fn(),
  onCaptureFileTypeChange: jest.fn(),
  onAcquisitionModeChange: jest.fn(),
  onCaptureEncryptedChange: jest.fn(),
  onCapturePlaybackChange: jest.fn(),
  onCapture: jest.fn(),
};

describe("IQCaptureControlsSection", () => {
  it("should render correctly when open", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <IQCaptureControlsSection {...defaultProps} />
      </ThemeProvider>
    );

    expect(screen.getByText("Area A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByText("Capture")).toBeInTheDocument();
  });

  it("should handle area selection", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <IQCaptureControlsSection {...defaultProps} />
      </ThemeProvider>
    );

    const checkbox = screen.getByLabelText("Area A");
    fireEvent.click(checkbox);
    expect(defaultProps.onActiveCaptureAreasChange).toHaveBeenCalledWith(["Area A"]);
  });

  it("should handle duration change", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <IQCaptureControlsSection {...defaultProps} />
      </ThemeProvider>
    );

    const input = screen.getByDisplayValue("5");
    fireEvent.change(input, { target: { value: "10" } });
    expect(defaultProps.onCaptureDurationSChange).toHaveBeenCalledWith(10);
  });

  it("should disable capture button when not connected", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <IQCaptureControlsSection {...defaultProps} isConnected={false} />
      </ThemeProvider>
    );

    const button = screen.getByText("Capture");
    expect(button).toBeDisabled();
  });

  it("should show 'Capturing...' status", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{ status: "started", jobId: "job-1" }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("Capturing...")).toBeInTheDocument();
    expect(screen.getByText(/Capturing... job-1/)).toBeInTheDocument();
  });

  it("should show success status and download link", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{
            status: "done",
            jobId: "job-1",
            downloadUrl: "/api/download?id=job-1",
            filename: "test.napt"
          }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("test.napt")).toBeInTheDocument();
  });
});
