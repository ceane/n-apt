import fc from "fast-check";
import { act, renderHook } from "@testing-library/react";
import {
  buildLiveSampleRateRange,
  canUseWholeChannelSampleRate,
  resolveHackrfBasebandSampleRateHz,
  useLiveSampleRateControl,
} from "@n-apt/spectrum/hooks/useLiveSampleRateControl";

describe("resolveHackrfBasebandSampleRateHz", () => {
  it("uses the active Whole Channel rate instead of the stale local rate", () => {
    expect(
      resolveHackrfBasebandSampleRateHz({
        isHackrfOne: true,
        sourceMode: "live",
        isWholeChannelMode: true,
        wholeChannelSampleRate: 4_372_000,
        sampleRateHz: 3_200_000,
      }),
    ).toBe(4_372_000);
  });

  it("preserves the local rate when Whole Channel is not active", () => {
    expect(
      resolveHackrfBasebandSampleRateHz({
        isHackrfOne: true,
        sourceMode: "live",
        isWholeChannelMode: false,
        wholeChannelSampleRate: 4_372_000,
        sampleRateHz: 4_000_000,
      }),
    ).toBe(4_000_000);
  });
});

describe("useLiveSampleRateControl", () => {
  it("derives the Whole Channel sample rate from the clicked range edges", () => {
    const setSampleRateWithFrequencyRange = jest.fn();
    const applyFrequencyRange = jest.fn();
    const clickedChannelRange = { min: 4_750_000, max: 23_000_000 };

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        // B's stale rate is still visible when C is clicked.
        activeChannelSampleRate: 6_270_000,
        activeSignalAreaBounds: { min: 24_100_000, max: 30_370_000 },
        frequencyRange: { min: 24_100_000, max: 30_370_000 },
        sampleRateHz: 6_270_000,
        setSampleRate: jest.fn(),
        setSampleRateWithFrequencyRange,
        applyFrequencyRange,
      }),
    );

    act(() => {
      result.current.handleSampleRateChange(
        6_270_000,
        "whole",
        clickedChannelRange,
      );
    });

    expect(setSampleRateWithFrequencyRange).toHaveBeenCalledWith(
      18_250_000,
      clickedChannelRange,
    );
    expect(applyFrequencyRange).toHaveBeenCalledWith(clickedChannelRange);
  });

  it("fuzzes Whole Channel clicks so stale channel rates cannot survive", () => {
    const setSampleRateWithFrequencyRange = jest.fn();
    const applyFrequencyRange = jest.fn();
    const staleSampleRateHz = 6_270_000;

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: staleSampleRateHz,
        activeSignalAreaBounds: { min: 24_100_000, max: 30_370_000 },
        frequencyRange: { min: 24_100_000, max: 30_370_000 },
        sampleRateHz: staleSampleRateHz,
        setSampleRate: jest.fn(),
        setSampleRateWithFrequencyRange,
        applyFrequencyRange,
      }),
    );

    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 200_000_000 }),
        fc.integer({ min: 100_000, max: 30_000_000 }),
        (min, span) => {
          const clickedChannelRange = { min, max: min + span };
          act(() => {
            result.current.handleSampleRateChange(
              staleSampleRateHz,
              "whole",
              clickedChannelRange,
            );
          });

          const [sampleRateHz, range] =
            setSampleRateWithFrequencyRange.mock.calls[
              setSampleRateWithFrequencyRange.mock.calls.length - 1
            ] ?? [];
          expect(sampleRateHz).toBe(span);
          expect(range).toEqual(clickedChannelRange);
          expect(range.max - range.min).toBe(sampleRateHz);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("uses an explicit channel-focus range when a channel click changes Whole Channel", () => {
    const setSampleRateWithFrequencyRange = jest.fn();
    const applyFrequencyRange = jest.fn();

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 4_372_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        // This is the stale range that must not win over the click target.
        frequencyRange: { min: 196_000_000, max: 201_000_000 },
        sampleRateHz: 4_372_000,
        setSampleRate: jest.fn(),
        setSampleRateWithFrequencyRange,
        applyFrequencyRange,
      }),
    );

    act(() => {
      (result.current.handleSampleRateChange as (...args: any[]) => void)(
        18_250_000,
        "whole",
        { min: 4_750_000, max: 23_000_000 },
      );
    });

    expect(setSampleRateWithFrequencyRange).toHaveBeenCalledWith(
      18_250_000,
      { min: 4_750_000, max: 23_000_000 },
    );
    expect(applyFrequencyRange).toHaveBeenCalledWith({
      min: 4_750_000,
      max: 23_000_000,
    });
  });

  it("repairs Whole Channel edges even when a stale range has the same span", () => {
    const applyFrequencyRange = jest.fn();
    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 6_270_000,
      activeSignalAreaBounds: { min: 24_100_000, max: 30_370_000 },
      frequencyRange: { min: 24_100_000, max: 30_370_000 },
      sampleRateHz: 6_270_000,
      setSampleRate: jest.fn(),
      applyFrequencyRange,
    };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    act(() => {
      result.current.handleSampleRateChange(
        6_270_000,
        "whole",
        { min: 4_750_000, max: 23_000_000 },
      );
    });
    applyFrequencyRange.mockClear();

    rerender({
      ...initialProps,
      activeChannelSampleRate: 18_250_000,
      activeSignalAreaBounds: { min: 4_750_000, max: 23_000_000 },
      frequencyRange: { min: 8_000_000, max: 26_250_000 },
      sampleRateHz: 18_250_000,
    });

    expect(applyFrequencyRange).toHaveBeenCalledWith({
      min: 4_750_000,
      max: 23_000_000,
    });
  });

  it("notifies dependent controls whenever the sample rate is applied", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();
    const onSampleRateApplied = jest.fn();

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 4_372_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        frequencyRange: { min: 18_000, max: 4_390_000 },
        sampleRateHz: 4_372_000,
        setSampleRate,
        onSampleRateApplied,
        applyFrequencyRange,
      }),
    );

    act(() => {
      result.current.handleSampleRateChange(4_000_000);
    });

    expect(onSampleRateApplied).toHaveBeenLastCalledWith(4_000_000);
  });

  it("notifies dependent controls once when Whole Channel is already selected", () => {
    const onSampleRateApplied = jest.fn();

    renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 4_372_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        frequencyRange: { min: 18_000, max: 4_390_000 },
        sampleRateHz: 4_372_000,
        setSampleRate: jest.fn(),
        onSampleRateApplied,
        applyFrequencyRange: jest.fn(),
      }),
    );

    expect(onSampleRateApplied).toHaveBeenCalledTimes(1);
    expect(onSampleRateApplied).toHaveBeenCalledWith(4_372_000);
  });

  it("does not expose Whole Channel when the channel exceeds the source maximum", () => {
    expect(
      canUseWholeChannelSampleRate({
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 4_372_000,
        maxSampleRateHz: 3_200_000,
      }),
    ).toBe(false);
  });

  it("exposes Mock APT Whole Channel when the source ceiling is the channel span", () => {
    expect(
      canUseWholeChannelSampleRate({
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 4_372_000,
        maxSampleRateHz: 4_372_000,
      }),
    ).toBe(true);
  });

  it("keeps a valid source rate stable across a paused-to-playing channel update", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();
    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      manualSampleRateOptions: [3_200_000],
      activeChannelSampleRate: 4_372_000,
      maxSampleRateHz: 3_200_000,
      activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
      frequencyRange: { min: 18_000, max: 3_218_000 },
      sampleRateHz: 3_200_000,
      setSampleRate,
      applyFrequencyRange,
    };

    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    rerender({
      ...initialProps,
      frequencyRange: { min: 18_000, max: 4_390_000 },
    });

    expect(result.current.wholeChannelSampleRate).toBeNull();
    expect(setSampleRate).not.toHaveBeenCalledWith(4_372_000);
    expect(applyFrequencyRange).not.toHaveBeenCalledWith({
      min: 18_000,
      max: 4_390_000,
    });
  });

  it("keeps manual HackRF sample-rate changes sticky across repeated updates", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 5_200_000,
      activeSignalAreaBounds: { min: 24_720_000, max: 29_920_000 },
      frequencyRange: { min: 24_720_000, max: 29_920_000 },
      sampleRateHz: 5_200_000,
      setSampleRate,
      applyFrequencyRange,
    };

    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    expect(result.current.wholeChannelSampleRate).toBe(5_200_000);

    act(() => {
      result.current.handleSampleRateChange(12_800_000);
    });

    expect(setSampleRate).toHaveBeenLastCalledWith(12_800_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 20_920_000,
      max: 33_720_000,
    });

    rerender({ ...initialProps, sampleRateHz: 12_800_000 });
    expect(setSampleRate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleSampleRateChange(20_000_000);
    });

    expect(setSampleRate).toHaveBeenLastCalledWith(20_000_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 17_320_000,
      max: 37_320_000,
    });

    rerender({ ...initialProps, sampleRateHz: 20_000_000 });
    expect(setSampleRate).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.handleSampleRateChange(12_800_000);
    });

    expect(setSampleRate).toHaveBeenLastCalledWith(12_800_000);
    expect(setSampleRate).toHaveBeenCalledTimes(3);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 20_920_000,
      max: 33_720_000,
    });
  });

  it("keeps the current center frequency when a manual sample rate changes", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 18_250_000,
        activeSignalAreaBounds: { min: 4_750_000, max: 23_000_000 },
        frequencyRange: { min: 10_000_000, max: 15_200_000 },
        sampleRateHz: 5_200_000,
        setSampleRate,
        applyFrequencyRange,
      }),
    );

    act(() => {
      result.current.handleSampleRateChange(3_200_000, "manual");
    });

    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 11_000_000,
      max: 14_200_000,
    });
  });

  it.each([3_200_000, 4_000_000, 5_000_000])(
    "passes the calculated frequency window with the %s Hz sample rate",
    (nextRate) => {
      const events: string[] = [];
      const setSampleRate = jest.fn();
      const setSampleRateWithFrequencyRange = jest.fn(() =>
        events.push("sample-rate"),
      );
      const applyFrequencyRange = jest.fn(() => events.push("range"));

      const { result } = renderHook(() =>
        useLiveSampleRateControl({
          sourceMode: "live",
          supportsWholeChannelSampleRate: true,
          activeChannelSampleRate: 5_200_000,
          activeSignalAreaBounds: { min: 24_720_000, max: 29_920_000 },
          frequencyRange: { min: 25_420_000, max: 29_420_000 },
          sampleRateHz: 5_200_000,
          setSampleRate,
          setSampleRateWithFrequencyRange,
          applyFrequencyRange,
        }),
      );
      events.length = 0;

      act(() => {
        result.current.handleSampleRateChange(nextRate, "manual");
      });

      const expectedRange = {
        min: 27_420_000 - nextRate / 2,
        max: 27_420_000 + nextRate / 2,
      };
      expect(setSampleRateWithFrequencyRange).toHaveBeenCalledWith(
        nextRate,
        expectedRange,
      );
      expect(applyFrequencyRange).toHaveBeenLastCalledWith(expectedRange);
      expect(events.slice(0, 2)).toEqual(["sample-rate", "range"]);
    },
  );

  it("keeps the current center when Signal Display selects Whole Channel", () => {
    const setSampleRateWithFrequencyRange = jest.fn();
    const applyFrequencyRange = jest.fn();

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 5_200_000,
        activeSignalAreaBounds: { min: 24_720_000, max: 29_920_000 },
        frequencyRange: { min: 25_420_000, max: 29_420_000 },
        sampleRateHz: 5_000_000,
        setSampleRate: jest.fn(),
        setSampleRateWithFrequencyRange,
        applyFrequencyRange,
      }),
    );

    act(() => {
      result.current.handleSampleRateChange(5_200_000, "whole");
    });

    const expectedRange = { min: 24_820_000, max: 30_020_000 };
    expect(setSampleRateWithFrequencyRange).toHaveBeenCalledWith(
      5_200_000,
      expectedRange,
    );
    expect(applyFrequencyRange).toHaveBeenLastCalledWith(expectedRange);
  });

  it("does not clamp a manually positioned center back into the active channel", () => {
    const setSampleRateWithFrequencyRange = jest.fn();
    const applyFrequencyRange = jest.fn();

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 5_200_000,
        activeSignalAreaBounds: { min: 25_370_000, max: 30_370_000 },
        frequencyRange: { min: 194_630_000, max: 198_630_000 },
        sampleRateHz: 4_000_000,
        setSampleRate: jest.fn(),
        setSampleRateWithFrequencyRange,
        applyFrequencyRange,
      }),
    );

    act(() => {
      result.current.handleSampleRateChange(3_200_000, "manual");
    });

    const expectedRange = { min: 195_030_000, max: 198_230_000 };
    expect(setSampleRateWithFrequencyRange).toHaveBeenCalledWith(
      3_200_000,
      expectedRange,
    );
    expect(applyFrequencyRange).toHaveBeenLastCalledWith(expectedRange);
  });

  it("can switch from a wide manual rate back to whole-channel and smaller numeric rates", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 4_372_000,
      activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
      frequencyRange: { min: 18_000, max: 20_018_000 },
      sampleRateHz: 20_000_000,
      setSampleRate,
      applyFrequencyRange,
    };

    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    act(() => {
      result.current.handleSampleRateChange(4_372_000);
    });
    expect(setSampleRate).toHaveBeenLastCalledWith(4_372_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 18_000,
      max: 4_390_000,
    });

    rerender({
      ...initialProps,
      frequencyRange: { min: 18_000, max: 4_390_000 },
      sampleRateHz: 4_372_000,
    });

    act(() => {
      result.current.handleSampleRateChange(4_000_000);
    });
    expect(setSampleRate).toHaveBeenLastCalledWith(4_000_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 204_000,
      max: 4_204_000,
    });

    rerender({
      ...initialProps,
      frequencyRange: { min: 204_000, max: 4_204_000 },
      sampleRateHz: 4_000_000,
    });

    act(() => {
      result.current.handleSampleRateChange(3_200_000);
    });
    expect(setSampleRate).toHaveBeenLastCalledWith(3_200_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 604_000,
      max: 3_804_000,
    });
  });

  it("anchors Channel C to its start when leaving whole-channel even if a valid manual-sized VFO range is present", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 18_250_000,
      activeSignalAreaBounds: { min: 4_750_000, max: 23_000_000 },
      frequencyRange: { min: 10_871_200, max: 14_071_200 },
      sampleRateHz: 18_250_000,
      setSampleRate,
      applyFrequencyRange,
    };

    const { result } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    act(() => {
      result.current.handleSampleRateChange(3_200_000);
    });

    expect(setSampleRate).toHaveBeenLastCalledWith(3_200_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 10_871_200,
      max: 14_071_200,
    });
  });

  it("preserves the acquisition rate when panning changes the active channel", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 4_372_000,
      activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
      frequencyRange: { min: 18_000, max: 4_390_000 },
      sampleRateHz: 4_372_000,
      setSampleRate,
      applyFrequencyRange,
    };

    const { rerender } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    rerender({
      ...initialProps,
      activeChannelSampleRate: 5_200_000,
      activeSignalAreaBounds: { min: 24_720_000, max: 29_920_000 },
      frequencyRange: { min: 24_720_000, max: 29_092_000 },
      sampleRateHz: 4_372_000,
    });

    expect(setSampleRate).not.toHaveBeenCalled();
    expect(applyFrequencyRange).not.toHaveBeenCalled();
  });

  it("treats selecting whole-channel as the active channel span for HackRF One", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();
    const setFftFrameRate = jest.fn();

    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 5_200_000,
      activeSignalAreaBounds: { min: 24_720_000, max: 29_920_000 },
      frequencyRange: { min: 24_720_000, max: 29_920_000 },
      sampleRateHz: 3_200_000,
      fftSize: 131072,
      maxFrameRateLimit: 60,
      setSampleRate,
      setFftFrameRate,
      applyFrequencyRange,
    };

    const { result } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    act(() => {
      result.current.handleSampleRateChange(5_200_000);
    });

    expect(setSampleRate).toHaveBeenCalledWith(5_200_000);
    expect(setFftFrameRate).toHaveBeenCalledWith(39);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 24_720_000,
      max: 29_920_000,
    });
  });

  it("does not expose whole-channel mode when the source does not support it", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const { result } = renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: false,
        activeChannelSampleRate: 4_372_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        frequencyRange: { min: 18_000, max: 4_390_000 },
        sampleRateHz: 4_372_000,
        setSampleRate,
        applyFrequencyRange,
      }),
    );

    expect(result.current.wholeChannelSampleRate).toBeNull();
    expect(setSampleRate).not.toHaveBeenCalled();
    expect(applyFrequencyRange).not.toHaveBeenCalled();
  });

  it("preserves an acquisition rate that is not a manual option until an explicit selection", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        manualSampleRateOptions: [3_200_000],
        activeChannelSampleRate: 4_372_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        frequencyRange: { min: 18_000, max: 18_318_000 },
        sampleRateHz: 18_300_000,
        setSampleRate,
        applyFrequencyRange,
      }),
    );

    expect(setSampleRate).not.toHaveBeenCalled();
    expect(applyFrequencyRange).not.toHaveBeenCalled();
  });

  it("does not reinterpret a valid source-ceiling rate as a channel selection", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        manualSampleRateOptions: [3_200_000, 18_250_000],
        activeChannelSampleRate: 4_372_000,
        maxSampleRateHz: 18_250_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        frequencyRange: { min: 18_000, max: 18_268_000 },
        sampleRateHz: 18_250_000,
        setSampleRate,
        applyFrequencyRange,
      }),
    );

    expect(setSampleRate).not.toHaveBeenCalled();
    expect(applyFrequencyRange).not.toHaveBeenCalled();
  });

  it("does not auto-reset to whole-channel when only the VFO range changes", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: 4_372_000,
      activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
      frequencyRange: { min: 18_000, max: 3_218_000 },
      sampleRateHz: 3_200_000,
      setSampleRate,
      applyFrequencyRange,
    };

    const { rerender } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    rerender({
      ...initialProps,
      frequencyRange: { min: 118_000, max: 3_318_000 },
    });

    expect(setSampleRate).not.toHaveBeenCalledWith(4_372_000);
    expect(applyFrequencyRange).not.toHaveBeenCalled();
  });

  it("resizes a restored live range when it disagrees with the selected sample rate", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 4_372_000,
        activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
        frequencyRange: { min: 18_000, max: 20_018_000 },
        sampleRateHz: 5_000_000,
        setSampleRate,
        applyFrequencyRange,
      }),
    );

    expect(setSampleRate).not.toHaveBeenCalled();
    expect(applyFrequencyRange).toHaveBeenCalledWith({
      min: 7_518_000,
      max: 12_518_000,
    });
  });

  it("does not resize a scrolled VFO range when its span matches the selected sample rate", () => {
    const setSampleRate = jest.fn();
    const applyFrequencyRange = jest.fn();

    renderHook(() =>
      useLiveSampleRateControl({
        sourceMode: "live",
        supportsWholeChannelSampleRate: true,
        activeChannelSampleRate: 18_250_000,
        activeSignalAreaBounds: { min: 4_750_000, max: 23_000_000 },
        frequencyRange: { min: 8_000_000, max: 13_000_000 },
        sampleRateHz: 5_000_000,
        setSampleRate,
        applyFrequencyRange,
      }),
    );

    expect(setSampleRate).not.toHaveBeenCalled();
    expect(applyFrequencyRange).not.toHaveBeenCalled();
  });

  it("anchors stale sample-rate ranges to the channel start by default when smaller than channel bounds", () => {
    expect(
      buildLiveSampleRateRange({
        currentRange: { min: 50, max: 150 },
        sampleRateHz: 50,
        channelBounds: { min: 10, max: 100 },
      }),
    ).toEqual({ min: 10, max: 60 });
  });

  it("supports center and end anchors for stale sample-rate ranges", () => {
    expect(
      buildLiveSampleRateRange({
        currentRange: { min: 50, max: 150 },
        sampleRateHz: 50,
        channelBounds: { min: 10, max: 100 },
        startingAnchorPosition: "center",
      }),
    ).toEqual({ min: 50, max: 100 });

    expect(
      buildLiveSampleRateRange({
        currentRange: { min: 10, max: 100 },
        sampleRateHz: 50,
        channelBounds: { min: 10, max: 100 },
        startingAnchorPosition: "end",
      }),
    ).toEqual({ min: 50, max: 100 });
  });

  it("keeps a valid last-position range instead of applying the starting anchor", () => {
    expect(
      buildLiveSampleRateRange({
        currentRange: { min: 30, max: 80 },
        sampleRateHz: 50,
        channelBounds: { min: 10, max: 100 },
        startingAnchorPosition: "start",
      }),
    ).toEqual({ min: 30, max: 80 });
  });

  it("can force the starting anchor over a valid last-position range", () => {
    expect(
      buildLiveSampleRateRange({
        currentRange: { min: 30, max: 80 },
        sampleRateHz: 50,
        channelBounds: { min: 10, max: 100 },
        startingAnchorPosition: "start",
        forceStartingAnchor: true,
      }),
    ).toEqual({ min: 10, max: 60 });
  });

  it("preserves the requested sample-rate span from the active channel lower bound", () => {
    expect(
      buildLiveSampleRateRange({
        currentRange: { min: 604_000, max: 3_804_000 },
        sampleRateHz: 20_000_000,
        channelBounds: { min: 18_000, max: 4_390_000 },
      }),
    ).toEqual({ min: 18_000, max: 20_018_000 });
  });
});
