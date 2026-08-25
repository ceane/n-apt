import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import { z } from "zod";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import type { AnalysisType } from "@n-apt/consts/types";
import { FFT_MAX_DB, FFT_MIN_DB } from "@n-apt/consts";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import { FIFOWaterfall } from "@n-apt/spectrum/public/FIFOWaterfall";
import {
  AUDIO_TONE_FREQUENCY_HZ,
  AUDIO_TONE_WAVEFORM_SAMPLE_COUNT,
  AUDIO_WATERFALL_FPS,
  AUDIO_WATERFALL_FREQUENCY_RANGE,
  AUDIO_WATERFALL_HEIGHT,
  createAudioWaveformFeed,
  createFmWaterfallFrame,
  createSineWaveformSamples,
  getAudioToneGain,
  type AudioWaveformMode,
} from "./audioWaveformPreview";

const durationSchema = z.number().min(5).max(60);

const SCRIPT_VARIANTS = [
  "The quick brown fox jumps over the lazy dog",
  "Sphinx of black quartz, judge my vow",
  "Pack my box with five dozen liquor jugs",
  "Five quacking zephyrs jolt my wax bed",
  "The five boxing wizards jump quickly",
  "How vexingly quick daft zebras jump",
  "Bright vixens jump; doozy fowl quack",
  "Quick wafting zephyrs vex bold Jim",
  "Two driven jocks help fax my big quiz",
  "Jinxed wizards pluck ivy from the big quilt",
];

interface StimulusNodeProps {
  data: {
    label: string;
    stimulusOptions?: boolean;
    subtext?: string;
  };
}

const baselineOptions: Array<{ value: AnalysisType; label: string }> = [
  { value: "audio", label: "Audio (Hearing)" },
  { value: "internal", label: "Audio (Internal)" },
  { value: "speech", label: "Speech" },
  { value: "vision", label: "Vision" },
];

// Audio preview components
const AudioContainer = styled.div`
  text-align: center;
  width: 100%;
`;

const TraditionalWaveformContainer = styled.div`
  width: 100%;
  padding: 0 8px;
`;

const TraditionalWaveform = styled.svg`
  display: block;
  width: 100%;
  height: 80px;
  overflow: visible;
`;

const TraditionalWaveformBar = styled.line`
  stroke: ${({ theme }) => theme.colors.primary};
  stroke-width: 1.15;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
`;

const ToneLabel = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  margin-top: ${({ theme }) => theme.spacing.md};
  font-family: ${({ theme }) => theme.typography.mono};
`;

const AudioWaterfallContainer = styled.div`
  width: 100%;
  height: ${AUDIO_WATERFALL_HEIGHT}px;
  min-height: ${AUDIO_WATERFALL_HEIGHT}px;
  overflow: hidden;
  border-radius: 4px;
`;

interface TonePlayback {
  audioContext: AudioContext;
  oscillator: OscillatorNode;
  startedAt: number;
  durationS: number;
}

interface TraditionalAudioWaveformProps {
  isCapturing: boolean;
  tonePlayback: TonePlayback | null;
}

const TraditionalAudioWaveform = React.memo<TraditionalAudioWaveformProps>(
  ({ isCapturing, tonePlayback }) => {
    const barRefs = useRef<Array<SVGLineElement | null>>([]);
    const centerY = 40;
    const maxBarHeight = 31.5;

    useEffect(() => {
      const draw = (audioTimeSeconds: number) => {
        const samples = createSineWaveformSamples({ audioTimeSeconds });
        const gain = tonePlayback
          ? getAudioToneGain(audioTimeSeconds, tonePlayback.durationS)
          : 0;

        samples.forEach((sample, index) => {
          const bar = barRefs.current[index];
          if (!bar) return;
          const halfHeight = Math.abs(sample) * maxBarHeight * gain;
          bar.setAttribute("y1", `${centerY - halfHeight}`);
          bar.setAttribute("y2", `${centerY + halfHeight}`);
        });
      };

      if (!isCapturing || tonePlayback === null) {
        draw(0);
        return;
      }

      let frameId: number | null = null;
      const animate = () => {
        draw(
          Math.max(
            0,
            tonePlayback.audioContext.currentTime - tonePlayback.startedAt,
          ),
        );
        frameId = window.requestAnimationFrame(animate);
      };

      animate();
      return () => {
        if (frameId !== null) window.cancelAnimationFrame(frameId);
      };
    }, [isCapturing, tonePlayback]);

    return (
      <TraditionalWaveform
        aria-label="Traditional audio waveform"
        data-capturing={isCapturing}
        role="img"
        viewBox="0 0 100 80"
        preserveAspectRatio="none"
      >
        {Array.from(
          { length: AUDIO_TONE_WAVEFORM_SAMPLE_COUNT },
          (_, index) => {
            const x = 2 + (index / (AUDIO_TONE_WAVEFORM_SAMPLE_COUNT - 1)) * 96;
            return (
              <TraditionalWaveformBar
                key={index}
                ref={(bar) => {
                  barRefs.current[index] = bar;
                }}
                data-testid="traditional-audio-waveform-bar"
                x1={x}
                x2={x}
                y1={centerY}
                y2={centerY}
              />
            );
          },
        )}
      </TraditionalWaveform>
    );
  },
);

// Internal preview components
const InternalContainer = styled.div`
  text-align: center;
  width: 80%;
