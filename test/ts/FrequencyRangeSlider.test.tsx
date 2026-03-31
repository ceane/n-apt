import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import FrequencyRangeSlider from "../../src/ts/components/sidebar/FrequencyRangeSlider";
import { TestWrapper } from "./testUtils";

describe("FrequencyRangeSlider", () => {
  const defaultProps = {
    label: "A",
    minFreq: 100,
    maxFreq: 200,
    visibleMin: 120,
    visibleMax: 150,
    isActive: true,
    onActivate: jest.fn(),
    onRangeChange: jest.fn(),
  };

  test("renders with correct labels and frequency range", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    // Frequency formatting: 100 -> 100.0000 MHz, 200 -> 200.0000 MHz (based on formatFrequency)
    expect(screen.getByText(/100/)).toBeInTheDocument();
    expect(screen.getByText(/200/)).toBeInTheDocument();
    // Window label: "120 MHz - 150 MHz"
    expect(screen.getByText(/120.*-.*150/)).toBeInTheDocument();
  });

  test("calls onActivate when clicked", () => {
    const onActivate = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onActivate={onActivate} />
      </TestWrapper>
    );

    const container = screen.getByText("A").closest("div")?.nextElementSibling; // SliderContainer follows label
    if (container) fireEvent.click(container);
    expect(onActivate).toHaveBeenCalled();
  });

  test("handles drag interaction", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>
    );

    // The component uses window mousemove/mouseup listeners
    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    expect(thumb).toBeInTheDocument();

    if (thumb) {
      // Start drag
      fireEvent.mouseDown(thumb, { clientX: 100 });
      
      // Move 50 pixels to the right
      fireEvent.mouseMove(window, { clientX: 150 });
      
      // End drag
      fireEvent.mouseUp(window);
      
      expect(onRangeChange).toHaveBeenCalled();
      const lastCall = onRangeChange.mock.calls[onRangeChange.mock.calls.length - 1][0];
      expect(lastCall.min).toBeGreaterThan(120);
      expect(lastCall.max).toBeGreaterThan(150);
    }
  });

  test("responds to keyboard arrows when active", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>
    );

    // Trigger keyboard event on window
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onRangeChange).toHaveBeenCalled();
    
    const rangeAfterUp = onRangeChange.mock.calls[0][0];
    expect(rangeAfterUp.min).toBeGreaterThan(120);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    const rangeAfterDown = onRangeChange.mock.calls[1][0];
    expect(rangeAfterDown.min).toBeLessThan(rangeAfterUp.min);
  });

  test("respects readOnly mode", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} readOnly={true} onRangeChange={onRangeChange} />
      </TestWrapper>
    );

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    if (thumb) {
      fireEvent.mouseDown(thumb, { clientX: 100 });
      fireEvent.mouseMove(window, { clientX: 150 });
      fireEvent.mouseUp(window);
    }

    // Should not call onRangeChange because drag is disabled in readOnly
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
