import React from "react";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import FrequencyRangeSlider from "@n-apt/spectrum/sidebar/FrequencyRangeSlider";
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

  test("calls onActivate when an inactive slider is clicked", () => {
    const onActivate = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          isActive={false}
          onActivate={onActivate}
        />
      </TestWrapper>,
    );

    const container = screen.getByText("A").closest("div")?.nextElementSibling;
    if (container) fireEvent.click(container);
    expect(onActivate).toHaveBeenCalled();
  });

  test("moves the window to the clicked track frequency immediately", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
    );

    const track = document.querySelector(".range-track") as HTMLElement;
    Object.defineProperty(track, "clientWidth", {
      configurable: true,
      value: 400,
    });
    jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 400,
      width: 400,
      top: 0,
      bottom: 40,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseDown(track, { clientX: 300 });

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const selected = onRangeChange.mock.calls[0][0];
    expect(selected.min).toBeCloseTo(160, 5);
    expect(selected.max).toBeCloseTo(190, 5);
  });

  test("does not call onActivate when the slider is already active", () => {
    const onActivate = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          isActive={true}
          onActivate={onActivate}
        />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    fireEvent.mouseDown(thumb as HTMLElement, { clientX: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(thumb as HTMLElement);

    expect(onActivate).not.toHaveBeenCalled();
  });

  test("does not republish on a click that never dragged", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    fireEvent.mouseDown(thumb as HTMLElement, { clientX: 100 });
    fireEvent.mouseUp(window);

    expect(onRangeChange).not.toHaveBeenCalled();
  });

  test("does not republish the whole channel when clicking after the window shrinks to the sample rate", () => {
    const onRangeChange = jest.fn();
    const { rerender } = render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          minFreq={18_000}
          maxFreq={4_390_000}
          visibleMin={18_000}
          visibleMax={4_390_000}
          sampleRateHz={4_372_000}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );

    rerender(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          minFreq={18_000}
          maxFreq={4_390_000}
          visibleMin={18_000}
          visibleMax={3_218_000}
          sampleRateHz={3_200_000}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );
    onRangeChange.mockClear();

    const thumb = screen.getByText(/18kHz.*-.*3\.218MHz/).parentElement;
    fireEvent.mouseDown(thumb as HTMLElement, { clientX: 100 });
    fireEvent.mouseUp(window);

    expect(onRangeChange).not.toHaveBeenCalled();
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

  test("does not throw when an external zoom shrinks the visible window", () => {
    const { rerender } = render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} />
      </TestWrapper>,
    );

    expect(() => {
      rerender(
        <TestWrapper>
          <FrequencyRangeSlider
            {...defaultProps}
            visibleMin={134.8}
            visibleMax={135.2}
          />
        </TestWrapper>,
      );
    }).not.toThrow();
    expect(screen.getByText(/135Hz.*-.*135Hz/)).toBeInTheDocument();
  });

  test("publishes the range immediately on every accepted drag move", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    fireEvent.mouseDown(thumb as HTMLElement, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const firstRange = onRangeChange.mock.calls[0][0];
    expect(firstRange.min).toBeGreaterThan(120);

    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 250 });

    expect(onRangeChange.mock.calls.length).toBeGreaterThan(1);
  });

  test("wheel pans the visible window immediately without a debounce timer", () => {
    jest.useFakeTimers();
    const raf = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        return setTimeout(() => cb(0), 0) as unknown as number;
      });
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
    );

    const track = document.querySelector(".range-track") as HTMLElement;
    expect(track).toBeInTheDocument();
    Object.defineProperty(track, "clientWidth", {
      configurable: true,
      value: 400,
    });

    fireEvent.wheel(track, { deltaY: 20, deltaX: 0 });
    fireEvent.wheel(track, { deltaY: 20, deltaX: 0 });

    expect(screen.queryByText(/120.*-.*150/)).not.toBeInTheDocument();
    expect(screen.getByText(/148.*-.*178/)).toBeInTheDocument();
    expect(onRangeChange).toHaveBeenCalledTimes(2);
    expect(onRangeChange.mock.calls[1][0].min).toBeGreaterThan(120);

    raf.mockRestore();
    jest.useRealTimers();
  });

  test("publishes the final drag range once when transmit state is also updating", () => {
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    expect(thumb).toBeInTheDocument();

    fireEvent.mouseDown(thumb as HTMLElement, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
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

  test("moves the thumb from external state without publishing", () => {
    const onRangeChange = jest.fn();
    const { rerender } = render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
    );
    expect(screen.getByText(/120.*-.*150/)).toBeInTheDocument();

    // An external tune (e.g. a websocket channels echo) re-anchors the visible
    // window. This is a passive highlight update: it must not dispatch a range.
    rerender(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          visibleMin={130}
          visibleMax={160}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );

    expect(screen.getByText(/130.*-.*160/)).toBeInTheDocument();
    expect(screen.queryByText(/120.*-.*150/)).not.toBeInTheDocument();
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  test("external changes do not fight an active drag", () => {
    const onRangeChange = jest.fn();
    const { rerender } = render(
      <TestWrapper>
        <FrequencyRangeSlider {...defaultProps} onRangeChange={onRangeChange} />
      </TestWrapper>,
    );

    const thumb = screen.getByText(/120.*-.*150/).parentElement;
    fireEvent.mouseDown(thumb as HTMLElement, { clientX: 100 });

    // An external range update arrives mid-drag. The in-progress drag must not
    // snap the thumb back to the external value.
    rerender(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          visibleMin={140}
          visibleMax={170}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );

    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const published = onRangeChange.mock.calls[0][0] as { min: number };
    // The published range reflects the drag from the original start (100 -> 150),
    // not the external 140 re-anchor.
    expect(published.min).toBeGreaterThan(120);
    expect(published.min).toBeLessThan(140);
  });

  test("readOnly sliders still activate on container click", () => {
    const onActivate = jest.fn();
    const onRangeChange = jest.fn();
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          isActive={false}
          readOnly={true}
          onActivate={onActivate}
          onRangeChange={onRangeChange}
        />
      </TestWrapper>,
    );

    const container = screen.getByText("A").closest("div")?.nextElementSibling;
    fireEvent.click(container as HTMLElement);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  test("readOnly sliders remain visually enabled while disabling drag", () => {
    render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          readOnly={true}
          onRangeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const sliderWrapper = screen.getByText("A").parentElement?.parentElement;
    if (sliderWrapper) {
      expect(sliderWrapper).toHaveStyle({ opacity: "1" });
    }
  });

  test("readOnly sliders do not install global interaction listeners", () => {
    const addEventListener = jest.spyOn(window, "addEventListener");
    const removeEventListener = jest.spyOn(window, "removeEventListener");

    const { unmount } = render(
      <TestWrapper>
        <FrequencyRangeSlider
          {...defaultProps}
          readOnly={true}
          onRangeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      addEventListener.mock.calls.some(([event]) =>
        ["keydown", "mousemove", "mouseup"].includes(String(event)),
      ),
    ).toBe(false);

    unmount();
    expect(
      removeEventListener.mock.calls.some(([event]) =>
        ["keydown", "mousemove", "mouseup"].includes(String(event)),
      ),
    ).toBe(false);
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

    expect(onActivate).not.toHaveBeenCalled();
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
