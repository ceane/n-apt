import React from "react";
import styled from "styled-components";
import { Columns3Cog } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  setFftWindow,
  setPowerScale,
  setTemporalResolution,
} from "@n-apt/redux";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";

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
  data: { signalOptions: boolean; label: string };
}

export const SignalConfigNode: React.FC<SignalConfigNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const spectrum = useAppSelector((state) => state.spectrum);
  const { wsConnection, sampleRateHzEffective } = useSpectrumStore();
  const { sdrSettings, backend, deviceProfile, sampleRateOptions } =
    wsConnection;

  const settings = useSdrSettings({
    maxSampleRate: sampleRateHzEffective || 3_200_000,
    currentSampleRateHz: sampleRateHzEffective || spectrum.sampleRateHz,
    minReceiveSampleRate: sdrSettings?.min_receive_sample_rate,
    sampleRateOptions,
    sdrSettings,
    deviceType: deviceProfile?.kind,
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
        maxSampleRate={sampleRateHzEffective || 3_200_000}
        minReceiveSampleRate={sdrSettings?.min_receive_sample_rate}
        sampleRate={spectrum.sampleRateHz}
        sampleRateOptions={settings.sampleRateOptions}
        fileCapturedRange={null}
        fftFrameRate={settings.fftFrameRate}
        maxFrameRate={settings.maxFrameRate}
        fftSize={spectrum.fftSize}
        fftSizeOptions={settings.fftSizeOptions}
        fftWindow={spectrum.fftWindow || "Rectangular"}
        temporalResolution={spectrum.displayTemporalResolution}
        backend={backend}
        deviceProfile={deviceProfile}
        powerScale={spectrum.powerScale}
        onFftFrameRateChange={settings.setFftFrameRate}
        onFftSizeChange={settings.setFftSize}
        onSampleRateChange={settings.setSampleRate}
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
