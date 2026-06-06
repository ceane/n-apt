import { act, renderHook } from "@testing-library/react";
import {
  buildLiveSampleRateRange,
  useLiveSampleRateControl,
} from "@n-apt/hooks/useLiveSampleRateControl";

describe("useLiveSampleRateControl", () => {
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
      min: 24_720_000,
      max: 37_520_000,
    });

    rerender({ ...initialProps, sampleRateHz: 12_800_000 });
    expect(setSampleRate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleSampleRateChange(20_000_000);
    });

    expect(setSampleRate).toHaveBeenLastCalledWith(20_000_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 24_720_000,
      max: 44_720_000,
    });

    rerender({ ...initialProps, sampleRateHz: 20_000_000 });
    expect(setSampleRate).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.handleSampleRateChange(12_800_000);
    });

    expect(setSampleRate).toHaveBeenLastCalledWith(12_800_000);
    expect(setSampleRate).toHaveBeenCalledTimes(3);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 24_720_000,
      max: 37_520_000,
    });
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
      min: 18_000,
      max: 4_018_000,
    });

    rerender({
      ...initialProps,
      frequencyRange: { min: 18_000, max: 4_018_000 },
      sampleRateHz: 4_000_000,
    });

    act(() => {
      result.current.handleSampleRateChange(3_200_000);
    });
    expect(setSampleRate).toHaveBeenLastCalledWith(3_200_000);
    expect(applyFrequencyRange).toHaveBeenLastCalledWith({
      min: 18_000,
      max: 3_218_000,
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
      min: 4_750_000,
      max: 7_950_000,
    });
  });

  it("keeps whole-channel mode aligned when switching active channels", () => {
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

    expect(setSampleRate).toHaveBeenCalledWith(5_200_000);
    expect(applyFrequencyRange).toHaveBeenCalledWith({
      min: 24_720_000,
      max: 29_920_000,
    });
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

  it("repairs stale startup sample rates that are not valid manual options", () => {
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

    expect(setSampleRate).toHaveBeenCalledWith(4_372_000);
    expect(applyFrequencyRange).toHaveBeenCalledWith({
      min: 18_000,
      max: 4_390_000,
    });
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
      min: 18_000,
      max: 5_018_000,
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