`;

const SignalAnalysisLabel = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  margin-bottom: 20px;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const StatusText = styled.div`
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 10px;
  margin-top: 30px;
`;

// Speech preview components
const SpeechContainer = styled.div`
  text-align: center;
  width: 80%;
`;

const VocalCaptureLabel = styled.div`
  color: ${({ theme }) => theme.colors.success};
  font-size: 12px;
  margin-bottom: 20px;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const SpeechBarsContainer = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 40px;
  justify-content: center;
  height: 60px;
  align-items: center;
`;

const SpeechBar = styled.div<{ $isCapturing: boolean }>`
  width: 4px;
  height: 38px;
  background: ${(props) =>
    props.$isCapturing
      ? props.theme.colors.success
      : props.theme.colors.border};
  transform-origin: bottom center;
  box-shadow: none;
  border-radius: 2px;
  animation: ${(props) =>
    props.$isCapturing ? "speechPulse 0.9s infinite ease-in-out" : "none"};

  @keyframes speechPulse {
    0%,
    100% {
      transform: scaleY(0.18);
      opacity: 0.45;
    }
    40% {
      transform: scaleY(1);
      opacity: 1;
    }
    70% {
      transform: scaleY(0.55);
      opacity: 0.75;
    }
  }
`;

// Vision preview components
const VisionContainer = styled.div<{ $isCapturing: boolean }>`
  width: 100%;
  height: 100%;
  background: ${(props) =>
    props.$isCapturing
      ? props.theme.colors.danger
      : props.theme.colors.surface};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const RecIndicator = styled.div<{ $isCapturing: boolean }>`
  color: ${(props) =>
    props.$isCapturing
      ? props.theme.colors.textPrimary
      : props.theme.colors.border};
  font-size: 20px;
  font-weight: bold;
  border: 4px solid;
`;

const ScriptText = styled.div`
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  line-height: 1.6;
  text-align: center;
  color: ${({ theme }) => theme.colors.primary};
  margin: 12px 0;
  padding: 8px;
  background: ${({ theme }) => theme.colors.activeBackground};
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.primary}33;
`;

// Countdown and progress components
const CountdownContainer = styled.div`
  position: absolute;
  bottom: ${({ theme }) => theme.spacing.md};
  right: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.background}ee;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: ${({ theme }) => theme.spacing.sm};
  min-width: 120px;
  backdrop-filter: blur(10px);
`;

const ProgressBar = styled.div<{ $progress: number }>`
  width: 100%;
  height: 4px;
  background: ${({ theme }) => theme.colors.border};
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
`;

const ProgressFill = styled.div<{ $progress: number }>`
  width: ${(props) => props.$progress}%;
  height: 100%;
  background: linear-gradient(
    90deg,
    ${({ theme }) => theme.colors.danger},
    ${({ theme }) => theme.colors.danger}aa
  );
  transition: width 0.1s ease;
`;

const ProgressLabel = styled.div`
  font-size: 9px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary || theme.colors.primary};
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const StimulusContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 220px;
`;

