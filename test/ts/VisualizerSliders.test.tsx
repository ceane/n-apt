import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VisualizerSliders } from "@n-apt/components/VisualizerSliders";
import { ThemeProvider } from "styled-components";

const mockTheme = {
  primary: "#00d4ff",
  background: "#0a0a0a",
  text: "#ffffff",
};

describe("VisualizerSliders Component", () => {
  const defaultProps = {
    zoom: 1,
    dbMax: 0,
    dbMin: -120,
    onZoomChange: jest.fn(),
    onDbMaxChange: jest.fn(),
    onDbMinChange: jest.fn(),
    onFftAvgChange: jest.fn(),
    onFftSmoothChange: jest.fn(),
    onWfSmoothChange: jest.fn(),
    onResetZoomDb: jest.fn(),
  };

  it("should render all sliders and toggles", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <VisualizerSliders {...defaultProps} />
      </ThemeProvider>
    );

    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.getByText("RESET")).toBeInTheDocument();
    expect(screen.getByText(/AVG/)).toBeInTheDocument();
    expect(screen.getByText(/FFT/)).toBeInTheDocument();
    expect(screen.getByText(/WF/)).toBeInTheDocument();
  });

  it("should call onResetZoomDb when RESET is clicked", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <VisualizerSliders {...defaultProps} />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText("RESET"));
    expect(defaultProps.onResetZoomDb).toHaveBeenCalled();
  });

  it("should call toggle handlers when toggles are clicked", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <VisualizerSliders {...defaultProps} />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText(/AVG/));
    expect(defaultProps.onFftAvgChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText(/FFT/));
    expect(defaultProps.onFftSmoothChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText(/WF/));
    expect(defaultProps.onWfSmoothChange).toHaveBeenCalledWith(true);
  });

  it("should show active state for toggles", () => {
    const activeProps = {
      ...defaultProps,
      fftAvgEnabled: true,
      fftSmoothEnabled: true,
      wfSmoothEnabled: true,
    };

    render(
      <ThemeProvider theme={mockTheme}>
        <VisualizerSliders {...activeProps} />
      </ThemeProvider>
    );

    expect(screen.getByText("▸ AVG")).toBeInTheDocument();
    expect(screen.getByText("▸ FFT")).toBeInTheDocument();
    expect(screen.getByText("▸ WF")).toBeInTheDocument();
  });
});
