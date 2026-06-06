import React from "react";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
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
      </TestWrapper>,
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
      </TestWrapper>,
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
      </TestWrapper>,
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
      const lastCall =
        onRangeChange.mock.calls[onRangeChange.mock.calls.length - 1][0];
      expect(lastCall.min).toBeGreaterThan(120);
      expect(lastCall.max).toBeGreaterThan(150);
    }
  });

  test("responds to keyboard arrows when active", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
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
        <FrequencyRangeSlider
          {...defaultProps}
          readOnly={true}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
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

  test("respects disabled mode without allowing drag interaction", () => {
    const onRangeChange = jest.fn();
    const onActivate = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          disabled={true}
          onActivate={onActivate}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );

    const sliderWrapper = screen.getByText("A").parentElement?.parentElement;
    if (sliderWrapper) {
      expect(sliderWrapper).toHaveStyle({ opacity: "0.5" });
    }

    const slider = screen.getByText("A").closest("div")?.nextElementSibling;
    if (slider) {
      fireEvent.click(slider);
    }

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    if (thumb) {
      fireEvent.mouseDown(thumb, { clientX: 100 });
      fireEvent.mouseMove(window, { clientX: 150 });
      fireEvent.mouseUp(window);
    }

    expect(onActivate).toHaveBeenCalled();
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  test("caps wide sample-rate windows to the channel track and channel labels", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          minFreq={18_000}
          maxFreq={4_390_000}
          visibleMin={18_000}
          visibleMax={20_018_000}
          sampleRateHz={300_000}
          allowWideSampleRateOverscan={true}
        />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/18kHz.*-.*318kHz/).parentElement;
    expect(thumb).toBeInTheDocument();
    expect(screen.queryByText(/20\.018MHz/)).not.toBeInTheDocument();
  });

  test("fills the channel when sample rate is larger than the channel span", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          minFreq={18_000}
          maxFreq={4_390_000}
          visibleMin={18_000}
          visibleMax={20_018_000}
          sampleRateHz={20_000_000}
          allowWideSampleRateOverscan={true}
        />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/18kHz.*-.*4\.39MHz/).parentElement;
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveStyle({ width: "100%" });
  });

  test("uses frequency ratio for Channel A hardware window width instead of label width", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          minFreq={18_000}
          maxFreq={4_390_000}
          visibleMin={604_000}
          visibleMax={3_804_000}
          sampleRateHz={3_200_000}
        />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/604kHz.*-.*3\.804MHz/).parentElement;
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveStyle({ width: "73.19304666056725%" });
  });

  test("keeps min-content label width visual-only so narrow windows do not rewrite the frequency span", async () => {
    const originalScrollWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return 180;
      },
    });

    try {
      render(
        <TestWrapper>
          <FrequencyRangeSlider
            {...defaultProps}
            minFreq={4_750_000}
            maxFreq={23_000_000}
            visibleMin={11_688_000}
            visibleMax={16_061_000}
            sampleRateHz={4_373_000}
          />
        </TestWrapper>,
      );

      const thumb = screen.getByText(/11\.688MHz.*-.*16\.061MHz/).parentElement;
      expect(thumb).toBeInTheDocument();
      expect(thumb).toHaveStyle({ width: "23.96164383561644%" });
      await waitFor(() => {
        expect(thumb).toHaveStyle({ minWidth: "196px", maxWidth: "100%" });
      });
    } finally {
      if (originalScrollWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollWidth",
          originalScrollWidth,
        );
      } else {
        delete (HTMLElement.prototype as any).scrollWidth;
      }
    }
  });
});