const StimulusContent = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const StimulusPreview = styled.div`
  min-height: 210px;
  border: 1px solid ${({ theme }) => theme.colors.borderHover};
  border-radius: 10px;
  background: linear-gradient(
    180deg,
    ${({ theme }) => theme.colors.background} 0%,
    ${({ theme }) => theme.colors.surface} 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
`;

const StimulusSelect = styled.select`
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.typography.mono};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  option {
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const StimulusButton = styled.button<{ $disabled: boolean }>`
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.primary};
  background: ${({ theme, $disabled }) =>
    $disabled ? theme.colors.surface : theme.colors.background};
  color: ${({ theme, $disabled }) =>
    $disabled ? theme.colors.textDisabled : theme.colors.primary};
  font-weight: 700;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  font-family: ${({ theme }) => theme.typography.mono};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.activeBackground};
  }
`;

const StimulusLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  user-select: none;
`;

const StimulusSubtext = styled.div`
  font-size: 10px;
  line-height: 1.5;
  opacity: 0.75;
  text-align: center;
  padding: 0 8px;
  font-style: italic;
  word-wrap: break-word;
`;

const ResetButton = styled.button`
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.activeBackground};
  }
`;

const BaselineVectorContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 65px auto;
  gap: 10px;
  align-items: stretch;
`;

const SelectLabel = styled.label`
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.6;
  margin-bottom: 6px;
`;

const AudioWaveformControl = styled.div`
  width: 100%;
`;

const TitleText = styled.div`
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
  color: ${(props) => props.theme.colors.primary};
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const StimulusInput = styled.input`
  flex: 1;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 12px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &[aria-invalid="true"] {
    border-color: ${({ theme }) => theme.colors.danger};
    color: ${({ theme }) => theme.colors.danger};
  }
`;

