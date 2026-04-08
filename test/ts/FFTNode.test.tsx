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
      </TestWrapper>
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders FFT description", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("📊 FFT Transform")).toBeInTheDocument();
  });

  it("renders node-title class", () => {
    const { container } = render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>
    );

    const titleElement = container.querySelector(".node-title");
    expect(titleElement).toBeInTheDocument();
  });

  it("renders node-description class", () => {
    const { container } = render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>
    );

    const descriptionElement = container.querySelector(".node-description");
    expect(descriptionElement).toBeInTheDocument();
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
      </TestWrapper>
    );

    expect(screen.getByText("Custom FFT")).toBeInTheDocument();
  });
});
