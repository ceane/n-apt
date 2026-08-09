import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureControlsSection } from "@n-apt/capture/sidebar/IQCaptureControlsSection";
import { TestWrapper } from "./testUtils";

// Mock useAuthentication
jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
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
  captureRange: {
    min: 10,
    max: 20,
    segments: [{ label: "Area A", min: 10, max: 20 }],
  },
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
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("Area A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByText("Capture")).toBeInTheDocument();
  });

  it("shows the overall capture span inside selected range dividers, not beside Ranges", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[{ label: "Area A", min: 10, max: 4_390_010 }]}
          captureRange={{
            min: 10,
            max: 4_390_010,
            segments: [{ label: "Area A", min: 10, max: 4_390_010 }],
          }}
          activeCaptureAreas={["Area A"]}
        />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("4.39MHz")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hardware sample rate")).not.toBeInTheDocument();
  });

  it("estimates timed raw IQ data from the selected capture span", () => {
    const { rerender } = render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.queryByText(/Estimated data:/)).not.toBeInTheDocument();

    expect(defaultProps.onActiveCaptureAreasChange).not.toHaveBeenCalled();

    rerender(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          activeCaptureAreas={["Area A"]}
          captureRange={{
            min: 0,
            max: 3_200_000,
            segments: [{ label: "Area A", min: 0, max: 3_200_000 }],
          }}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Estimated data: 30.52 MB")).toBeInTheDocument();
  });

  it("shows each selected channel's own span in its divider", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[
            { label: "Area A", min: 10, max: 4_390_010 },
            { label: "Area B", min: 24_100_000, max: 30_370_000 },
          ]}
          captureRange={{
            min: 10,
            max: 30_370_000,
            segments: [
              { label: "Area A", min: 10, max: 4_390_010 },
              { label: "Area B", min: 24_100_000, max: 30_370_000 },
            ],
          }}
          activeCaptureAreas={["Area A", "Area B"]}
        />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("4.39MHz")).toBeInTheDocument();
    expect(screen.getByText("6.27MHz")).toBeInTheDocument();
    expect(screen.queryAllByText("30.37MHz")).toHaveLength(1);
  });

  it("offers capture formats in .napt, .iq, .wav order", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const [fileTypeSelect] = screen.getAllByRole("combobox");
    const options = Array.from(fileTypeSelect.querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(options).toEqual([".napt", ".iq", ".wav"]);
  });

  it("should handle area selection", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const checkbox = screen.getByLabelText("Area A");
    fireEvent.click(checkbox);
    expect(defaultProps.onActiveCaptureAreasChange).toHaveBeenCalledWith([
      "Area A",
    ]);
  });

  it("should hide stepwise and interleaved modes when the hardware sample rate covers the selected channel span", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[{ label: "Area A", min: 10, max: 20 }]}
          captureRange={{
            min: 10,
            max: 20,
            segments: [{ label: "Area A", min: 10, max: 20 }],
          }}
          activeCaptureAreas={["Area A"]}
          maxSampleRate={20_000}
          acquisitionMode="stepwise"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const acquisitionSelect = screen.getByDisplayValue("Whole Sample");
    expect(acquisitionSelect).toBeDisabled();
    expect(
      screen.queryByRole("option", { name: "Stepwise" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Interleaved (TDMS)" }),
    ).not.toBeInTheDocument();
  });

  it("should force Whole Sample and hide sweep modes for an onscreen range", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[
            { label: "Onscreen", min: 0, max: 100 },
            { label: "Area A", min: 20_000, max: 40_000 },
          ]}
          captureRange={{
            min: 0,
            max: 40_000,
            segments: [
              { label: "Onscreen", min: 0, max: 100 },
              { label: "Area A", min: 20_000, max: 40_000 },
            ],
          }}
          activeCaptureAreas={["Onscreen", "Area A"]}
          maxSampleRate={100}
          acquisitionMode="interleaved"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByDisplayValue("Whole Sample")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Stepwise" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Interleaved (TDMS)" })).not.toBeInTheDocument();
  });

  it("should offer Whole Sample for a named range within the hardware rate", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[{ label: "Area A", min: 0, max: 100 }]}
          captureRange={{
            min: 0,
            max: 100,
            segments: [{ label: "Area A", min: 0, max: 100 }],
          }}
          activeCaptureAreas={["Area A"]}
          maxSampleRate={200}
          acquisitionMode="stepwise"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByRole("option", { name: "Whole Sample" })).toBeInTheDocument();
  });

  it("should handle duration change", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const input = screen.getByDisplayValue("5");
    fireEvent.change(input, { target: { value: "10" } });
    expect(defaultProps.onCaptureDurationSChange).toHaveBeenCalledWith(10);
  });

  it("should disable capture button when not connected", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} isConnected={false} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

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
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

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
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

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
            filename: "test.napt",
          }}
        />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("test.napt")).toBeInTheDocument();
  });
});
