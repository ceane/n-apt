import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { StimulusNode } from "@n-apt/components/react-flow/nodes/StimulusNode";
import { TestWrapper } from "./testUtils";

// Mock the useDemod hook
jest.mock("@n-apt/contexts/DemodContext", () => ({
  useDemod: () => ({
    analysisSession: { state: 'idle', type: 'audio', startTime: null },
    selectedBaseline: 'audio',
    setSelectedBaseline: jest.fn(),
    liveMode: false,
    setLiveMode: jest.fn(),
    startAnalysis: jest.fn(),
    clearAnalysis: jest.fn(),
  }),
}));

describe("StimulusNode", () => {
  const defaultProps = {
    data: {
      label: "Stimulus",
      stimulusOptions: true,
      subtext: "Test subtext",
    },
  };

  it("renders with default props", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Stimulus")).toBeInTheDocument();
    expect(screen.getByText("Test subtext")).toBeInTheDocument();
  });

  it("renders audio preview mode", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("440Hz SINE TONE")).toBeInTheDocument();
  });

  it("renders baseline vector select", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>
    );

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("audio");
  });

  it("renders duration input", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>
    );

    const input = screen.getByDisplayValue("5");
    expect(input).toBeInTheDocument();
  });

  it("renders trigger button", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>
    );

    const button = screen.getByText("TRIGGER");
    expect(button).toBeInTheDocument();
  });

  it("renders live capture checkbox", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>
    );

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("renders default subtext when not provided", () => {
    render(
      <TestWrapper>
        <StimulusNode data={{ label: "Stimulus", stimulusOptions: true }} />
      </TestWrapper>
    );

    expect(screen.getByText(/Capture N-APT signals/)).toBeInTheDocument();
  });
});
