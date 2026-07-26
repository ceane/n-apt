import React from "react";
import styled from "styled-components";
import { Columns3Cog } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  setFftWindow,
  setFrequencyRange,
  setPowerScale,
  setTemporalResolution,
} from "@n-apt/redux";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useLiveSampleRateControl } from "@n-apt/hooks/useLiveSampleRateControl";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useSpectrumTransport } from "@n-apt/hooks/useSpectrumTransport";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import {
  resolveSourceDisplaySampleRate,
  resolveSourceDisplaySignalArea,
  resolveWholeChannelSampleRate,
} from "@n-apt/utils/sourceSignalDisplay";

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
  const channels = useAppSelector((state) => state.websocket.channels ?? []);
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const reduxActiveSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea,
  );
  const {
    state: liveSpectrumState,
    dispatch: spectrumStoreDispatch,
    wsConnection,
    sampleRateHzEffective,
  } = useSpectrumStore();
  const activeSignalArea = resolveSourceDisplaySignalArea({
    liveSignalArea: liveSpectrumState.activeSignalArea,
    reduxSignalArea: reduxActiveSignalArea,
  });
  const { sdrSettings, backend, deviceProfile, sampleRateOptions } =
    wsConnection;
  const sourceSdrSettings = roleSource?.sdr.settings ?? sdrSettings;
  const sourceBackend = roleSource?.kind ?? backend;
  const sourceSampleRate = resolveSourceDisplaySampleRate({
    roleSourceId: roleSource?.id,
    activeSourceId,
    localSampleRateHz: spectrum.sampleRateHz,
    liveSampleRateHz: sampleRateHzEffective,
    sourceSampleRateHz: roleSource?.sdr.settings?.sample_rate,
    fallbackSampleRateHz: spectrum.sampleRateHz,
  });
  const sourceSampleRateValue = sourceSampleRate ?? 3_200_000;
  const sourceMaxSampleRate =
    roleSource?.sdr.max_sample_rate ?? sampleRateHzEffective ?? 3_200_000;
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
    minReceiveSampleRate: sourceSdrSettings?.min_receive_sample_rate,
    sampleRateOptions: sourceSampleRateOptions,
    sdrSettings: sourceSdrSettings,
    deviceType: roleSource?.kind ?? deviceProfile?.kind,
    onSettingsChange:
      data.sourceRole === "tx" ? undefined : wsConnection.sendSettings,
  });
  const applyFrequencyRange = React.useCallback(
    (range: { min: number; max: number }) => {
      spectrumStoreDispatch({ type: "SET_FREQUENCY_RANGE", range });
      dispatch(setFrequencyRange(range));
      spectrumTransport.sendFrequencyRange(range);
    },
    [dispatch, spectrumStoreDispatch, wsConnection],
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
    frequencyRange: liveSpectrumState.frequencyRange ?? spectrum.frequencyRange,
    sampleRateHz: sourceSampleRateValue,
    fftSize: spectrum.fftSize,
    maxFrameRateLimit: settings.maxFrameRate,
    setSampleRate: settings.setSampleRate,
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
        minReceiveSampleRate={sourceSdrSettings?.min_receive_sample_rate}
        sampleRate={sourceSampleRateValue}
        sampleRateOptions={settings.sampleRateOptions}
        wholeChannelSampleRate={wholeChannelSampleRate}
        fileCapturedRange={null}
        fftFrameRate={settings.fftFrameRate}
        maxFrameRate={settings.maxFrameRate}
        fftSize={spectrum.fftSize}
        fftSizeOptions={settings.fftSizeOptions}
        fftWindow={spectrum.fftWindow || "Rectangular"}
        temporalResolution={spectrum.displayTemporalResolution}
        backend={sourceBackend}
        deviceProfile={deviceProfile}
        powerScale={spectrum.powerScale}
        onFftFrameRateChange={settings.setFftFrameRate}
        onFftSizeChange={settings.setFftSize}
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
        hackrfCurrentSampleRate={sampleRateHzEffective || spectrum.sampleRateHz}
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
