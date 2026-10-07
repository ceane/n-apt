import React from "react";
import styled from "styled-components";
import { Columns3Cog } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import {
  setFftWindow,
  setFrequencyRange,
  setPowerScale,
  setRemoveDcSpike,
  setSampleRate,
  setTemporalResolution,
} from "@n-apt/redux";
import { useSdrSettings } from "@n-apt/settings/public/useSdrSettings";
import { useLiveSampleRateControl } from "@n-apt/spectrum/public/useLiveSampleRateControl";
import { useSpectrumStore } from "@n-apt/spectrum/public/useSpectrumStore";
import { useSpectrumTransport } from "@n-apt/spectrum/public/useSpectrumTransport";
import { SignalDisplaySection } from "@n-apt/spectrum/public/SignalDisplaySection";
import { SourceSettingsSection } from "@n-apt/spectrum/public/SourceSettingsSection";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { selectArrayOrEmpty } from "@n-apt/redux/selectors/stableSelectorDefaults";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import {
  subscribeRawIqFrameArrivals,
} from "@n-apt/app/infrastructure/visualization/frameArrivalRuntime";
import {
  appendCaptureQualityFrameWindow,
  DEMODULATION_QUALITY_PROFILE,
  evaluateCaptureQuality,
  getCaptureQualityFrameWindow,
  rememberCaptureQualityFrameWindow,
  type CaptureQualityFrame,
} from "@n-apt/features/capture/quality";
import { DEMOD_REQUIRED_TEMPORAL_RESOLUTION } from "@n-apt/demodulation/utils/demodQuality";
import {
  resolveSourceDisplaySampleRate,
  resolveSourceDisplaySignalArea,
  resolveWholeChannelSampleRate,
} from "@n-apt/app/infrastructure/visualization/sourceSignalDisplay";

const QUALITY_FRAME_PUBLISH_INTERVAL_MS = 100;
let isSignalConfigModuleHotReplacing = false;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    isSignalConfigModuleHotReplacing = true;
  });
}

const toCaptureQualityFrame = ({
  value,
  selectedSourceId,
  sourceStatus,
  fftSize,
  fftWindow,
}: {
  value: unknown;
  selectedSourceId: string;
  sourceStatus: string | null;
  fftSize: number | undefined;
  fftWindow: string | undefined;
}): CaptureQualityFrame | null => {
  if (!value || typeof value !== "object") return null;
  const frame = value as Partial<IqRawFrame>;
  if (
    frame.type !== "spectrum" ||
    frame.data_type !== "iq_raw" ||
    !(frame.iq_data instanceof Uint8Array) ||
    frame.iq_data.byteLength < 4 ||
    frame.iq_data.byteLength % 2 !== 0 ||
    frame.source_id !== selectedSourceId ||
    !Number.isSafeInteger(frame.stream_epoch) ||
    !Number.isSafeInteger(frame.sequence) ||
    !Number.isFinite(frame.sample_rate) ||
    !Number.isFinite(frame.center_frequency_hz) ||
    !Number.isInteger(fftSize) ||
    !fftWindow
  ) {
    return null;
  }

  const status = frame.frame_status ?? sourceStatus;
  if (
    frame.is_fresh === false ||
    (status !== "receiving" && status !== "streaming")
  ) {
    return null;
  }

  return {
    sourceId: selectedSourceId,
    streamEpoch: frame.stream_epoch!,
    sequence: frame.sequence!,
    timestampMs:
      typeof frame.timestamp === "number" && Number.isFinite(frame.timestamp)
        ? frame.timestamp
        : Date.now(),
    status: "receiving",
    sampleRateHz: frame.sample_rate!,
    centerFrequencyHz: frame.center_frequency_hz!,
    fftSize: fftSize!,
    window: fftWindow,
    acquiredSampleCount: frame.iq_data.byteLength / 2,
    rawIqByteCount: frame.iq_data.byteLength,
  };
};