export const StimulusNode: React.FC<StimulusNodeProps> = ({ data }) => {
  const {
    analysisSession,
    selectedBaseline,
    setSelectedBaseline,
    liveMode,
    setLiveMode,
    startAnalysis,
    clearAnalysis,
  } = useDemod();
  const [previewMode, setPreviewMode] =
    useState<AnalysisType>(selectedBaseline);
  const [scriptIndex, setScriptIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [durationS, setDurationS] = useState(5);
  const [durationError, setDurationError] = useState<string | null>(null);
  const [audioWaveformMode, setAudioWaveformMode] =
    useState<AudioWaveformMode>("traditional");
  const [tonePlayback, setTonePlayback] = useState<TonePlayback | null>(null);
  const fmFrameIndexRef = useRef(0);
  const fmWaveformFeed = useMemo(
    () => createAudioWaveformFeed(createFmWaterfallFrame(0)),
    [],
  );
  const resampleOutputRef = useRef<Float32Array | undefined>(undefined);

  const isBusy =
    analysisSession.state !== "idle" && analysisSession.state !== "result";
  const isStarting = analysisSession.state === "starting";
  const isCapturing = analysisSession.state === "capturing";

  useEffect(() => {
    if (audioWaveformMode !== "fm-waterfall") return;
    fmFrameIndexRef.current = 0;
    fmWaveformFeed.publish(createFmWaterfallFrame(0));
  }, [audioWaveformMode, fmWaveformFeed]);

  useEffect(() => {
    if (audioWaveformMode !== "fm-waterfall" || !isCapturing) return;

    const startedAt = Date.now();
    let emittedFrames = 0;
    const interval = window.setInterval(() => {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const dueFrames = Math.floor((elapsedMs * AUDIO_WATERFALL_FPS) / 1000);

      while (emittedFrames < dueFrames) {
        emittedFrames += 1;
        fmFrameIndexRef.current += 1;
        fmWaveformFeed.publish(createFmWaterfallFrame(fmFrameIndexRef.current));
      }
    }, 1000 / AUDIO_WATERFALL_FPS);

    return () => window.clearInterval(interval);
  }, [audioWaveformMode, fmWaveformFeed, isCapturing]);

  const performWaterfallResampling = useCallback(
    (
      input: ArrayLike<number>,
      targetLength: number,
      destination?: Float32Array,
    ) => {
      const output = resampleNearestInto(
        input,
        targetLength,
        FFT_MIN_DB,
        destination ?? resampleOutputRef.current,
      );
      resampleOutputRef.current = output;
      return output;
    },
    [],
  );

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val)) {
      setDurationS(0);
      setDurationError("Must be a number");
      return;
    }

    setDurationS(val);

    const result = durationSchema.safeParse(val);
    if (!result.success) {
      setDurationError(result.error.issues[0].message);
    } else {
      setDurationError(null);
    }
  };

  // Capture progress bar logic
  useEffect(() => {
    if (isCapturing) {
      setProgress(0);
      const startTime = analysisSession.startTime || Date.now();
      const totalMs = durationS * 1000;

      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const p = Math.min(100, (elapsed / totalMs) * 100);

        setProgress(p);

        if (p >= 100) {
          clearInterval(progressInterval);
        }
      }, 100); // 100ms updates
      return () => clearInterval(progressInterval);
    } else {
      setProgress(0);
    }
  }, [isCapturing, durationS, analysisSession.startTime]);

  const playTone = useCallback(() => {
    const audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    const startedAt = audioCtx.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(AUDIO_TONE_FREQUENCY_HZ, startedAt);

    // Smooth fade in/out to avoid clicking
    gainNode.gain.setValueAtTime(0, startedAt);
    gainNode.gain.linearRampToValueAtTime(0.5, startedAt + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.01, startedAt + durationS); // Play for duration

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(startedAt);
    oscillator.stop(startedAt + durationS);
    setTonePlayback({
      audioContext: audioCtx,
      oscillator,
      startedAt,
      durationS,
    });

    return () => {
      try {
        oscillator.stop();
      } catch {
        // The scheduled stop may already have completed.
      }
      if (audioCtx.state !== "closed" && typeof audioCtx.close === "function") {
        void audioCtx.close();
      }
      setTonePlayback((current) =>
        current?.oscillator === oscillator ? null : current,
      );
    };
  }, [durationS]);

  const handleTrigger = () => {
    if (durationError) return;

    // Delay audio to start when capture officially starts
    // We send command after 3s, server takes ~0-1s, so ~4s total delay
    // But better to trigger playTone() when state becomes 'capturing'
    if (previewMode === "internal" || previewMode === "speech") {
      setScriptIndex(Math.floor(Math.random() * SCRIPT_VARIANTS.length));
    }

    setSelectedBaseline(previewMode);
    startAnalysis(previewMode, liveMode, durationS);
  };

  // Tone trigger switch
  useEffect(() => {
    if (
      isCapturing &&
      (previewMode === "audio" || previewMode === "internal")
    ) {
      return playTone();
    }
    setTonePlayback(null);
    return undefined;
  }, [isCapturing, previewMode, playTone]);

  return (
    <StimulusContainer>
      <TitleText>{data.label}</TitleText>

      <StimulusContent>
        <StimulusPreview>
          {previewMode === "audio" && audioWaveformMode === "traditional" && (
            <AudioContainer>
              <TraditionalWaveformContainer>
                <TraditionalAudioWaveform
                  isCapturing={isCapturing}
                  tonePlayback={tonePlayback}
                />
              </TraditionalWaveformContainer>
              <ToneLabel>TRADITIONAL AUDIO WAVEFORM</ToneLabel>
              <ToneLabel>440Hz SINE TONE</ToneLabel>
            </AudioContainer>
          )}

          {previewMode === "audio" && audioWaveformMode === "fm-waterfall" && (
            <AudioContainer>
              <AudioWaterfallContainer>
                <FIFOWaterfall
                  width={480}
                  height={AUDIO_WATERFALL_HEIGHT}
                  waveform={fmWaveformFeed.getCurrent()}
                  waveformFeed={fmWaveformFeed}
                  frequencyRange={AUDIO_WATERFALL_FREQUENCY_RANGE}
                  fftMin={FFT_MIN_DB}
                  fftMax={FFT_MAX_DB}
                  retuneSmear={0}
                  isPaused={!isCapturing}
                  isVisible={true}
                  performScalarResampling={performWaterfallResampling}
                  placeholderSourceLabel="FM audio preview"
                  placeholderPaneLabel="FM audio waterfall"
                />
              </AudioWaterfallContainer>
            </AudioContainer>
          )}

          {previewMode === "internal" && (
            <InternalContainer>
              <SignalAnalysisLabel>Signal Analysis</SignalAnalysisLabel>
              <ScriptText>
                {isCapturing
                  ? SCRIPT_VARIANTS[scriptIndex]
                  : "Ready for analysis"}
              </ScriptText>
              <StatusText>{isCapturing ? "Processing..." : "Ready"}</StatusText>
            </InternalContainer>
          )}

          {previewMode === "speech" && (
            <SpeechContainer>
              <VocalCaptureLabel>VOCAL CAPTURE INTERFACE</VocalCaptureLabel>
              <ScriptText style={{ color: "#00ff88" }}>
                {isCapturing
                  ? SCRIPT_VARIANTS[scriptIndex]
                  : "Ready for vocal input"}
              </ScriptText>
              <SpeechBarsContainer>
                {[...Array(20)].map((_, i) => {
                  return (
                    <SpeechBar
                      key={i}
                      $isCapturing={isCapturing}
                      style={{ animationDelay: `${i * 0.05}s` }}
                    />
                  );
                })}
              </SpeechBarsContainer>
            </SpeechContainer>
          )}

          {previewMode === "vision" && (
            <VisionContainer $isCapturing={isCapturing}>
              <RecIndicator $isCapturing={isCapturing}>REC</RecIndicator>
            </VisionContainer>
          )}

          {progress > 0 && (
            <CountdownContainer>
              <ProgressBar $progress={progress}>
                <ProgressFill $progress={progress} />
              </ProgressBar>
              <ProgressLabel>
                {progress < 100 ? "Capturing..." : "Complete!"}
              </ProgressLabel>
            </CountdownContainer>
          )}
        </StimulusPreview>

        <BaselineVectorContainer>
          <div>
            <SelectLabel htmlFor="stimulus-baseline-vector">
              Baseline Vector
            </SelectLabel>
            <StimulusSelect
              id="stimulus-baseline-vector"
              aria-label="Baseline Vector"
              value={previewMode}
              onChange={(e) => setPreviewMode(e.target.value as AnalysisType)}
              disabled={isBusy}
            >
              {baselineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </StimulusSelect>
          </div>
          <div>
            <SelectLabel
              style={{ color: durationError ? "#ff4d4d" : undefined }}
            >
              Dur (s)
            </SelectLabel>
            <StimulusInput
              type="number"
              value={durationS || ""}
              onChange={handleDurationChange}
              disabled={isBusy}
              min={5}
              max={60}
              aria-invalid={durationError !== null}
              style={{ padding: "9px 8px" }}
            />
          </div>
          <StimulusButton
            onClick={handleTrigger}
            disabled={isBusy}
            $disabled={isBusy}
            style={{ alignSelf: "end" }}
          >
            TRIGGER
          </StimulusButton>
        </BaselineVectorContainer>

        {previewMode === "audio" && (
          <AudioWaveformControl>
            <SelectLabel htmlFor="stimulus-audio-waveform">
              Audio Waveform
            </SelectLabel>
            <StimulusSelect
              id="stimulus-audio-waveform"
              aria-label="Audio Waveform"
              value={audioWaveformMode}
              onChange={(e) =>
                setAudioWaveformMode(e.target.value as AudioWaveformMode)
              }
              disabled={isBusy}
            >
              <option value="traditional">Traditional Audio Waveform</option>
              <option value="fm-waterfall">FM Sliding-Window Waterfall</option>
            </StimulusSelect>
          </AudioWaveformControl>
        )}

        <StimulusLabel>
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(e) => setLiveMode(e.target.checked)}
            disabled={isBusy}
          />
          LIVE CAPTURE (EPHEMERAL)
        </StimulusLabel>

        <StimulusSubtext>
          {data.subtext ||
            "Capture N-APT signals with a known baseline for demod later. Media is played while recording in order to learn what is where."}
        </StimulusSubtext>

        {analysisSession.state === "result" && (
          <ResetButton onClick={clearAnalysis}>Reset Session</ResetButton>
        )}
      </StimulusContent>
    </StimulusContainer>
  );
};
