import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { useAppSelector } from "@n-apt/redux";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import type { AnalysisType } from "@n-apt/consts/types";
import { FFT_MAX_DB, FFT_MIN_DB } from "@n-apt/consts";
import { formatFrequency } from "@n-apt/math/frequency";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import {
  AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ,
  resampleDecodedAudioToMonoPcm,
} from "@n-apt/demodulation/survey/audioSurveyMedia";
import { FIFOWaterfall } from "@n-apt/spectrum/public/FIFOWaterfall";
import {
  AUDIO_TONE_FREQUENCY_HZ,
  AUDIO_TONE_WAVEFORM_SAMPLE_COUNT,
  AUDIO_WATERFALL_FPS,
  AUDIO_WATERFALL_FREQUENCY_RANGE,
  AUDIO_WATERFALL_HEIGHT,
  createAudioWaveformFeed,
  createFmWaterfallFrame,
  createAudioToneReferencePcm,
  createSineWaveformSamples,
  getAudioToneGain,
  type AudioWaveformMode,
} from "./audioWaveformPreview";
import {
  evaluateStimulusChannelAccess,
  type StimulusChannelBounds,
} from "./stimulusChannelPolicy";
import {
  getChannelPrerequisite,
  type DemodFlowId,
} from "@n-apt/demodulation/channelPrerequisites";
import type { AudioSurveyReferenceLabel } from "@n-apt/demodulation/survey/audioSurveyModel";
import {
  VISION_PRESETS,
  type VisionPreset,
} from "@n-apt/demodulation/vision/visionModel";
import {
  getVisionDisplayOptions,
  requestVisionFullscreen,
  type VisionDisplayOption,
} from "@n-apt/demodulation/vision/visionScreens";
import {
  getVisionReceiverLabel,
  isMockVisionTestSource,
} from "@n-apt/demodulation/vision/visionSourcePolicy";

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

const describeRequiredChannels = (
  analysisType: AnalysisType,
  channels: readonly StimulusChannelBounds[] | null | undefined,
) => {
  const prerequisite = getChannelPrerequisite(
    `demod.stimulus.${analysisType}` as DemodFlowId,
    channels,
  );
  const { channelLabels: labels } = prerequisite;
  if (!prerequisite.available || labels.length === 0) {
    return "channel requirement unavailable";
  }
  const joiner = prerequisite.mode === "all" ? " and " : " or ";
  return labels.length === 1
    ? `Channel ${labels[0]}`
    : labels.map((label) => `Channel ${label}`).join(joiner);
};

// Audio preview components
const AudioContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
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

const ReferenceMediaControls = styled.div`
  display: grid;
  gap: 6px;
  width: 100%;
  min-width: 0;
  text-align: left;
`;

const ReferenceMediaStatus = styled.div`
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 11px;
  overflow-wrap: anywhere;
`;

const ReferenceMediaInput = styled.input`
  width: 100%;
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.sans};
`;

const CaptureLabelControl = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
`;

const CaptureLabelPills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
`;

const CaptureLabelPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  font-family: ${({ theme }) => theme.typography.sans};
  overflow-wrap: anywhere;
`;

const CaptureLabelRemove = styled.button`
  min-width: 18px;
  min-height: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
`;

interface SelectedReferenceMedia {
  name: string;
  audioContext: AudioContext;
  audioBuffer: AudioBuffer;
  pcmData: Float32Array;
  durationMs: number;
}

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
const VisionContainer = styled.div<{
  $isCapturing: boolean;
  $preset: VisionPreset;
}>`
  width: 100%;
  height: 100%;
  background: ${({ $preset }) => `rgb(${VISION_PRESETS[$preset].join(",")})`};
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
  height: 1vh;
  min-height: 7px;
  max-height: 10px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.92);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 4px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.88);
`;

const ProgressFill = styled.div<{ $progress: number }>`
  width: ${(props) => props.$progress}%;
  height: 100%;
  background: #ffe600;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.72);
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
  gap: 10px;
  width: 100%;
  max-width: 760px;
  min-width: 0;
  box-sizing: border-box;
