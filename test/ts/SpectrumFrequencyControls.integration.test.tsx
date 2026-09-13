/** @jest-environment jsdom */
import React, { act, useMemo, useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { FrequencyRange, LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";
import FrequencyRangeSlider from "@n-apt/spectrum/sidebar/FrequencyRangeSlider";
import { publishFrequencyRangeImmediately } from "@n-apt/app/routes/pages/SpectrumRoute";
import { createFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { TestWrapper } from "./testUtils";

const SOURCE_ID = "rtl-sdr-v4";
const INITIAL_RANGE: FrequencyRange = {
  min: 1_000_000,
  max: 4_200_000,
};

const makeBackendFrame = (
  sequence: number,
  centerFrequencyHz: number,
): LiveFrameData => ({
  type: "spectrum",
  protocol_version: 2,
  source_id: SOURCE_ID,
  stream_epoch: 11,
  sequence,
  frame_status: "receiving",
  data_type: "iq_raw",
  center_frequency_hz: centerFrequencyHz,
  sample_rate: INITIAL_RANGE.max - INITIAL_RANGE.min,
  iq_data: new Uint8Array([128, 129, 127, 130, 128, 126]),
});

type HarnessProps = {
  frame: LiveFrameData | null;
  sendFrequencyRange: (range: FrequencyRange) => void;
  renderCount: React.MutableRefObject<number>;
};

const LiveSpectrumFrequencyHarness: React.FC<HarnessProps> = ({
  frame,
  sendFrequencyRange,
  renderCount,
}) => {
  renderCount.current += 1;
  const [range, setRange] = useState<FrequencyRange>(INITIAL_RANGE);
  const [centerFrequencyHz, setCenterFrequencyHz] = useState(2_600_000);
  const [isEditingCenter, setIsEditingCenter] = useState(false);
  const frameRuntime = useMemo(
    () => createFrameRuntime<LiveFrameData>({ current: null }),
    [],
  );
  const latestFrameRef = useRef(frameRuntime.ref);
  latestFrameRef.current.current = frame;

  const publishRange = (nextRange: FrequencyRange) => {
    publishFrequencyRangeImmediately(nextRange, setRange, sendFrequencyRange);
  };

  const scrollSpectrum = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const shiftHz = event.deltaY < 0 ? 100_000 : -100_000;
    const span = range.max - range.min;
    const nextMin = Math.max(0, range.min + shiftHz);
    publishRange({ min: nextMin, max: nextMin + span });
  };

  return (
    <div>
      <output data-testid="backend-frame">
        {latestFrameRef.current.current
          ? `${latestFrameRef.current.current.source_id}:${latestFrameRef.current.current.sequence}:${latestFrameRef.current.current.frame_status}`
          : "waiting"}
      </output>
      <output data-testid="frequency-range">
        {range.min}:{range.max}
      </output>
      <output data-testid="center-frequency">{centerFrequencyHz}</output>
      <Vfo
        visualState="compact"
        drawingType="dom"
        orientation="bottom"
        frequencyRange={range}
        centerFrequencyHz={centerFrequencyHz}
        onWheel={scrollSpectrum}
        onDoubleClick={() => setIsEditingCenter(true)}
      />
      <FrequencyRangeSlider
        label="A"
        minFreq={0}
        maxFreq={10_000_000}
        visibleMin={range.min}
        visibleMax={range.max}
        sampleRateHz={range.max - range.min}
        isActive
        onActivate={() => {}}
        onRangeChange={publishRange}
      />
      {isEditingCenter ? (
        <EditableCenterFrequency
          centerFrequencyHz={centerFrequencyHz}
          onCenterFrequencyChange={(nextCenter) => {
            const span = range.max - range.min;
            const nextRange = {
              min: nextCenter - span / 2,
              max: nextCenter + span / 2,
            };
            setCenterFrequencyHz(nextCenter);
            publishRange(nextRange);
          }}
          onClose={() => setIsEditingCenter(false)}
        />
      ) : null}
    </div>
  );
};

describe("live spectrum frequency controls", () => {
  it("streams backend frames while scroll, slider, and center-frequency jumps stay bounded", () => {
    const sendFrequencyRange = jest.fn();
    const renderCount = { current: 0 };
    const initialFrame = makeBackendFrame(1, 2_600_000);
    const view = render(
      <TestWrapper>
        <LiveSpectrumFrequencyHarness
          frame={initialFrame}
          sendFrequencyRange={sendFrequencyRange}
          renderCount={renderCount}
        />
      </TestWrapper>,
    );

    expect(screen.getByTestId("backend-frame")).toHaveTextContent(
      `${SOURCE_ID}:1:receiving`,
    );

    act(() => {
      fireEvent.wheel(screen.getByTestId("unified-vfo"), { deltaY: -1 });
    });
    expect(screen.getByTestId("frequency-range")).toHaveTextContent(
      "1100000:4300000",
    );
    expect(sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 1_100_000,
      max: 4_300_000,
    });

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowUp" });
    });
    expect(sendFrequencyRange).toHaveBeenCalled();

    act(() => {
      fireEvent.doubleClick(screen.getByTestId("unified-vfo"));
    });
    const centerInput = screen.getByRole("textbox");
    fireEvent.change(centerInput, { target: { value: "3.000" } });
    act(() => {
      fireEvent.keyDown(centerInput, { key: "Enter" });
    });
    expect(screen.getByTestId("center-frequency")).toHaveTextContent(
      "3000000",
    );
    expect(sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 1_400_000,
      max: 4_600_000,
    });

    act(() => {
      for (let sequence = 2; sequence <= 8; sequence += 1) {
        view.rerender(
          <TestWrapper>
            <LiveSpectrumFrequencyHarness
              frame={makeBackendFrame(sequence, 3_000_000)}
              sendFrequencyRange={sendFrequencyRange}
              renderCount={renderCount}
            />
          </TestWrapper>,
        );
      }
    });
    expect(screen.getByTestId("backend-frame")).toHaveTextContent(
      `${SOURCE_ID}:8:receiving`,
    );
    expect(renderCount.current).toBeLessThanOrEqual(30);
  });
});
