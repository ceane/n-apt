import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { StimulusNode } from "@n-apt/demodulation/react-flow/nodes/StimulusNode";
import {
  AUDIO_TONE_FREQUENCY_HZ,
  AUDIO_TONE_WINDOW_SECONDS,
  AUDIO_TONE_WAVEFORM_SAMPLE_COUNT,
  AUDIO_WATERFALL_BIN_COUNT,
  AUDIO_WATERFALL_FPS,
  AUDIO_WATERFALL_HEIGHT,
  createFmWaterfallFrame,
  createAudioToneReferencePcm,
  createSineWaveformSamples,
  getAudioToneGain,
} from "@n-apt/demodulation/react-flow/nodes/audioWaveformPreview";
import { TestWrapper } from "./testUtils";

const mockDemodValue: {
  analysisSession: {
    state: string;
    type: string;
    startTime: number | null;
  };
  selectedBaseline: string;
  setSelectedBaseline: jest.Mock;
  liveMode: boolean;
  setLiveMode: jest.Mock;
  startAnalysis: jest.Mock;
  recordAudioSurveyStimulusReference: jest.Mock;
  clearAnalysis: jest.Mock;
} = {
  analysisSession: { state: "idle", type: "audio", startTime: null },
  selectedBaseline: "audio",
  setSelectedBaseline: jest.fn(),
  liveMode: false,
  setLiveMode: jest.fn(),
  startAnalysis: jest.fn(),
  recordAudioSurveyStimulusReference: jest.fn().mockResolvedValue(null),
  clearAnalysis: jest.fn(),
};

// Mock the useDemod hook
jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  useDemod: () => mockDemodValue,
}));

const mockWaterfallProps: {
  current: {
    waveformFeed?: {
      getCurrent: () => Float32Array | null;
      subscribe: (listener: (waveform: Float32Array) => void) => () => void;
    };
    waveform?: Float32Array | null;
    height: number;
  } | null;
} = { current: null };

let mockAudioContext: {
  currentTime: number;
  createBufferSource: jest.Mock;
  resume: jest.Mock;
} | null = null;
let nextAnimationFrame: FrameRequestCallback | null = null;

jest.mock("@n-apt/spectrum/public/FIFOWaterfall", () => ({
  FIFOWaterfall: (props: typeof mockWaterfallProps.current) => {
    mockWaterfallProps.current = props;
    return <div data-testid="audio-fm-waterfall" />;
  },
}));