`;

const StimulusContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 9px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.35));
  border-radius: 8px;
  background: var(--color-surface, transparent);
  color: var(--text-secondary, #aaa);
  font-family: monospace;
  font-size: 11px;
  overflow: hidden;
`;

const StimulusPreview = styled.div`
  width: 100%;
  min-height: 210px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
`;

const StimulusSelect = styled.select`
  width: 100%;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.sans};
  font-size: 11px;
  white-space: normal;
  overflow-wrap: anywhere;

  &:focus-visible {
    outline: none;
    border-color: ${({ theme }) => theme.colors.borderHover};
  }

  option {
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const StimulusButton = styled.button`
  width: 100%;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  font: inherit;
  white-space: normal;
  overflow-wrap: anywhere;
`;

const StimulusLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: inherit;
  color: inherit;
  user-select: none;
  overflow-wrap: anywhere;
`;

const StimulusSubtext = styled.div`
  font-size: inherit;
  line-height: 1.45;
  opacity: 0.8;
  text-align: left;
  padding: 0;
  word-wrap: break-word;
`;

const ResetButton = styled.button`
  width: 100%;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  font: inherit;
  white-space: normal;
  overflow-wrap: anywhere;
`;

const BaselineVectorContainer = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 7px;
  min-width: 0;
  border-top: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  padding-top: 8px;
`;

const BaselineActionRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 7px;
  min-width: 0;

  & > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
`;

const SelectLabel = styled.label`
  display: block;
  font-size: inherit;
  color: inherit;
  margin-bottom: 4px;
`;

const AudioWaveformControl = styled.div`
  width: 100%;
`;

