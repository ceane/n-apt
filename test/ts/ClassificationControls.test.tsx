import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ClassificationControls from "@n-apt/components/ClassificationControls";

describe("ClassificationControls Component", () => {
  const defaultProps = {
    isDeviceConnected: true,
    activeSignalArea: "A",
    isCapturing: false,
    captureLabel: null as "target" | "noise" | null,
    capturedSamples: 0,
    onCaptureStart: jest.fn(),
    onCaptureStop: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render without crashing", () => {
    render(<ClassificationControls {...defaultProps} />);
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
  });

  it("should display the active signal area", () => {
    render(<ClassificationControls {...defaultProps} activeSignalArea="B" />);
    expect(screen.getByText("Train [B]")).toBeInTheDocument();
  });

  it("should display sample count", () => {
    render(<ClassificationControls {...defaultProps} capturedSamples={5} />);
    expect(screen.getByText("5 samples")).toBeInTheDocument();
  });

  it("should call onCaptureStart when Target button is clicked", () => {
    render(<ClassificationControls {...defaultProps} />);
    fireEvent.click(screen.getByText("Target"));
    expect(defaultProps.onCaptureStart).toHaveBeenCalledWith("target");
  });

  it("should call onCaptureStart when Noise button is clicked", () => {
    render(<ClassificationControls {...defaultProps} />);
    fireEvent.click(screen.getByText("Noise"));
    expect(defaultProps.onCaptureStart).toHaveBeenCalledWith("noise");
  });

  it("should call onCaptureStop when active Target button is clicked", () => {
    render(
      <ClassificationControls
        {...defaultProps}
        isCapturing={true}
        captureLabel="target"
      />,
    );
    fireEvent.click(screen.getByText("Stop"));
    expect(defaultProps.onCaptureStop).toHaveBeenCalled();
  });

  it("should disable buttons when device is not connected", () => {
    render(
      <ClassificationControls {...defaultProps} isDeviceConnected={false} />,
    );
    const targetBtn = screen.getByText("Target");
    const noiseBtn = screen.getByText("Noise");
    expect(targetBtn).toBeDisabled();
    expect(noiseBtn).toBeDisabled();
  });

  it("should show capturing status when active", () => {
    render(
      <ClassificationControls
        {...defaultProps}
        isCapturing={true}
        captureLabel="target"
      />,
    );
    expect(screen.getByText(/target/)).toBeInTheDocument();
  });
});