describe("StimulusNode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    nextAnimationFrame = null;
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        nextAnimationFrame = callback;
        return 1;
      });
    const audioContext = {
      currentTime: 0,
      state: "running",
      destination: {},
      resume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      decodeAudioData: jest.fn().mockResolvedValue({
        sampleRate: 24_000,
        length: 4,
        numberOfChannels: 1,
        getChannelData: () => Float32Array.of(-1, -0.5, 0.5, 1),
      }),
      createBuffer: jest.fn((_channels: number, length: number) => {
        const samples = new Float32Array(length);
        return {
          getChannelData: () => samples,
        };
      }),
      createBufferSource: jest.fn(() => ({
        buffer: null,
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null,
      })),
      createOscillator: () => ({
        type: "sine",
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: jest.fn(),
          linearRampToValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
      }),
    };
    mockAudioContext = audioContext;
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: jest.fn(() => audioContext),
    });
    mockDemodValue.analysisSession = {
      state: "idle",
      type: "audio",
      startTime: null,
    };
    mockWaterfallProps.current = null;
    mockDemodValue.recordAudioSurveyStimulusReference.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    mockAudioContext = null;
  });

  const defaultProps = {
    data: {
      label: "Stimulus",
      stimulusOptions: true,
      subtext: "Test subtext",
    },
  };
  const channelACompatibleState = {
    demod: { centerFreqHz: 1_000_000 },
    spectrum: { frequencyRange: { min: 18_000, max: 4_390_000 } },
    websocket: {
      channels: [
        { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
        { id: "b", label: "B", min_hz: 24_100_000, max_hz: 30_370_000 },
        { id: "c", label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
      ],
    },
  };

  it("materializes the played tone as a PCM reference with the same envelope", () => {
    const reference = createAudioToneReferencePcm(1, 48_000);
    expect(reference).toHaveLength(48_000);
    expect(reference[0]).toBe(0);
    expect(
      Math.max(...Array.from(reference.slice(4_800, 5_000))),
    ).toBeGreaterThan(0.4);
    expect(Math.abs(reference[47_999])).toBeLessThan(0.02);
  });

  it("renders with default props", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("Stimulus")).toBeInTheDocument();
    expect(screen.getByText("Test subtext")).toBeInTheDocument();
  });

  it("renders audio preview mode", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText(/440Hz SINE TONE/)).toBeInTheDocument();
    expect(screen.getByText("TRADITIONAL AUDIO WAVEFORM")).toBeInTheDocument();
  });

  it("offers a local audio or video reference file for pairing", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const input = screen.getByLabelText("Reference media file");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "audio/*,video/*");
    expect(screen.getByText(/decoded locally/i)).toBeInTheDocument();
  });

  it("decodes local media to mono 48 kHz and starts it when RF pairing asks", async () => {
    mockDemodValue.recordAudioSurveyStimulusReference.mockImplementation(
      async (input: { startPlayback?: () => Promise<number> | number }) => {
        await input.startPlayback?.();
        return { kind: "reference-pair" };
      },
    );
    render(
      <TestWrapper preloadedState={channelACompatibleState}>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );
    const file = new File(["media"], "reference.wav", { type: "audio/wav" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new ArrayBuffer(5),
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Reference media file"), {
        target: { files: [file] },
      });
    });

    expect(
      await screen.findByText(/decoded locally to mono 48 kHz PCM/),
    ).toBeInTheDocument();
    const captureButton = screen.getByRole("button", {
      name: "CAPTURE MEDIA PAIR",
    });
    await act(async () => fireEvent.click(captureButton));

    expect(
      mockDemodValue.recordAudioSurveyStimulusReference,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        pcmSampleRateHz: 48_000,
        pcmData: expect.any(Float32Array),
        startPlayback: expect.any(Function),
      }),
    );
    expect(mockAudioContext?.resume).toHaveBeenCalledTimes(1);
    expect(mockAudioContext?.createBufferSource).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Saved an aligned I\/Q and PCM pair/),
    ).toBeInTheDocument();
  });

  it("renders a synchronized sine waveform while audio is capturing", () => {
    mockDemodValue.analysisSession = {
      state: "capturing",
      type: "audio",
      startTime: Date.now(),
    };

    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("img", { name: "Traditional audio waveform" }),
    ).toHaveAttribute("data-capturing", "true");
    expect(
      screen.getAllByTestId("traditional-audio-waveform-bar"),
    ).toHaveLength(AUDIO_TONE_WAVEFORM_SAMPLE_COUNT);
  });

  it("advances the visible waveform from the oscillator AudioContext clock", () => {
    mockDemodValue.analysisSession = {
      state: "capturing",
      type: "audio",
      startTime: Date.now(),
    };

    render(
      <TestWrapper preloadedState={channelACompatibleState}>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const bar = screen.getAllByTestId("traditional-audio-waveform-bar")[20];
    const atStart = bar.getAttribute("y1");

    act(() => {
      mockAudioContext!.currentTime = 0.001;
      nextAnimationFrame?.(0);
    });

    expect(bar.getAttribute("y1")).not.toBe(atStart);
  });

  it("renders baseline vector and audio waveform selects", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("combobox", { name: "Baseline Vector" }),
    ).toHaveValue("audio");
    expect(
      screen.getByRole("combobox", { name: "Audio Waveform" }),
    ).toHaveValue("traditional");
    expect(
      screen.getByRole("option", { name: "Traditional Audio Waveform" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "FM Sliding-Window Waterfall" }),
    ).toBeInTheDocument();
  });

  it("renders the FM waterfall when the audio waveform option changes", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Audio Waveform" }), {
      target: { value: "fm-waterfall" },
    });

    expect(screen.getByTestId("audio-fm-waterfall")).toBeInTheDocument();
    expect(mockWaterfallProps.current?.height).toBe(AUDIO_WATERFALL_HEIGHT);
    expect(mockWaterfallProps.current?.waveform?.length).toBe(
      AUDIO_WATERFALL_BIN_COUNT,
    );
    expect(
      screen.queryByText("TRADITIONAL AUDIO WAVEFORM"),
    ).not.toBeInTheDocument();
  });

  it("feeds exactly 60 waterfall rows per simulated second while capturing", () => {
    mockDemodValue.analysisSession = {
      state: "capturing",
      type: "audio",
      startTime: Date.now(),
    };

    const view = render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Audio Waveform" }), {
      target: { value: "fm-waterfall" },
    });

    const received: Float32Array[] = [];
    const feed = mockWaterfallProps.current?.waveformFeed;
    expect(feed).toBeDefined();
    const unsubscribe = feed!.subscribe((waveform) => received.push(waveform));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // The initial row is already present before the subscription; the timer
    // contributes the remaining rows for the first visible 60-row second.
    expect(received).toHaveLength(AUDIO_WATERFALL_FPS - 1);
    expect(new Set(received.map((row) => row[0])).size).toBeGreaterThan(1);

    mockDemodValue.analysisSession = {
      state: "analyzing",
      type: "audio",
      startTime: Date.now(),
    };

    view.rerender(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(received).toHaveLength(AUDIO_WATERFALL_FPS - 1);
    unsubscribe();
  });

  it("creates finite FM waterfall rows inside the renderer dB range", () => {
    const first = createFmWaterfallFrame(0);
    const second = createFmWaterfallFrame(1);

    expect(first).toHaveLength(second.length);
    expect(
      Array.from(first).every((value) => value >= -150 && value <= 0),
    ).toBe(true);
    expect(Array.from(first).every(Number.isFinite)).toBe(true);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("generates a true 440 Hz waveform whose phase advances with audio time", () => {
    const atStart = createSineWaveformSamples({
      audioTimeSeconds: 0,
      frequencyHz: AUDIO_TONE_FREQUENCY_HZ,
    });
    const slightlyLater = createSineWaveformSamples({
      audioTimeSeconds: 0.001,
      frequencyHz: AUDIO_TONE_FREQUENCY_HZ,
    });
    const onePeriodLater = createSineWaveformSamples({
      audioTimeSeconds: 1 / AUDIO_TONE_FREQUENCY_HZ,
      frequencyHz: AUDIO_TONE_FREQUENCY_HZ,
    });

    expect(Array.from(slightlyLater)).not.toEqual(Array.from(atStart));
    onePeriodLater.forEach((value, index) => {
      expect(value).toBeCloseTo(atStart[index], 5);
    });
    expect(AUDIO_TONE_WINDOW_SECONDS).toBeGreaterThan(0);
  });

  it("uses the same gain envelope as the played tone", () => {
    expect(getAudioToneGain(0, 5)).toBe(0);
    expect(getAudioToneGain(0.05, 5)).toBeCloseTo(0.25, 5);
    expect(getAudioToneGain(0.1, 5)).toBeCloseTo(0.5, 5);
    expect(getAudioToneGain(5, 5)).toBeCloseTo(0.01, 5);
  });

  it("waits for the reference capture to schedule a paired tone", async () => {
    mockDemodValue.recordAudioSurveyStimulusReference.mockImplementation(
      async (input: { startedAtMs?: number; startPlayback?: () => number }) => {
        await input.startPlayback?.();
        return null;
      },
    );
    const view = render(
      <TestWrapper preloadedState={channelACompatibleState}>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Pair stimulus tone with captured RF audio",
      }),
    );
    mockDemodValue.analysisSession = {
      state: "capturing",
      type: "audio",
      startTime: Date.now(),
    };

    await act(async () => {
      view.rerender(
        <TestWrapper preloadedState={channelACompatibleState}>
          <StimulusNode {...defaultProps} />
        </TestWrapper>,
      );
    });

    expect(
      mockDemodValue.recordAudioSurveyStimulusReference,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        pcmSampleRateHz: 48_000,
        startPlayback: expect.any(Function),
      }),
    );
    expect(
      mockDemodValue.recordAudioSurveyStimulusReference.mock.calls[0][0]
        .startedAtMs,
    ).toBeUndefined();
  });

  it("renders duration input", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const input = screen.getByDisplayValue("5");
    expect(input).toBeInTheDocument();
  });

  it("renders trigger button", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const button = screen.getByText("TRIGGER");
    expect(button).toBeInTheDocument();
  });

  it("gates audio and speech to A/B while allowing vision on C", () => {
    render(
      <TestWrapper
        preloadedState={{
          demod: { centerFreqHz: 10_000_000 },
          spectrum: { frequencyRange: null },
          websocket: {
            channels: [
              { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
              { id: "b", label: "B", min_hz: 24_100_000, max_hz: 30_370_000 },
              { id: "c", label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
            ],
          },
        }}
      >
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const trigger = screen.getByRole("button", { name: "TRIGGER" });
    const baseline = screen.getByRole("combobox", { name: "Baseline Vector" });
    expect(trigger).toBeDisabled();

    fireEvent.change(baseline, { target: { value: "speech" } });
    expect(trigger).toBeDisabled();
    expect(mockDemodValue.setSelectedBaseline).toHaveBeenLastCalledWith("speech");

    fireEvent.change(baseline, { target: { value: "vision" } });
    expect(trigger).toBeEnabled();
    expect(mockDemodValue.setSelectedBaseline).toHaveBeenLastCalledWith("vision");
  });

  it("renders live capture checkbox", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Pair stimulus tone with captured RF audio",
    });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("renders default subtext when not provided", () => {
    render(
      <TestWrapper>
        <StimulusNode data={{ label: "Stimulus", stimulusOptions: true }} />
      </TestWrapper>,
    );

    expect(screen.getByText(/Capture N-APT signals/)).toBeInTheDocument();
  });
});
