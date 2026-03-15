import React, { useCallback } from "react";
import styled from "styled-components";
import { useSpectrumStore, LIVE_CONTROL_DEFAULTS } from "@n-apt/hooks/useSpectrumStore";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";

import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import { ConnectionStatusSection, PauseButton } from "@n-apt/components/sidebar/ConnectionStatusSection";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { usePrompt } from "@n-apt/components/ui";

const SidebarContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: 0 24px 24px 24px;
  box-sizing: border-box;
  max-width: 100%;
`;

const Section = styled.div<{ $marginBottom?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "0"};
  box-sizing: border-box;
  width: 100%;
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? (props.theme.fileMode || "#d9aa34") : (props.theme.metadataLabel || "#555"))};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
`;

const MultiFrameButton = styled(PauseButton)`
  width: 100%;
  margin-top: 8px;
  background-color: #00d4ff1a;
  border-color: #00d4ff44;
  color: #00d4ff;

  &:hover {
    background-color: #00d4ff2a;
    border-color: #00d4ff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const DiagnosticStatusDisplay = styled.div`
  grid-column: 1 / -1;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  color: #888;
  padding: 4px 12px;
  margin-top: -8px;
  border-left: 2px solid #333;
`;

export const SDRTestSidebar: React.FC = () => {
  const {
    state,
    dispatch,
    effectiveSdrSettings,
    sampleRateHzEffective,
    toggleVisualizerPause,
    cryptoCorrupted,
    deviceName,
    deviceProfile,
    wsConnection: {
      isConnected,
      deviceState,
      backend,
      deviceLoadingReason,
      maxSampleRateHz,
      sendSettings,
      sendRestartDevice,
      autoFftOptions,
      sendPowerScaleCommand: _sendPowerScaleCommand,
    },
  } = useSpectrumStore();

  const showPrompt = usePrompt();

  const maxSampleRate = sampleRateHzEffective ?? maxSampleRateHz ?? 0;

  const {
    fftSize,
    fftWindow,
    fftFrameRate,
    maxFrameRate,
    gain,
    ppm,
    tunerAGC,
    rtlAGC,
    setFftSize,
    setFftFrameRate,
    setGain,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    setFftWindow,
    scheduleCoupledAdjustment,
  } = useSdrSettings({
    maxSampleRate,
    sdrSettings: effectiveSdrSettings ?? null,
    onSettingsChange: (settings) => {
      sendSettings(settings);
    },
  });

  const resetLiveControls = useCallback(() => {
    const recommendedFftSize = autoFftOptions?.recommended ?? state.fftSize;
    const recommendedFrameRate = Math.max(
      1,
      Math.min(maxFrameRate, state.fftFrameRate),
    );

    dispatch({
      type: "RESET_LIVE_CONTROLS",
      fftSize: recommendedFftSize,
      fftFrameRate: recommendedFrameRate,
    });

    sendSettings({
      fftSize: recommendedFftSize,
      fftWindow: LIVE_CONTROL_DEFAULTS.fftWindow,
      frameRate: recommendedFrameRate,
      gain: LIVE_CONTROL_DEFAULTS.gain,
      ppm: LIVE_CONTROL_DEFAULTS.ppm,
      tunerAGC: LIVE_CONTROL_DEFAULTS.tunerAGC,
      rtlAGC: LIVE_CONTROL_DEFAULTS.rtlAGC,
    });
  }, [autoFftOptions?.recommended, dispatch, maxFrameRate, sendSettings, state.fftFrameRate, state.fftSize]);

  return (
    <SidebarContent>
      <Section>
        <SectionTitle $fileMode={state.sourceMode === "file"}>
          Source
        </SectionTitle>
        <SourceInput
          sourceMode={state.sourceMode}
          backend={backend}
          deviceName={deviceName}
          onSourceModeChange={(mode) =>
            dispatch({
              type: "SET_SOURCE_MODE",
              mode,
            })
          }
        />
      </Section>

      {state.sourceMode === "live" && (
        <>
          <ConnectionStatusSection
            isConnected={isConnected}
            deviceState={deviceState}
            deviceLoadingReason={deviceLoadingReason}
            isPaused={state.visualizerPaused}
            cryptoCorrupted={cryptoCorrupted}
            onPauseToggle={toggleVisualizerPause}
            onRestartDevice={() => sendRestartDevice()}
            hidePauseButton
            extraActions={
              <MultiFrameButton
                $paused={false}
                onClick={() => dispatch({ type: "TRIGGER_DIAGNOSTIC" })}
                disabled={state.isDiagnosticRunning}
              >
                {state.isDiagnosticRunning ? "Capturing..." : "Run Multi-Frame Capture"}
              </MultiFrameButton>
            }
          />

          <DiagnosticStatusDisplay>
            {state.diagnosticStatus}
          </DiagnosticStatusDisplay>

          <PauseButton
            $paused={false}
            onClick={() => {
              showPrompt({
                title: "Reset Options to Defaults",
                message: "Reset all live options to defaults?",
                confirmText: "Reset",
                cancelText: "Cancel",
                variant: "danger",
                onConfirm: resetLiveControls,
              });
            }}
            title="Reset sidebar and visualizer options to defaults"
          >
            Reset Options to Defaults
          </PauseButton>

          <Section>
            <SectionTitle>Channel</SectionTitle>
            <Channels />
          </Section>

          <SignalDisplaySection
            sourceMode={state.sourceMode}
            maxSampleRate={maxSampleRate}
            fileCapturedRange={null}
            fftSize={fftSize}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSizeOptions={[8192, 16384, 32768, 65536, 131072, 262144]}
            fftWindow={fftWindow}
            temporalResolution={state.displayTemporalResolution}
            autoFftOptions={autoFftOptions || null}
            backend={backend}
            deviceProfile={deviceProfile}
            powerScale={state.powerScale}
            onFftSizeChange={setFftSize}
            onFftFrameRateChange={setFftFrameRate}
            onFftWindowChange={setFftWindow}
            onTemporalResolutionChange={(resolution) =>
              dispatch({ type: "SET_TEMPORAL_RESOLUTION", resolution })
            }
            onPowerScaleChange={(powerScale) =>
              dispatch({ type: "SET_POWER_SCALE", powerScale })
            }
            scheduleCoupledAdjustment={scheduleCoupledAdjustment}
          />

          <SourceSettingsSection
            sourceMode={state.sourceMode}
            gain={gain}
            ppm={ppm}
            tunerAGC={tunerAGC}
            rtlAGC={rtlAGC}
            isConnected={isConnected}
            stitchSourceSettings={state.stitchSourceSettings}
            onGainChange={setGain}
            onPpmChange={setPpm}
            onTunerAGCChange={setTunerAGC}
            onRtlAGCChange={setRtlAGC}
            onStitchSourceSettingsChange={(settings) =>
              dispatch({ type: "SET_STITCH_SOURCE_SETTINGS", settings })
            }
            onAgcModeChange={(tuner, rtl) => {
              setTunerAGC(tuner);
              setRtlAGC(rtl);
            }}
          />
        </>
      )}
    </SidebarContent>
  );
};
