import React, { useCallback } from "react";
import styled from "styled-components";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { Unplug, RotateCcw } from "lucide-react";

import {
  useSpectrumStore,
  LIVE_CONTROL_DEFAULTS,
} from "@n-apt/hooks/useSpectrumStore";

import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import SignalComposition from "@n-apt/components/SignalComposition";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import {
  ConnectionStatusSection,
  PauseButton,
} from "@n-apt/components/sidebar/ConnectionStatusSection";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { SidebarSectionTitle } from "@n-apt/components/ui/Collapsible";
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

const Section = styled.div<{ $fileMode?: boolean }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  background-color: ${(props) =>
    props.$fileMode ? props.theme.surface : "transparent"};
  padding: ${(props) => (props.$fileMode ? "12px" : "0")};
  border-radius: ${(props) => (props.$fileMode ? "8px" : "0")};
  border: ${(props) =>
    props.$fileMode ? `1px solid ${props.theme.border}` : "none"};
  margin: ${(props) => (props.$fileMode ? "8px 0" : "0")};
`;

const MultiFrameButton = styled(PauseButton)`
  width: 100%;
  margin-top: 8px;
  background-color: ${(props) => props.theme.primaryAnchor};
  border-color: ${(props) => props.theme.primaryAlpha};
  color: ${(props) => props.theme.primary};

  &:hover {
    background-color: ${(props) => props.theme.primaryAlpha};
    border-color: ${(props) => props.theme.primary};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
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
      sampleRateOptions,
      sendSettings,
      sendRestartDevice,
      sendPowerScaleCommand: _sendPowerScaleCommand,
    },
  } = useSpectrumStore();

  const { showPrompt } = usePrompt();

  const maxSampleRate = sampleRateHzEffective ?? maxSampleRateHz ?? 0;
  const deviceTypeNormalized =
    deviceProfile?.kind === "rtl-sdr" ? "rtl_sdr" : deviceProfile?.kind;
  const activeDeviceConfig = deviceTypeNormalized
    ? effectiveSdrSettings?.devices?.[deviceTypeNormalized]
    : undefined;
  const gainLimits = activeDeviceConfig?.gain_limits;

  const {
    fftSize,
    fftWindow,
    fftFrameRate,
    maxFrameRate,
    gain,
    hackrfBasebandBandwidth,
    ppm,
    tunerAGC,
    rtlAGC,
    setFftSize,
    setFftFrameRate,
    setGain,
    setHackrfBasebandBandwidth,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    setFftWindow,
    scheduleCoupledAdjustment,
  } = useSdrSettings({
    maxSampleRate,
    currentSampleRateHz: state.sampleRateHz,
    sampleRateOptions,
    sdrSettings: effectiveSdrSettings ?? null,
    deviceType: deviceProfile?.kind,
    onSettingsChange: (settings) => {
      sendSettings(settings);
    },
  });

  const resetLiveControls = useCallback(() => {
    const recommendedFftSize = 2048;
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
      tunerBandwidth: 0,
      ppm: LIVE_CONTROL_DEFAULTS.ppm,
      tunerAGC: LIVE_CONTROL_DEFAULTS.tunerAGC,
      rtlAGC: LIVE_CONTROL_DEFAULTS.rtlAGC,
    });
  }, [dispatch, maxFrameRate, sendSettings, state.fftFrameRate, state.fftSize]);

  return (
    <SidebarContent>
      <Section $fileMode={state.sourceMode === "file"}>
        <SidebarSectionTitle icon={<Unplug size={14} />} title="Source" />
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
            backend={backend}
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                {state.isDiagnosticRunning ? (
                  state.diagnosticStatus || "Capturing..."
                ) : state.diagnosticStatus === "Capture complete" ? (
                  <>
                    <RotateCcw size={14} />
                    Run Again
                  </>
                ) : (
                  "Run Multi-Frame Capture"
                )}
              </MultiFrameButton>
            }
          />

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

          <SignalComposition sidebar />

          <Section>
            <Channels />
          </Section>

          <SignalDisplaySection
            variant="diagnostic"
            sourceMode={state.sourceMode}
            maxSampleRate={maxSampleRate}
            sampleRate={state.sampleRateHz}
            sampleRateOptions={[3_200_000, maxSampleRate].filter(
              (v, i, a) => a.indexOf(v) === i,
            )}
            fileCapturedRange={null}
            fftSize={fftSize}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSizeOptions={[8192, 16384, 32768, 65536, 131072, 262144]}
            fftWindow={fftWindow}
            temporalResolution={state.displayTemporalResolution}
            backend={backend}
            deviceProfile={deviceProfile}
            powerScale={state.powerScale}
            onFftSizeChange={setFftSize}
            onFftFrameRateChange={setFftFrameRate}
            onSampleRateChange={() => {}}
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
            deviceType={deviceProfile?.kind}
            gain={gain}
            gainLimits={gainLimits}
            hackrfBasebandBandwidth={hackrfBasebandBandwidth}
            hackrfCurrentSampleRate={
              sampleRateHzEffective ?? state.sampleRateHz
            }
            ppm={ppm}
            tunerAGC={tunerAGC}
            rtlAGC={rtlAGC}
            isConnected={isConnected}
            stitchSourceSettings={state.stitchSourceSettings}
            onGainChange={setGain}
            onHackrfBasebandBandwidthChange={setHackrfBasebandBandwidth}
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
