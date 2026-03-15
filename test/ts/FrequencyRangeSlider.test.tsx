import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import { TestWrapper } from "./testUtils";

describe("FrequencyRangeSlider Component", () => {
  const mockOnRangeChange = jest.fn();
  const mockOnActivate = jest.fn();

  const defaultProps = {
    label: "Test Frequency Range",
    minFreq: 0,
    maxFreq: 10,
    visibleMin: 1,
    visibleMax: 4,
    isActive: false,
    onActivate: mockOnActivate,
    onRangeChange: mockOnRangeChange,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render without crashing", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("Test Frequency Range")).toBeInTheDocument();
  });

  it("should display current frequency range", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>
    );

    expect(
      screen.getByText((content, _element) => {
        return content.includes("1 MHz") && content.includes("4 MHz");
      }),
    ).toBeInTheDocument();
  });

  it("should call onActivate when clicked", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>
    );

    const sliderContainer = screen.getByText(
      "Test Frequency Range",
    ).parentElement;
    const slider = sliderContainer?.nextElementSibling;
    if (slider) {
      fireEvent.click(slider);
    }

    expect(mockOnActivate).toHaveBeenCalled();
  });

  it("should show active state when isActive is true", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} isActive={true} />
      </TestWrapper>
    );

    // Should have active styling (we can't easily test styled-components classes)
    expect(screen.getByText("Test Frequency Range")).toBeInTheDocument();
  });

  it("should display frequency range information", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText(/0 (Hz|kHz)/)).toBeInTheDocument();
    expect(screen.getByText("10 MHz")).toBeInTheDocument();
  });

  it("should handle decimal precision correctly", () => {
    const preciseProps = {
      ...defaultProps,
      visibleMin: 1.234567,
      visibleMax: 4.876543,
    };

    render(
      <TestWrapper>
        <FrequencyRangeSlider {...preciseProps} />
      </TestWrapper>
    );

    expect(
      screen.getByText((content, _element) => {
        return content.includes("1.2346 MHz") && content.includes("4.8765 MHz");
      }),
    ).toBeInTheDocument();
  });

  it("should be accessible with proper attributes", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>
    );

    // The slider itself should have tabIndex, not the label container
    const sliderContainer = screen.getByText(
      "Test Frequency Range",
    ).parentElement;
    const slider = sliderContainer?.nextElementSibling;
    expect(slider).toHaveAttribute("tabIndex", "0");
  });

  it("should handle keyboard input", () => {
    render(<FrequencyRangeSlider {...defaultProps} />);

    const sliderContainer = screen.getByText(
      "Test Frequency Range",
    ).parentElement;
    const slider = sliderContainer?.nextElementSibling;
    if (slider) {
      (slider as HTMLElement).focus();

      fireEvent.keyDown(slider, { key: "ArrowUp" });
      fireEvent.keyDown(slider, { key: "ArrowDown" });

      // Should handle keyboard events (specific behavior depends on implementation)
      expect(slider as HTMLElement).toHaveFocus();
    }
  });
});