const NodeContent = styled.div`
  width: 100%;
  min-width: 360px;

  & > div {
    grid-template-columns: 1fr 1fr;
  }

  & > div > div {
    margin-top: 0;
  }

  & > div > div:not(:first-child) {
    background: transparent;
    border: none;
    border-radius: 0;
  }

  & > div:nth-of-type(4) > div:first-child {
    margin-top: 16px;
  }
`;

const NodeHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: 700;
`;

const NodeSubtitle = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
`;

interface SignalConfigNodeProps {
  data: {
    signalOptions: boolean;
    label: string;
    sourceRole?: "rx" | "tx";
    sourceBindingGroup?: string;
  };
}

export const SignalConfigNode: React.FC<SignalConfigNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const { setDemodQualityStatus } = useDemod();
  const spectrumTransport = useSpectrumTransport();
  const spectrum = useAppSelector((state) => state.spectrum);
  const roleSource = useAppSelector((state) => {
    const sourceId =
      data.sourceRole && data.sourceBindingGroup
        ? state.sourceRouting.bindings[
            sourceBindingKey(data.sourceBindingGroup, data.sourceRole)
          ]
        : state.websocket.activeSourceId;
    return (state.websocket.sources ?? []).find(
      (source) => source.id === sourceId,
    );
  });
  const channels = useAppSelector((state) =>
    selectArrayOrEmpty(state.websocket.channels),
  );
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const websocketPaused = useAppSelector(
    (state) => state.websocket.isPaused,
  );
  const reduxActiveSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea,
  );
  const reduxFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const reduxSampleRateHz = useAppSelector(
    (state) => state.spectrum.sampleRateHz,
  );
  const {
    wsConnection,
    manualVisualizerPaused,
    selectedSourceId,
  } = useSpectrumStore();
  const activeSignalArea = resolveSourceDisplaySignalArea({
    liveSignalArea: reduxActiveSignalArea,
    reduxSignalArea: reduxActiveSignalArea,
  });
  const { sdrSettings, backend, deviceProfile, sampleRateOptions } =
    wsConnection;

  const sourceStatus = useAppSelector((state) => roleSource ? state.websocket.sourceStatuses[roleSource.id] ?? roleSource.status : null);
  const appliedStreamOptions = useAppSelector((state) =>
    roleSource
      ? state.websocket.appliedStreamOptionsBySource[roleSource.id]
      : undefined,
  );
  const appliedRxOptions =
    appliedStreamOptions?.options.mode === "rx"
      ? appliedStreamOptions.options
      : null;
  const sourceMode = "live" as const;
  const sourceReceiving =
    sourceStatus === "receiving" || sourceStatus === "streaming";
  const sourcePaused = Boolean(
    roleSource &&
      (roleSource.paused ||
        sourceStatus === "paused" ||
        (roleSource.id === selectedSourceId && manualVisualizerPaused) ||
        (roleSource.id === activeSourceId && websocketPaused)),
  );
  const qualityFrameWindowScope = [
    roleSource?.id ?? "no-source",
    appliedStreamOptions?.optionsRevision ?? "no-revision",
    appliedStreamOptions?.streamEpoch ?? "no-epoch",
    appliedRxOptions?.fftSize ?? roleSource?.sdr.settings.fft_size ?? "no-fft",
    appliedRxOptions?.fftWindow ?? roleSource?.sdr.settings.fft_window ?? spectrum.fftWindow,
  ].join(":");
  const initialQualityFrameWindow = getCaptureQualityFrameWindow(
    qualityFrameWindowScope,
  );
  const [qualityFrames, setQualityFrames] = React.useState<CaptureQualityFrame[]>(
    initialQualityFrameWindow,
  );
  const [qualityNowTimestampMs, setQualityNowTimestampMs] = React.useState(
    () => Date.now(),
  );
  const qualityFrameHistoryRef = React.useRef<CaptureQualityFrame[]>(
    initialQualityFrameWindow,
  );
  const qualityFrameHistoryScopeRef = React.useRef(qualityFrameWindowScope);
  const initialLatestQualityFrame =
    initialQualityFrameWindow[initialQualityFrameWindow.length - 1];
  const lastQualityFrameKeyRef = React.useRef<string | null>(
    initialLatestQualityFrame
      ? `${initialLatestQualityFrame.sourceId}:${initialLatestQualityFrame.streamEpoch}:${initialLatestQualityFrame.sequence}`
      : null,
  );
  const qualityFramePublishTimerRef = React.useRef<number | null>(null);
  const lastPublishedQualityStatusRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    dispatch(setTemporalResolution(DEMOD_REQUIRED_TEMPORAL_RESOLUTION));
  }, [dispatch]);

  const sourceSdrSettings = roleSource?.sdr.settings ?? sdrSettings;
  const sourceBackend = roleSource?.kind ?? backend;
  const sourceSampleRate = resolveSourceDisplaySampleRate({
    roleSourceId: roleSource?.id,
    activeSourceId,
    localSampleRateHz: spectrum.sampleRateHz,
    liveSampleRateHz: reduxSampleRateHz,
    sourceSampleRateHz: roleSource?.sdr.settings?.sample_rate,
    fallbackSampleRateHz: spectrum.sampleRateHz,
  });
  const sourceSampleRateValue = sourceSampleRate ?? 3_200_000;
  const sourceMaxSampleRate =
    roleSource?.sdr.max_sample_rate ?? reduxSampleRateHz ?? 3_200_000;
  const sourceSampleRateOptions =
    roleSource?.sdr.sample_rate_options ?? sampleRateOptions;
  const wholeChannelSampleRate = resolveWholeChannelSampleRate({
    source: roleSource,
    activeSignalArea,
    channels,
  });
  const activeSignalAreaBounds = React.useMemo(() => {
    if (!activeSignalArea) return null;
    const normalizedArea = activeSignalArea.toLowerCase();
    const channel = channels.find(
      (candidate) => candidate.label?.toLowerCase() === normalizedArea,
    );
    if (
      !channel ||
      !Number.isFinite(channel.min_hz) ||
      !Number.isFinite(channel.max_hz) ||
      channel.max_hz <= channel.min_hz
    ) {
      return null;
    }
    return { min: channel.min_hz, max: channel.max_hz };
  }, [activeSignalArea, channels]);

  const settings = useSdrSettings({
    maxSampleRate: sourceMaxSampleRate,
    currentSampleRateHz: sourceSampleRateValue,
    minReceiveSampleRate:
      sourceSdrSettings?.min_receive_sample_rate ?? undefined,
    sampleRateOptions: sourceSampleRateOptions,
    sdrSettings: sourceSdrSettings,
    deviceType: roleSource?.kind ?? deviceProfile?.kind,
    onSettingsChange:
      data.sourceRole === "tx" ? undefined : wsConnection.sendSettings,
  });
  const demodFftSizeOptions = settings.fftSizeOptions.filter((size) => size >= DEMODULATION_QUALITY_PROFILE.minimumConfiguredFftSize!);
  const setDemodFftSize = React.useCallback((size: number) => {
    if (size < DEMODULATION_QUALITY_PROFILE.minimumConfiguredFftSize!) return;
    settings.setFftSize(size);
  }, [settings.setFftSize]);
  const setDemodFrameRate = React.useCallback((rate: number) => {
    if (rate < DEMODULATION_QUALITY_PROFILE.minimumConfiguredFrameRateHz!) return;
    settings.setFftFrameRate(rate);
  }, [settings.setFftFrameRate]);
  React.useEffect(() => {
    if (qualityFrameHistoryScopeRef.current !== qualityFrameWindowScope) {
      qualityFrameHistoryScopeRef.current = qualityFrameWindowScope;
      qualityFrameHistoryRef.current = getCaptureQualityFrameWindow(
        qualityFrameWindowScope,
      );
      const latest =
        qualityFrameHistoryRef.current[
          qualityFrameHistoryRef.current.length - 1
        ];
      lastQualityFrameKeyRef.current = latest
        ? `${latest.sourceId}:${latest.streamEpoch}:${latest.sequence}`
        : null;
      setQualityFrames([...qualityFrameHistoryRef.current]);
    }
    setQualityNowTimestampMs(Date.now());

    if (
      data.sourceRole === "tx" ||
      !roleSource?.id ||
      sourceMode !== "live" ||
      sourcePaused ||
      !sourceReceiving
    ) {
      return;
    }

    const selectedId = roleSource.id;
    const appliedRevision = appliedStreamOptions?.optionsRevision;
    const appliedEpoch = appliedStreamOptions?.streamEpoch;
    const appliedOptions = appliedRxOptions;
    const fftSize =
      appliedOptions?.fftSize ?? roleSource.sdr.settings.fft_size;
    const fftWindow =
      appliedOptions?.fftWindow ??
      roleSource.sdr.settings.fft_window ??
      spectrum.fftWindow;
    const fallbackFrameStatus = sourceReceiving ? "receiving" : sourceStatus;
    const publishPendingFrames = () => {
      qualityFramePublishTimerRef.current = null;
      setQualityFrames([...qualityFrameHistoryRef.current]);
      setQualityNowTimestampMs(Date.now());
    };

    const unsubscribe = subscribeRawIqFrameArrivals((value) => {
      const frameValue = Array.isArray(value) ? value[value.length - 1] : value;
      if (!frameValue || typeof frameValue !== "object") return;
      const frame = frameValue as Partial<IqRawFrame>;
      if (
        appliedRevision !== undefined &&
        typeof frame.options_revision === "number" &&
        (frame.options_revision !== appliedRevision ||
          (appliedEpoch !== undefined && frame.stream_epoch !== appliedEpoch))
      ) {
        return;
      }

      const qualityFrame = toCaptureQualityFrame({
        value: frameValue,
        selectedSourceId: selectedId,
        sourceStatus: fallbackFrameStatus,
        fftSize,
        fftWindow,
      });
      if (!qualityFrame) return;

      const key = `${qualityFrame.sourceId}:${qualityFrame.streamEpoch}:${qualityFrame.sequence}`;
      if (lastQualityFrameKeyRef.current === key) return;
      lastQualityFrameKeyRef.current = key;
      qualityFrameHistoryRef.current = appendCaptureQualityFrameWindow(
        qualityFrameHistoryRef.current,
        qualityFrame,
      );
      rememberCaptureQualityFrameWindow(
        qualityFrameWindowScope,
        qualityFrameHistoryRef.current,
      );

      // Keep every received frame for cadence and loss checks, but refresh the
      // React node at 10 Hz instead of rendering once per radio frame.
      if (qualityFramePublishTimerRef.current === null) {
        qualityFramePublishTimerRef.current = window.setTimeout(
          publishPendingFrames,
          QUALITY_FRAME_PUBLISH_INTERVAL_MS,
        );
      }
    });

    return () => {
      unsubscribe();
      if (qualityFramePublishTimerRef.current !== null) {
        window.clearTimeout(qualityFramePublishTimerRef.current);
        qualityFramePublishTimerRef.current = null;
      }
    };
  }, [
    appliedRxOptions,
    appliedStreamOptions,
    data.sourceRole,
    qualityFrameWindowScope,
    roleSource?.id,
    roleSource?.sdr.settings.fft_size,
    roleSource?.sdr.settings.fft_window,
    sourceMode,
    sourcePaused,
    sourceReceiving,
    spectrum.fftWindow,
  ]);

  React.useEffect(() => {
    const latestFrame = qualityFrames[qualityFrames.length - 1];
    if (!latestFrame || sourcePaused) return;
    const staleAtMs =
      latestFrame.timestampMs +
      DEMODULATION_QUALITY_PROFILE.maximumFrameGapMs +
      QUALITY_FRAME_PUBLISH_INTERVAL_MS;
    if (qualityNowTimestampMs >= staleAtMs) return;
    const timeout = window.setTimeout(
      () => setQualityNowTimestampMs(Date.now()),
      Math.max(1, staleAtMs - qualityNowTimestampMs),
    );
    return () => window.clearTimeout(timeout);
  }, [qualityFrames, qualityNowTimestampMs, sourcePaused]);

  const demodQuality = React.useMemo(() => evaluateCaptureQuality({
    profile: DEMODULATION_QUALITY_PROFILE,
    selectedSourceId: roleSource?.id ?? null,
    sourceMode,
    source: roleSource ? {
      id: roleSource.id,
      capability: roleSource.capability,
      isMock: Boolean(roleSource.is_mock || roleSource.capability === "mock"),
      connected: Boolean(wsConnection.isConnected) && sourceStatus !== "disconnected" && sourceStatus !== "stale" && sourceStatus !== "error",
      receiving: sourceReceiving,
      paused: sourcePaused,
      maxSampleRateHz: roleSource.capabilities?.max_sample_rate ?? roleSource.sdr.max_sample_rate,
      minSampleRateHz: roleSource.sdr.settings.min_receive_sample_rate ?? undefined,
      fftSizes: roleSource.capabilities?.fft?.sizes,
      maxFrameRateHz: roleSource.capabilities?.fft?.max_frame_rate ?? settings.maxFrameRate,
    } : null,
    requested: { sampleRateHz: sourceSampleRate ?? undefined, fftSize: spectrum.fftSize, frameRateHz: settings.fftFrameRate, window: spectrum.fftWindow, temporalResolution: spectrum.displayTemporalResolution },
    configured: {
      sampleRateHz: appliedRxOptions?.sampleRateHz ?? roleSource?.sdr.settings.sample_rate,
      fftSize: appliedRxOptions?.fftSize ?? roleSource?.sdr.settings.fft_size,
      frameRateHz: appliedRxOptions?.frameRate ?? roleSource?.sdr.settings.frame_rate,
      window: appliedRxOptions?.fftWindow ?? roleSource?.sdr.settings.fft_window,
      temporalResolution: spectrum.displayTemporalResolution,
    },
    frames: qualityFrames,
    nowTimestampMs: qualityNowTimestampMs,
  }), [
    appliedRxOptions,
    qualityFrames,
    qualityNowTimestampMs,
    roleSource,
    sourceMode,
    sourcePaused,
    sourceReceiving,
    sourceStatus,
    wsConnection.isConnected,
    sourceSampleRate,
    spectrum.fftSize,
    spectrum.fftWindow,
    spectrum.displayTemporalResolution,
    settings.fftFrameRate,
    settings.maxFrameRate,
  ]);
  React.useEffect(() => {
    if (data.sourceRole === "tx") {
      if (lastPublishedQualityStatusRef.current !== "none") {
        lastPublishedQualityStatusRef.current = "none";
        setDemodQualityStatus(null);
      }
      return;
    }

    const status = {
      fit: demodQuality.fit,
      reasons: demodQuality.reasons,
    };
    const signature = JSON.stringify(status);
    if (lastPublishedQualityStatusRef.current === signature) return;
    lastPublishedQualityStatusRef.current = signature;
    setDemodQualityStatus(status);
  }, [data.sourceRole, demodQuality.fit, demodQuality.reasons, setDemodQualityStatus]);
  React.useEffect(
    () => () => {
      if (isSignalConfigModuleHotReplacing) return;
      lastPublishedQualityStatusRef.current = null;
      setDemodQualityStatus(null);
    },
    [setDemodQualityStatus],
  );
  const applyFrequencyRange = React.useCallback(
    (range: { min: number; max: number }) => {
      dispatch(setFrequencyRange(range));
      spectrumTransport.sendFrequencyRange(range);
    },
    [dispatch, spectrumTransport, wsConnection],
  );
  const setSampleRateForVisualizer = React.useCallback(
    (rate: number, nextRange?: { min: number; max: number }) => {
      dispatch({
        ...setSampleRate(rate),
        ...(nextRange
          ? { meta: { managedRxFrequencyRange: nextRange } }
          : {}),
      });
      settings.setSampleRate(rate);
    },
    [dispatch, settings.setSampleRate],
  );
  const { handleSampleRateChange } = useLiveSampleRateControl({
    sourceMode: "live",
    supportsWholeChannelSampleRate:
      Boolean(wholeChannelSampleRate) &&
      sourceBackend !== "rtl_sdr" &&
      sourceBackend !== "rtl-sdr",
    manualSampleRateOptions: settings.sampleRateOptions,
    activeChannelSampleRate: wholeChannelSampleRate,
    maxSampleRateHz: sourceMaxSampleRate,
    activeSignalAreaBounds,
    frequencyRange: reduxFrequencyRange ?? spectrum.frequencyRange,
    sampleRateHz: sourceSampleRateValue,
    fftSize: spectrum.fftSize,
    maxFrameRateLimit: settings.maxFrameRate,
    setSampleRate: setSampleRateForVisualizer,
    setSampleRateWithFrequencyRange: setSampleRateForVisualizer,
    setFftFrameRate: settings.setFftFrameRate,
    applyFrequencyRange,
  });

  return (
    <NodeContent>
      <NodeHeader>
        <Columns3Cog size={16} />
        {data.label}
      </NodeHeader>
      <NodeSubtitle>Hardware sampling and FFT settings</NodeSubtitle>

      <SignalDisplaySection
        variant="default"
        sourceMode="live"
        maxSampleRate={sourceMaxSampleRate}
        minReceiveSampleRate={
          sourceSdrSettings?.min_receive_sample_rate ?? undefined
        }
        sampleRate={sourceSampleRateValue}
        sampleRateOptions={settings.sampleRateOptions}
        wholeChannelSampleRate={wholeChannelSampleRate}
        fileCapturedRange={null}
        fftFrameRate={settings.fftFrameRate}
        maxFrameRate={settings.maxFrameRate}
        fftSize={spectrum.fftSize}
        fftSizeOptions={demodFftSizeOptions}
        fftWindow={spectrum.fftWindow || "Rectangular"}
        temporalResolution={spectrum.displayTemporalResolution}
        backend={sourceBackend}
        deviceProfile={deviceProfile}
        powerScale={spectrum.powerScale}
        onFftFrameRateChange={setDemodFrameRate}
        onFftSizeChange={setDemodFftSize}
        onSampleRateChange={handleSampleRateChange}
        onFftWindowChange={(value) => {
          dispatch(setFftWindow(value));
          settings.setFftWindow(value);
        }}
        onTemporalResolutionChange={(value) => {
          dispatch(setTemporalResolution(value));
        }}
        onPowerScaleChange={(value) => {
          dispatch(setPowerScale(value));
        }}
        removeDcSpike={spectrum.removeDcSpike}
        onRemoveDcSpikeChange={(enabled) => {
          dispatch(setRemoveDcSpike(enabled));
        }}
        scheduleCoupledAdjustment={settings.scheduleCoupledAdjustment}
      />

      <SourceSettingsSection
        sourceMode="live"
        deviceType={deviceProfile?.kind}
        ppm={settings.ppm}
        gain={settings.gain}
        hackrfLnaGain={settings.hackrfLnaGain}
        hackrfVgaGain={settings.hackrfVgaGain}
        hackrfAmpEnabled={settings.hackrfAmpEnabled}
        hackrfBasebandBandwidth={settings.hackrfBasebandBandwidth}
        hackrfCurrentSampleRate={reduxSampleRateHz || spectrum.sampleRateHz}
        tunerAGC={settings.tunerAGC}
        rtlAGC={settings.rtlAGC}
        stitchSourceSettings={{ gain: settings.gain, ppm: settings.ppm }}
        isConnected={Boolean(wsConnection.isConnected)}
        onPpmChange={settings.setPpm}
        onGainChange={settings.setGain}
        onHackrfLnaGainChange={settings.setHackrfLnaGain}
        onHackrfVgaGainChange={settings.setHackrfVgaGain}
        onHackrfAmpEnabledChange={settings.setHackrfAmpEnabled}
        onHackrfBasebandBandwidthChange={settings.setHackrfBasebandBandwidth}
        onTunerAGCChange={settings.setTunerAGC}
        onRtlAGCChange={settings.setRtlAGC}
        onStitchSourceSettingsChange={() => undefined}
        onAgcModeChange={(tunerAGC, rtlAGC) => {
          settings.setTunerAGC(tunerAGC);
          settings.setRtlAGC(rtlAGC);
        }}
      />
    </NodeContent>
  );
};