const StimulusInput = styled.input`
  width: 100%;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.sans};
  font-size: 11px;
  overflow-wrap: anywhere;

  &:focus-visible {
    outline: none;
    border-color: ${({ theme }) => theme.colors.borderHover};
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
    recordAudioSurveyStimulusReference,
    clearAnalysis,
    visionPreset,
    setVisionPreset,
  } = useDemod();
  const [previewMode, setPreviewMode] =
    useState<AnalysisType>(selectedBaseline);
  const [selectedVisionPreset, setSelectedVisionPreset] =
    useState<VisionPreset>(visionPreset ?? "Red");
  const demodCenterFrequencyHz = useAppSelector(
    (state) => state.demod.bandwidthCenterFreqHz ?? state.demod.centerFreqHz,
  );
  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const channels = useAppSelector((state) => state.websocket.channels);
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const sources = useAppSelector((state) => state.websocket.sources ?? []);
  const tunedFrequencyHz = useMemo(
    () =>
      demodCenterFrequencyHz ??
      (frequencyRange &&
      Number.isFinite(frequencyRange.min) &&
      Number.isFinite(frequencyRange.max)
        ? (frequencyRange.min + frequencyRange.max) / 2
        : null),
    [demodCenterFrequencyHz, frequencyRange],
  );
  const channelAccess = useMemo(
    () =>
      evaluateStimulusChannelAccess(previewMode, tunedFrequencyHz, channels),
    [channels, previewMode, tunedFrequencyHz],
  );
  const stimulusChannelCompatible = channelAccess.allowed;
  const [scriptIndex, setScriptIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [durationS, setDurationS] = useState(5);
  const [visionDisplays, setVisionDisplays] = useState<VisionDisplayOption[]>(
    [],
  );
  const [visionDisplaySupported, setVisionDisplaySupported] = useState(false);
  const [selectedVisionDisplayId, setSelectedVisionDisplayId] = useState("");
  const [visionDisplayError, setVisionDisplayError] = useState<string | null>(
    null,
  );
  const [durationError, setDurationError] = useState<string | null>(null);
  const [audioWaveformMode, setAudioWaveformMode] =
    useState<AudioWaveformMode>("traditional");
  const [tonePlayback, setTonePlayback] = useState<TonePlayback | null>(null);
  const [audioSignalLabel, setAudioSignalLabel] = useState<
    AudioSurveyReferenceLabel | ""
  >("");
  const [captureLabelDraft, setCaptureLabelDraft] = useState("");
  const [captureLabels, setCaptureLabels] = useState<string[]>([]);
  const [selectedReferenceMedia, setSelectedReferenceMedia] =
    useState<SelectedReferenceMedia | null>(null);
  const [referenceMediaStatus, setReferenceMediaStatus] = useState(
    "Select audio or video; its audio track is decoded locally to mono 48 kHz PCM.",
  );
  const [isCapturingReferenceMedia, setIsCapturingReferenceMedia] =
    useState(false);
  const captureJobIdRef = useRef<string | null>(null);
  const selectedReferenceMediaRef = useRef<SelectedReferenceMedia | null>(null);
  const mediaPlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioSignalLabelRef = useRef<AudioSurveyReferenceLabel | "">(
    audioSignalLabel,
  );
  const captureLabelsRef = useRef(captureLabels);
  const recordAudioSurveyReferenceRef = useRef(
    recordAudioSurveyStimulusReference,
  );
  audioSignalLabelRef.current = audioSignalLabel;
  captureLabelsRef.current = captureLabels;
  recordAudioSurveyReferenceRef.current = recordAudioSurveyStimulusReference;
  selectedReferenceMediaRef.current = selectedReferenceMedia;
  const fmFrameIndexRef = useRef(0);
  const fmWaveformFeed = useMemo(
    () => createAudioWaveformFeed(createFmWaterfallFrame(0)),
    [],
  );
  const resampleOutputRef = useRef<Float32Array | undefined>(undefined);

  useEffect(
    () => () => {
      const media = selectedReferenceMediaRef.current;
      if (
        media?.audioContext.state !== "closed" &&
        typeof media?.audioContext.close === "function"
      ) {
        void media.audioContext.close();
      }
      try {
        mediaPlaybackSourceRef.current?.stop();
      } catch {
        // Playback may have completed while the node was being removed.
      }
    },
    [],
  );

  const isBusy =
    analysisSession.state !== "idle" && analysisSession.state !== "result";
  const _isStarting = analysisSession.state === "starting";
  const isCapturing = analysisSession.state === "capturing";
  const selectedVisionDisplay =
    visionDisplays.find((display) => display.id === selectedVisionDisplayId) ??
    null;
  const activeSource = sources.find((source) => source.id === activeSourceId);
  const visionReceiverLabel =
    sourceMode === "file" ? null : getVisionReceiverLabel(activeSource);
  const visionMockTestMode =
    previewMode === "vision" &&
    sourceMode !== "file" &&
    isMockVisionTestSource(activeSource);
  const visionRequirementLabel = channelAccess.requiredChannelLabels[0];
  const visionRequirementChannel = channels?.find(
    (channel) =>
      channel.label?.trim().toUpperCase() === visionRequirementLabel,
  );
  const visionRequirementRangeLabel =
    visionRequirementChannel &&
    Number.isFinite(visionRequirementChannel.min_hz) &&
    Number.isFinite(visionRequirementChannel.max_hz) &&
    visionRequirementChannel.max_hz > visionRequirementChannel.min_hz
      ? `${formatFrequency(visionRequirementChannel.min_hz, { precisionMHz: 2, trimTrailingZeros: true })}–${formatFrequency(visionRequirementChannel.max_hz, { precisionMHz: 2, trimTrailingZeros: true })}`
      : "range unavailable";
  const visionCaptureBlockers =
    previewMode === "vision"
      ? [
          visionReceiverLabel
            ? null
            : visionMockTestMode
              ? null
              : "Select a live RTL-SDR or HackRF One, or use Mock APT SDR for an ephemeral test.",
          stimulusChannelCompatible
            ? null
            : channelAccess.available
              ? `Tune within ${describeRequiredChannels(previewMode, channels)} (${visionRequirementRangeLabel}) before starting the reference capture.`
              : "No valid channel prerequisite metadata is configured for this vision flow.",
          selectedVisionDisplay && visionDisplayError === null
            ? null
            : (visionDisplayError ??
              "Choose a display before starting the reference capture."),
        ].filter((blocker): blocker is string => blocker !== null)
      : [];
  const isEphemeralCapture = liveMode || visionMockTestMode;
  const triggerDisabled =
    isBusy ||
    durationError !== null ||
    !stimulusChannelCompatible ||
    (previewMode === "vision" && visionCaptureBlockers.length > 0);

  useEffect(() => {
    setSelectedVisionPreset(visionPreset);
  }, [visionPreset]);

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

  const addCaptureLabel = (raw: string) => {
    const label = raw.trim().replace(/\s+/g, " ");
    if (!label || label.length > 80) return;
    setCaptureLabels((current) =>
      current.includes(label) || current.length >= 32
        ? current
        : [...current, label],
    );
    setCaptureLabelDraft("");
  };

  const removeCaptureLabel = (label: string) => {
    setCaptureLabels((current) => current.filter((item) => item !== label));
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
    oscillator.type = "sine";
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const scheduleTone = (delaySeconds = 0) => {
      const contextNow = audioCtx.currentTime;
      const startedAt = contextNow + delaySeconds;
      const wallClockNow = Date.now();
      oscillator.frequency.setValueAtTime(AUDIO_TONE_FREQUENCY_HZ, startedAt);

      // Smooth fade in/out to avoid clicking.
      gainNode.gain.setValueAtTime(0, startedAt);
      gainNode.gain.linearRampToValueAtTime(0.5, startedAt + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startedAt + durationS);

      oscillator.start(startedAt);
      oscillator.stop(startedAt + durationS);
      setTonePlayback({
        audioContext: audioCtx,
        oscillator,
        startedAt,
        durationS,
      });
      return wallClockNow + delaySeconds * 1_000;
    };

    if (previewMode === "audio") {
      const requestedAtMs = Date.now();
      void recordAudioSurveyReferenceRef.current({
        captureId: captureJobIdRef.current ?? `stimulus_${requestedAtMs}`,
        pcmData: createAudioToneReferencePcm(durationS, 48_000),
        pcmSampleRateHz: 48_000,
        ...(audioSignalLabelRef.current
          ? { audioSignalLabel: audioSignalLabelRef.current }
          : {}),
        ...(captureLabelsRef.current.length > 0
          ? { labels: captureLabelsRef.current }
          : {}),
        startPlayback: () => scheduleTone(0.1),
      });
    } else {
      scheduleTone();
    }

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
  }, [durationS, previewMode]);

  const handleReferenceMediaSelection = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const previous = selectedReferenceMediaRef.current;
      selectedReferenceMediaRef.current = null;
      setSelectedReferenceMedia(null);
      if (
        previous?.audioContext.state !== "closed" &&
        typeof previous?.audioContext.close === "function"
      ) {
        void previous.audioContext.close();
      }

      const AudioContextConstructor =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextConstructor) {
        setReferenceMediaStatus(
          "This browser cannot decode local reference media with Web Audio.",
        );
        return;
      }
      const audioContext = new AudioContextConstructor();
      setReferenceMediaStatus(`Decoding ${file.name} locally…`);
      try {
        const decoded = await audioContext.decodeAudioData(
          await file.arrayBuffer(),
        );
        const converted = resampleDecodedAudioToMonoPcm(decoded);
        const audioBuffer = audioContext.createBuffer(
          1,
          converted.length,
          AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ,
        );
        audioBuffer.getChannelData(0).set(converted);
        const media: SelectedReferenceMedia = {
          name: file.name,
          audioContext,
          audioBuffer,
          pcmData: audioBuffer.getChannelData(0),
          durationMs:
            (converted.length / AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ) * 1_000,
        };
        selectedReferenceMediaRef.current = media;
        setSelectedReferenceMedia(media);
        setReferenceMediaStatus(
          `${file.name} · ${(media.durationMs / 1_000).toFixed(1)} s · decoded locally to mono 48 kHz PCM; the source file is not uploaded or stored.`,
        );
      } catch (error) {
        if (audioContext.state !== "closed") void audioContext.close();
        setReferenceMediaStatus(
          `Could not decode an audio track from ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [],
  );

  const captureSelectedReferenceMedia = useCallback(async () => {
    const media = selectedReferenceMediaRef.current;
    if (!media || isCapturingReferenceMedia || !stimulusChannelCompatible)
      return;

    setIsCapturingReferenceMedia(true);
    setReferenceMediaStatus(
      `Tuning to the selected RF channel for ${media.name}…`,
    );
    try {
      await media.audioContext.resume();
      const artifact = await recordAudioSurveyReferenceRef.current({
        captureId: `media_${Date.now()}`,
        pcmData: media.pcmData,
        pcmSampleRateHz: AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ,
        ...(audioSignalLabelRef.current
          ? { audioSignalLabel: audioSignalLabelRef.current }
          : {}),
        ...(captureLabelsRef.current.length > 0
          ? { labels: captureLabelsRef.current }
          : {}),
        startPlayback: () => {
          const audioContext = media.audioContext;
          const contextNow = audioContext.currentTime;
          const wallClockNow = Date.now();
          const scheduledStart = contextNow + 0.1;
          const source = audioContext.createBufferSource();
          source.buffer = media.audioBuffer;
          source.connect(audioContext.destination);
          source.onended = () => {
            if (mediaPlaybackSourceRef.current === source) {
              mediaPlaybackSourceRef.current = null;
            }
          };
          mediaPlaybackSourceRef.current = source;
          source.start(scheduledStart);
          return wallClockNow + (scheduledStart - contextNow) * 1_000;
        },
      });
      setReferenceMediaStatus(
        artifact
          ? `Saved an aligned I/Q and PCM pair for ${media.name}.`
          : `No aligned reference pair was saved for ${media.name}.`,
      );
    } catch (error) {
      try {
        mediaPlaybackSourceRef.current?.stop();
      } catch {
        // A source that has naturally ended cannot be stopped again.
      }
      mediaPlaybackSourceRef.current = null;
      setReferenceMediaStatus(
        `Reference capture failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsCapturingReferenceMedia(false);
    }
  }, [isCapturingReferenceMedia, stimulusChannelCompatible]);

  const handleChooseVisionDisplay = async () => {
    setVisionDisplayError(null);
    try {
      const options = await getVisionDisplayOptions(window);
      setVisionDisplays(options.displays);
      setVisionDisplaySupported(options.supported);
      setSelectedVisionDisplayId(options.displays[0]?.id ?? "");
    } catch {
      setVisionDisplayError(
        "Display access was denied. Use browser display permission, then try again.",
      );
    }
  };

  const handleTrigger = async () => {
    if (
      durationError ||
      !stimulusChannelCompatible ||
      (previewMode === "vision" && visionCaptureBlockers.length > 0)
    ) {
      return;
    }
    if (previewMode === "vision") {
      try {
        await requestVisionFullscreen(
          document.documentElement,
          selectedVisionDisplay?.screen ?? null,
          window,
        );
      } catch (error) {
        setVisionDisplayError(
          error instanceof Error
            ? error.message
            : "Fullscreen presentation failed",
        );
        return;
      }
    }

    // Delay audio to start when capture officially starts
    // We send command after 3s, server takes ~0-1s, so ~4s total delay
    // But better to trigger playTone() when state becomes 'capturing'
    if (previewMode === "internal" || previewMode === "speech") {
      setScriptIndex(Math.floor(Math.random() * SCRIPT_VARIANTS.length));
    }

    setSelectedBaseline(previewMode);
    captureJobIdRef.current =
      startAnalysis(
        previewMode,
        isEphemeralCapture,
        durationS,
        undefined,
        undefined,
        undefined,
        previewMode === "vision"
          ? [
              ...captureLabels,
              ...(visionMockTestMode ? ["vision-test-only:mock-source"] : []),
              `vision-stimulus:${selectedVisionPreset}`,
              `vision-rgb:${VISION_PRESETS[selectedVisionPreset].join(",")}`,
            ]
          : captureLabels,
      ) ?? null;
  };

  // Tone trigger switch
  useEffect(() => {
    if (
      isCapturing &&
      stimulusChannelCompatible &&
      (previewMode === "audio" || previewMode === "internal")
    ) {
      return playTone();
    }
    setTonePlayback(null);
    return undefined;
  }, [isCapturing, previewMode, playTone, stimulusChannelCompatible]);

  return (
    <StimulusContainer>
      <StimulusPreview role="region" aria-label="Stimulus playback preview">
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
          <VisionContainer
            $isCapturing={isCapturing}
            $preset={selectedVisionPreset}
          />
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

      <StimulusContent role="region" aria-label="Stimulus controls">
        {previewMode === "audio" && (
          <ReferenceMediaControls>
            <SelectLabel htmlFor="reference-media-file">
              Local Reference Media
            </SelectLabel>
            <ReferenceMediaInput
              id="reference-media-file"
              aria-label="Reference media file"
              type="file"
              accept="audio/*,video/*"
              onChange={handleReferenceMediaSelection}
              disabled={isCapturingReferenceMedia}
            />
            <ReferenceMediaStatus aria-live="polite">
              {referenceMediaStatus}
            </ReferenceMediaStatus>
            <StimulusButton
              onClick={() => void captureSelectedReferenceMedia()}
              disabled={
                !selectedReferenceMedia ||
                isCapturingReferenceMedia ||
                !stimulusChannelCompatible
              }
            >
              {isCapturingReferenceMedia
                ? "CAPTURING MEDIA PAIR…"
                : "CAPTURE MEDIA PAIR"}
            </StimulusButton>
          </ReferenceMediaControls>
        )}

        {previewMode === "vision" && (
          <ReferenceMediaControls aria-label="Vision stimulus controls">
            <SelectLabel htmlFor="vision-stimulus-preset">
              Color screen
            </SelectLabel>
            <StimulusSelect
              id="vision-stimulus-preset"
              aria-label="Vision color screen"
              value={selectedVisionPreset}
              onChange={(event) => {
                const preset = event.target.value as VisionPreset;
                setSelectedVisionPreset(preset);
                setVisionPreset(preset);
              }}
              disabled={isBusy}
            >
              <option value="S">S · Violet/blue</option>
              <option value="M">M · Green</option>
              <option value="L">L · Yellow-green</option>
              <option value="Red">Red</option>
            </StimulusSelect>
            <StimulusButton
              type="button"
              onClick={() => void handleChooseVisionDisplay()}
              disabled={isBusy}
            >
              Choose display
            </StimulusButton>
            {visionDisplays.length > 0 && (
              <StimulusSelect
                aria-label="Vision display"
                value={selectedVisionDisplayId}
                onChange={(event) => {
                  setVisionDisplayError(null);
                  setSelectedVisionDisplayId(event.target.value);
                }}
                disabled={isBusy}
              >
                {visionDisplays.map((display) => (
                  <option key={display.id} value={display.id}>
                    {display.label}
                  </option>
                ))}
              </StimulusSelect>
            )}
            <StimulusSubtext aria-live="polite">
              {visionDisplayError ??
                (visionDisplays.length === 0
                  ? "Choose the physical display for the full-screen stimulus."
                  : visionDisplaySupported
                    ? "The selected display will be requested when you start the capture."
                    : "Move this app window to the desired display before starting.")}
            </StimulusSubtext>
          </ReferenceMediaControls>
        )}

        {!channelAccess.available && (
          <StimulusSubtext role="status" data-testid="stimulus-channel-unavailable">
            No valid channel prerequisite metadata is configured for this
            stimulus flow.
          </StimulusSubtext>
        )}

        <BaselineVectorContainer>
          <div>
            <SelectLabel htmlFor="stimulus-baseline-vector">
              Baseline Vector
            </SelectLabel>
            <StimulusSelect
              id="stimulus-baseline-vector"
              aria-label="Baseline Vector"
              value={previewMode}
              onChange={(e) => {
                const nextMode = e.target.value as AnalysisType;
                setPreviewMode(nextMode);
                setSelectedBaseline(nextMode);
              }}
              disabled={isBusy}
            >
              {baselineOptions.map((option) => {
                const requiredChannels = getChannelPrerequisite(
                  `demod.stimulus.${option.value}` as DemodFlowId,
                  channels,
                ).channelLabels;
                return (
                  <option
                    key={option.value}
                    value={option.value}
                    data-required-channels={requiredChannels.join(",")}
                  >
                  {option.label} · {describeRequiredChannels(option.value, channels)}
                  </option>
                );
              })}
            </StimulusSelect>
          </div>
          <BaselineActionRow>
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
              />
            </div>
            <StimulusButton onClick={handleTrigger} disabled={triggerDisabled}>
              {triggerDisabled && (
                <AlertTriangle
                  aria-hidden="true"
                  data-testid="trigger-warning-icon"
                  size={14}
                />
              )}
              TRIGGER
            </StimulusButton>
          </BaselineActionRow>
        </BaselineVectorContainer>

        {previewMode === "vision" && visionCaptureBlockers.length > 0 && (
          <StimulusSubtext role="status" data-testid="vision-capture-readiness">
            {visionCaptureBlockers.join(" ")}
          </StimulusSubtext>
        )}

        {visionMockTestMode && (
          <StimulusSubtext role="note" data-testid="vision-mock-test-notice">
            {activeSource?.name ?? "Mock SDR"} test mode: this capture is
            ephemeral and will not be saved as a training reference.
          </StimulusSubtext>
        )}

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

        <CaptureLabelControl>
          <SelectLabel htmlFor="stimulus-capture-label">
            Capture Labels
          </SelectLabel>
          <StimulusInput
            id="stimulus-capture-label"
            type="text"
            aria-label="Add capture label"
            aria-describedby="stimulus-capture-label-help"
            placeholder="Type a label and press Enter"
            maxLength={80}
            value={captureLabelDraft}
            onChange={(event) => setCaptureLabelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCaptureLabel(captureLabelDraft);
              }
            }}
            disabled={captureLabels.length >= 32}
          />
          <StimulusSubtext id="stimulus-capture-label-help">
            {liveMode
              ? "Ephemeral RF captures are discarded; retained captures include these labels."
              : "Labels are saved with retained captures for any stimulus option."}
          </StimulusSubtext>
          {captureLabels.length > 0 && (
            <CaptureLabelPills aria-label="Capture labels">
              {captureLabels.map((label) => (
                <CaptureLabelPill key={label}>
                  {label}
                  <CaptureLabelRemove
                    type="button"
                    aria-label={`Remove label ${label}`}
                    onClick={() => removeCaptureLabel(label)}
                  >
                    ×
                  </CaptureLabelRemove>
                </CaptureLabelPill>
              ))}
            </CaptureLabelPills>
          )}
        </CaptureLabelControl>

        {previewMode === "audio" && (
          <AudioWaveformControl>
            <SelectLabel htmlFor="audio-signal-label">
              Audio Signal Label
            </SelectLabel>
            <StimulusSelect
              id="audio-signal-label"
              aria-label="Audio signal label"
              value={audioSignalLabel}
              onChange={(event) =>
                setAudioSignalLabel(
                  event.target.value as AudioSurveyReferenceLabel | "",
                )
              }
              disabled={isBusy || isCapturingReferenceMedia}
            >
              <option value="">Unlabeled</option>
              <option value="coherent">Coherent</option>
              <option value="static">Static</option>
            </StimulusSelect>
          </AudioWaveformControl>
        )}

        <StimulusLabel>
          <input
            type="checkbox"
            checked={isEphemeralCapture}
            onChange={(e) => setLiveMode(e.target.checked)}
            disabled={isBusy || visionMockTestMode}
          />
          {visionMockTestMode
            ? "MOCK TEST (EPHEMERAL)"
            : "LIVE CAPTURE (EPHEMERAL)"}
        </StimulusLabel>

        <StimulusSubtext>
          {visionMockTestMode
            ? "Mock test captures are discarded and cannot train the visual decoder."
            : data.subtext ||
              "Capture N-APT signals with a known baseline for demod later. Media is played while recording in order to learn what is where."}
        </StimulusSubtext>

        {analysisSession.state === "result" && (
          <ResetButton onClick={clearAnalysis}>Reset Session</ResetButton>
        )}
      </StimulusContent>
    </StimulusContainer>
  );
};
