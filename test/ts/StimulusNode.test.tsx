import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  clearAnalysis: jest.Mock;
} = {
  analysisSession: { state: "idle", type: "audio", startTime: null },
  selectedBaseline: "audio",
  setSelectedBaseline: jest.fn(),
  liveMode: false,
  setLiveMode: jest.fn(),
  startAnalysis: jest.fn(),
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

let mockAudioContext: { currentTime: number } | null = null;
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
      destination: {},
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
      <TestWrapper>
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

  it("renders live capture checkbox", () => {
    render(
      <TestWrapper>
        <StimulusNode {...defaultProps} />
      </TestWrapper>,
    );

    const checkbox = screen.getByRole("checkbox");
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
