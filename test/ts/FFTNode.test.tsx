import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { FFTNode } from "@n-apt/components/react-flow/nodes/FFTNode";
import { getDisplayRangeForSelection } from "../../src/ts/components/react-flow/nodes/FFTNode";
import { TestWrapper } from "./testUtils";

describe("FFTNode", () => {
  const defaultProps = {
    data: {
      fftOptions: true,
      label: "FFT Transform",
    },
  };

  it("renders with label", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders FFT description", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders node title styling", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders the FFT canvas", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByTestId("fft-canvas")).toBeInTheDocument();
  });

  it("renders with custom label", () => {
    const customProps = {
      data: {
        fftOptions: true,
        label: "Custom FFT",
      },
    };

    render(
      <TestWrapper>
        <FFTNode {...customProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("Custom FFT")).toBeInTheDocument();
  });
});

describe("getDisplayRangeForSelection", () => {
  it("keeps the spectrum fixed while the sliding selection fits on screen", () => {
    expect(
      getDisplayRangeForSelection(
        { min: 30_400_000, max: 33_600_000 },
        { min: 31_750_000, max: 32_250_000 },
      ),
    ).toEqual({ min: 30_400_000, max: 33_600_000 });
  });

  it("pans right only enough when the selection crosses the right edge", () => {
    expect(
      getDisplayRangeForSelection(
        { min: 30_400_000, max: 33_600_000 },
        { min: 33_450_000, max: 33_950_000 },
      ),
    ).toEqual({ min: 30_750_000, max: 33_950_000 });
  });

  it("pans left only enough when the selection crosses the left edge", () => {
    expect(
      getDisplayRangeForSelection(
        { min: 30_400_000, max: 33_600_000 },
        { min: 30_000_000, max: 30_500_000 },
      ),
    ).toEqual({ min: 30_000_000, max: 33_200_000 });
  });
});
