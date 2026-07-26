import { renderHook, act } from "@testing-library/react";
import {
  streamWholeChannelSegmentFrames,
  useCaptureWholeChannelSegments,
} from "@n-apt/hooks/useCaptureWholeChannelSegments";
import { TestWrapper } from "./testUtils";

describe("streamWholeChannelSegmentFrames", () => {
  it("captures one stitched whole-channel frame per spectrum-store frame", async () => {
    const captureWholeChannelSegments = jest
      .fn<
        Promise<
          Array<{
            data: any;
            visualRange: { min: number; max: number };
            waveformHistory: Float32Array[];
          }>
        >,
        []
      >()
      .mockImplementation(async () => [
        {
          data: {},
          visualRange: { min: 1, max: 2 },
          waveformHistory: [],
        },
      ]);

    const frames: Array<
      Array<{
        data: any;
        visualRange: { min: number; max: number };
        waveformHistory: Float32Array[];
      }>
    > = [];
    for await (const frame of streamWholeChannelSegmentFrames(
      captureWholeChannelSegments,
      12,
      1000,
    )) {
      frames.push(frame);
    }

    expect(captureWholeChannelSegments).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(12);
    expect(frames[0]).toEqual([
      {
        data: {},
        visualRange: { min: 1, max: 2 },
        waveformHistory: [],
      },
    ]);
  });
});

describe("useCaptureWholeChannelSegments", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalSetTimeout = window.setTimeout;

  beforeEach(() => {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 1 as unknown as number;
    }) as typeof window.setTimeout;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.setTimeout = originalSetTimeout;
    jest.restoreAllMocks();
  });

  it("sweeps hardware-sized segments and restores the original range after capture", async () => {
    const sendFrequencyRange = jest.fn();
    const getSnapshotData = jest.fn().mockImplementation(() => {
      const callCount = getSnapshotData.mock.calls.length;
      const segmentIndex = Math.floor(callCount / 60);
      const ranges = [
        { min: 0, max: 2e6 },
        { min: 2e6, max: 4e6 },
        { min: 4e6, max: 6e6 },
      ];
      return {
        waveform: new Float32Array([1, 2]),
        frequencyRange: ranges[segmentIndex] || ranges[0],
      };
    });

    const fftCanvasRef = {
      current: {
        getSnapshotData,
      },
    } as any;

    const { result } = renderHook(
      () =>
        useCaptureWholeChannelSegments({
          frequencyRange: { min: 0, max: 6e6 },
          sourceMode: "live",
          sampleRateHzEffective: 2_000_000,
          activeSignalArea: undefined,
          signalAreaBounds: null,
          fftFrameRate: 12,
          vizPanOffset: 0,
          vizZoom: 1,
          sendFrequencyRange,
          fftCanvasRef,
        }),
      { wrapper: TestWrapper },
    );

    let segments: Awaited<ReturnType<typeof result.current>> = [];
    await act(async () => {
      segments = await result.current();
    });

    expect(segments.map((segment: any) => segment.visualRange)).toEqual([
      { min: 0, max: 2000000 },
      { min: 2000000, max: 4000000 },
      { min: 4000000, max: 6000000 },
    ]);
    expect(sendFrequencyRange).toHaveBeenNthCalledWith(1, {
      min: 0,
      max: 2000000,
    });
    expect(sendFrequencyRange).toHaveBeenNthCalledWith(2, {
      min: 2000000,
      max: 4000000,
    });
    expect(sendFrequencyRange).toHaveBeenNthCalledWith(3, {
      min: 4000000,
      max: 6000000,
    });
    expect(sendFrequencyRange).toHaveBeenLastCalledWith({ min: 0, max: 6e6 });
    expect(getSnapshotData).toHaveBeenCalledTimes(183);
  });

  it("does not sweep whole-channel segments for RTL-SDR sources", async () => {
    const sendFrequencyRange = jest.fn();
    const getSnapshotData = jest.fn();

    const fftCanvasRef = {
      current: {
        getSnapshotData,
      },
    } as any;

    const { result } = renderHook(
      () =>
        useCaptureWholeChannelSegments({
          frequencyRange: { min: 18_000, max: 4_390_000 },
          sourceMode: "live",
          sampleRateHzEffective: 3_200_000,
          deviceKind: "rtl_sdr",
          backend: "rtl-sdr",
          deviceName: "RTL-SDR Blog V4",
          activeSignalArea: undefined,
          signalAreaBounds: null,
          fftFrameRate: 12,
          vizPanOffset: 0,
          vizZoom: 1,
          sendFrequencyRange,
          fftCanvasRef,
        }),
      { wrapper: TestWrapper },
    );

    let segments: Awaited<ReturnType<typeof result.current>> = [];
    await act(async () => {
      segments = await result.current();
    });

    expect(segments).toEqual([]);
    expect(sendFrequencyRange).not.toHaveBeenCalled();
    expect(getSnapshotData).not.toHaveBeenCalled();
  });
});
