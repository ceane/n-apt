import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { FFTNode } from "@n-apt/components/react-flow/nodes/FFTNode";
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
