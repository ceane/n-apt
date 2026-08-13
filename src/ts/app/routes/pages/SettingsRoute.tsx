import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { MainLayout } from "@n-apt/app/MainLayout";
import {
  SettingsSidebar,
  type SettingsSidebarSection,
} from "@n-apt/settings/sidebar/SettingsSidebar";
import { ThemeSection } from "@n-apt/settings/sidebar/ThemeSection";
import { Row, Toggle } from "@n-apt/ui";
import { RowLabel, RowControl, RowContainer } from "@n-apt/ui/Row";
import { useSettingsSectionScrollSpy } from "@n-apt/settings/hooks/useSettingsSectionScrollSpy";
import {
  useAppDispatch,
  useAppSelector,
  setFftFrameRate,
  setFftSize,
  setFftWindow,
  setGain,
  setPpm,
  setSampleRate,
  setSdrSettingsBundle,
  setTemporalResolution,
  setPowerScale,
  setTunerAGC,
  setRtlAGC,
  setMaxVizZoom,
  setMirrorIqBasebandBelowZero,
  sendSettings,
  selectActiveSourceDerivedState,
} from "@n-apt/redux";
import {
  FRONTEND_VISUALIZER_DEFAULTS,
  VISUALIZER_MAX_ZOOM_LIMITS,
  getVisualizerDefaultDbLimits,
} from "@n-apt/consts/visualizerControls";
import { formatFrequency } from "@n-apt/consts/sdr";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import type { PowerScale } from "@n-apt/redux/slices/spectrumSlice";
import type { CaptureFileType } from "@n-apt/consts/schemas/websocket";
import {
  getBypassStartPage,
  setBypassStartPage,
} from "@n-apt/app/auth/bypassStartPage";
import {
  getSettingsDefaults,
  setCaptureDefaults,
  setSnapshotDefaults,
  type CaptureAcquisitionMode,
} from "@n-apt/settings/public/settingsDefaults";
import { getTemporalResolutionLabel } from "@n-apt/math/temporalResolution";
import {
  computeMaxFrameRate,
  clampFrameRateToLogicalMax,
  resolveSampleRateSpec,
  type SampleRateSpec,
} from "@n-apt/math/signals";
import {
  LinkCardGrid,
  LinkCardItemView,
  type LinkCardItem,
} from "@n-apt/ui/LinkCardGrid";
import { ContactReveal } from "@n-apt/ui/ContactReveal";
import {
  Clock,
  FileSignal,
  KeyRound,
  Monitor,
  SlidersHorizontal,
  Sparkles,
  Camera,
  Zap,
  Home,
  Languages,
  Code2,
  BookOpen,
  Mail,
  FileText,
  Shield,
  ScrollText,
} from "lucide-react";

const SETTINGS_SECTIONS: SettingsSidebarSection[] = [
  { id: "theme", label: "Theme" },
  { id: "sdr", label: "SDR Settings" },
  { id: "login", label: "Login" },
  { id: "iq-capture", label: "I/Q Capture Settings" },
  { id: "snapshot", label: "Snapshot & Fast Snapshot" },
];

const PageContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  padding: clamp(24px, 4vw, 56px);
  box-sizing: border-box;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
`;

const PageInner = styled.div`
  width: min(100%, 720px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: ${(props) => props.theme.textPrimary};
`;

const PageSubtitle = styled.p`
  margin: -16px 0 0;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 14px;
  line-height: 1.6;
  color: ${(props) => props.theme.textSecondary};
`;

const SettingsSectionBlock = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 14px;
  background: ${(props) => props.theme.surface};
  box-sizing: border-box;
`;

const SettingsRow = styled(Row)`
  padding-inline: 10px;

  ${(props) =>
    props.theme.mode === "light" &&
    `
    background: transparent;
    border: none;
    padding-block: 8px;
    `}

  ${RowLabel} {
    padding-left: 0;
  }

  ${RowControl} {
    padding-right: 0;
  }
`;

const MirrorSpectrumRow = styled(SettingsRow)`
  margin-block: 16px;
  padding-block: 20px;
`;

const SettingsThemeSection = styled(ThemeSection)`
  ${RowContainer} {
    ${(props) =>
      props.theme.mode === "light" &&
      `
      background: transparent;
      border: none;
      padding: 8px 0;
    `}

    ${RowLabel} {
      padding-left: 0;
    }

    ${RowControl} {
      padding-right: 0;
    }
  }
`;

const SectionTitle = styled.h2`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: ${(props) => props.theme.textPrimary};

  svg {
    width: 16px;
    height: 16px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.6;
  }
`;

const SettingsSubsectionTitle = styled(SectionTitle)`
  margin-top: 36px;
`;

const DevicePill = styled.span`
  padding: 3px 8px;
  border-radius: 999px;
  background: ${(props) => props.theme.surfaceHover};
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 500;
`;

const SettingLabel = styled.span`
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
`;

const ReadOnlyValue = styled.span`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  text-align: right;
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 80px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
  }

  option {
    background-color: ${(props) => props.theme.surface};
    color: ${(props) => props.theme.textPrimary};
    font-family: ${(props) => props.theme.typography.mono};
  }
`;

const NumberInput = styled.input`
  width: 72px;
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  padding: 3px 6px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }
`;

const FrameRateControl = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const FrameRateLimit = styled.span`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
  white-space: nowrap;
`;

const SectionGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  & > ${SettingsRow}:nth-child(odd) {
    background: ${(props) =>
      props.theme.mode === "light"
        ? "rgba(0, 0, 0, 0.04)"
        : props.theme.surfaceHover};

  }
`;

const SettingsFooterRoot = styled.footer`
  display: flex;
  flex-direction: column;
  gap: 32px;
  margin-top: 16px;
  padding-top: 24px;
  border-top: 1px solid ${(props) => props.theme.border};
`;

const Attribution = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textMuted};
  line-height: 1.4;
  padding-bottom: 24px;
  border-bottom: 1px solid ${(props) => props.theme.border};
`;

const AttributionTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 4px;
`;

const AttributionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
`;

const AttributionSourceRow = styled(AttributionRow)`
  margin-top: 12px;
`;

const AttributionBadge = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
`;

const AttributionLink = styled.a`
  color: ${(props) => props.theme.primary};
  text-decoration: none;
`;

const AttributionDetail = styled.div`
  font-size: 9px;
  color: ${(props) => props.theme.metadataLabel};
`;

const AttributionAuthorList = styled.ul`
  display: grid;
  gap: 3px;
  margin: 6px 0 0;
  padding: 0;
  color: ${(props) => props.theme.metadataLabel};
  font-size: 9px;
  list-style: none;
`;

const AttributionAuthor = styled.li`
  display: grid;
  grid-template-columns: minmax(132px, 0.35fr) 1fr;
  gap: 8px;
  line-height: 1.4;
`;

const AttributionAuthorName = styled.span`
  color: ${(props) => props.theme.textSecondary};
  font-weight: 600;
`;

const FFT_WINDOW_OPTIONS = [
  "Rectangular",
  "Nuttall",
  "Hamming",
  "Hanning",
  "Blackman",
] as const;

const TEMPORAL_RESOLUTIONS: TemporalResolution[] = [
  "slow",
  "reduced",
  "lossless",
];

const POWER_SCALES: PowerScale[] = ["dB", "dBm"];

const CAPTURE_FILE_TYPES: CaptureFileType[] = [".napt", ".iq", ".wav"];

const CAPTURE_ACQUISITION_MODES: Array<{
  value: CaptureAcquisitionMode;
  label: string;
}> = [
  { value: "whole_sample", label: "Whole Sample" },
  { value: "stepwise", label: "Stepwise" },
  { value: "interleaved", label: "Interleaved (TDMS)" },
];

const SNAPSHOT_FORMATS = ["png", "svg", "animated-svg"] as const;

const SNAPSHOT_ASPECT_RATIOS = [
  "default",
  "4:3",
  "16:10",
  "16:9",
  "19.5:9",
] as const;

const ThemeSettingsSection: React.FC = () => {
  return (
    <SettingsSectionBlock data-settings-section="theme">
      <SectionTitle>
        <Monitor size={16} aria-hidden="true" />
        Theme
      </SectionTitle>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "inherit",
        }}
      >
        These apply everywhere in the app.
      </p>
      <SettingsThemeSection hideHeader />
    </SettingsSectionBlock>
  );
};

const SdrSettingsSection: React.FC = () => {
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.spectrum);
  const mirrorIqBasebandBelowZero = useAppSelector(
    (s) => s.settings.mirrorIqBasebandBelowZero,
  );
  const signalsDefaults = useAppSelector((s) => s.websocket.signalsDefaults);
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const [frameRateInput, setFrameRateInput] = useState(
    String(state.fftFrameRate),
  );
  const [isEditingFrameRate, setIsEditingFrameRate] = useState(false);

  const deviceSampleRateOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (activeSourceDerived.sampleRateOptions ?? []).filter(
            (rate) => Number.isFinite(rate) && rate > 0,
          ),
        ),
      ).sort((a, b) => a - b),
    [activeSourceDerived.sampleRateOptions],
  );

  // Derive the default sample rate list from signals.yaml (the same source the
  // live view uses) when the backend has not advertised per-device options yet.
  const signalsDerivedSampleRateOptions = useMemo(() => {
    const globalDefault = signalsDefaults?.sample_rate;
    const deviceKind = activeSourceDerived.deviceProfile?.kind;
    const deviceConfig = deviceKind
      ? signalsDefaults?.devices?.[deviceKind]
      : undefined;
    const spec = deviceConfig?.sample_rate as SampleRateSpec | undefined;

    if (spec !== undefined) {
      const floorSampleRate =
        typeof signalsDefaults?.min_receive_sample_rate === "number"
          ? signalsDefaults.min_receive_sample_rate
          : globalDefault;
      const maxSampleRate =
        typeof deviceConfig?.max_sample_rate === "number"
          ? deviceConfig.max_sample_rate
          : globalDefault;
      const resolved = resolveSampleRateSpec(
        spec,
        null,
        floorSampleRate ?? 3_200_000,
        maxSampleRate ?? 3_200_000,
      );
      if (resolved.options.length > 0) {
        return Array.from(new Set(resolved.options))
          .filter((rate) => Number.isFinite(rate) && rate > 0)
          .sort((a, b) => a - b);
      }
    }

    if (typeof globalDefault === "number" && Number.isFinite(globalDefault)) {
      return [globalDefault];
    }
    return [];
  }, [
    activeSourceDerived.deviceProfile?.kind,
    signalsDefaults?.sample_rate,
    signalsDefaults?.min_receive_sample_rate,
    signalsDefaults?.devices,
  ]);

  const sampleRateOptions =
    deviceSampleRateOptions.length > 0
      ? deviceSampleRateOptions
      : signalsDerivedSampleRateOptions.length > 0
        ? signalsDerivedSampleRateOptions
        : Array.from(
            new Set(
              [state.sampleRateHz, 3_200_000].filter(
                (rate) => Number.isFinite(rate) && rate > 0,
              ),
            ),
          ).sort((a, b) => a - b);
  const sampleRateValue = sampleRateOptions.includes(state.sampleRateHz)
    ? state.sampleRateHz
    : (sampleRateOptions[0] ?? state.sampleRateHz);
  const configuredFftSizeOptions = activeSourceDerived.fftSizeOptions ?? [];
  const fftSizeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (configuredFftSizeOptions.length > 0
            ? configuredFftSizeOptions
            : [state.fftSize]
          ).filter((size) => Number.isFinite(size) && size > 0),
        ),
      ).sort((a, b) => a - b),
    [configuredFftSizeOptions, state.fftSize],
  );
  const activeDeviceName =
    activeSourceDerived.deviceName &&
    !activeSourceDerived.backend?.toLowerCase().includes("mock")
      ? activeSourceDerived.deviceName
      : "Default";
  const logicalMaxFrameRate = computeMaxFrameRate(
    sampleRateValue,
    state.fftSize,
    signalsDefaults?.fft?.max_frame_rate,
  );
  useEffect(() => {
    if (!isEditingFrameRate) {
      setFrameRateInput(String(state.fftFrameRate));
    }
  }, [isEditingFrameRate, state.fftFrameRate]);
  const commitFrameRate = (rawValue: string) => {
    setFrameRateInput(rawValue);
    if (rawValue === "") return;
    const frameRate = Math.max(
      1,
      Math.min(logicalMaxFrameRate, Math.floor(Number(rawValue) || 1)),
    );
    dispatch(setFftFrameRate(frameRate));
    dispatch(setSdrSettingsBundle({ fftFrameRate: frameRate }));
    dispatch(
      sendSettings({
        fftSize: state.fftSize,
        fftWindow: state.fftWindow,
        frameRate,
        sampleRate: state.sampleRateHz,
        gain: state.gain,
        ppm: state.ppm,
        tunerAGC: state.tunerAGC,
        rtlAGC: state.rtlAGC,
      }),
    );
  };
  const commitFftSize = (fftSize: number) => {
    const logicalMaxFrameRate = computeMaxFrameRate(
      sampleRateValue,
      fftSize,
      signalsDefaults?.fft?.max_frame_rate,
    );
    const frameRate = clampFrameRateToLogicalMax(
      state.fftFrameRate,
      logicalMaxFrameRate,
    );
    dispatch(setFftSize(fftSize));
    dispatch(setFftFrameRate(frameRate));
    dispatch(setSdrSettingsBundle({ fftSize, fftFrameRate: frameRate }));
    setFrameRateInput(String(frameRate));
    dispatch(
      sendSettings({
        fftSize,
        fftWindow: state.fftWindow,
        frameRate,
        sampleRate: state.sampleRateHz,
        gain: state.gain,
        ppm: state.ppm,
        tunerAGC: state.tunerAGC,
        rtlAGC: state.rtlAGC,
      }),
    );
  };

  return (
    <SettingsSectionBlock data-settings-section="sdr">
      <SectionTitle>
        <SlidersHorizontal size={16} aria-hidden="true" />
        SDR Settings
        <DevicePill aria-hidden="true">{activeDeviceName}</DevicePill>
      </SectionTitle>
      <SectionGrid>
        <SettingsRow label={<SettingLabel>Sample Rate</SettingLabel>}>
          <SettingSelect
            aria-label="Sample Rate"
            value={sampleRateValue}
            onChange={(e) => {
              const value = Number(e.target.value);
              dispatch(setSampleRate(value));
              dispatch(setSdrSettingsBundle({ sampleRateHz: value }));
              dispatch(
                sendSettings({
                  fftSize: state.fftSize,
                  fftWindow: state.fftWindow,
                  frameRate: state.fftFrameRate,
                  sampleRate: value,
                  gain: state.gain,
                  ppm: state.ppm,
                  tunerAGC: state.tunerAGC,
                  rtlAGC: state.rtlAGC,
                }),
              );
            }}
          >
            {sampleRateOptions.map((rate) => (
              <option key={`sample-rate-${rate}`} value={rate}>
                {formatFrequency(rate, {
                  precisionMHz: 3,
                  trimTrailingZeros: true,
                })}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>FFT Size</SettingLabel>}>
          <SettingSelect
            aria-label="FFT Size"
            value={state.fftSize}
            onChange={(e) => {
              commitFftSize(Number(e.target.value));
            }}
          >
            {fftSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size.toLocaleString("en-US")}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>FFT Window</SettingLabel>}>
          <SettingSelect
            aria-label="FFT Window"
            value={state.fftWindow}
            onChange={(e) => dispatch(setFftWindow(e.target.value))}
          >
            {FFT_WINDOW_OPTIONS.map((windowName) => (
              <option key={windowName} value={windowName}>
                {windowName}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Frame Rate (logical)</SettingLabel>}>
          <FrameRateControl>
            <NumberInput
              aria-label="Frame Rate (logical)"
              type="number"
              min={1}
              max={logicalMaxFrameRate}
              value={frameRateInput}
              onFocus={() => setIsEditingFrameRate(true)}
              onBlur={() => setIsEditingFrameRate(false)}
              onChange={(event) => commitFrameRate(event.target.value)}
            />
            <FrameRateLimit>Max {logicalMaxFrameRate} fps</FrameRateLimit>
          </FrameRateControl>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Gain (dB)</SettingLabel>}>
          <NumberInput
            aria-label="Gain"
            type="number"
            step={1}
            value={state.gain}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) dispatch(setGain(value));
            }}
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>PPM</SettingLabel>}>
          <NumberInput
            type="number"
            step={1}
            value={state.ppm}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) dispatch(setPpm(value));
            }}
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Tuner AGC</SettingLabel>}>
          <Toggle
            $active={state.tunerAGC}
            onClick={() => dispatch(setTunerAGC(!state.tunerAGC))}
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>RTL AGC</SettingLabel>}>
          <Toggle
            $active={state.rtlAGC}
            onClick={() => dispatch(setRtlAGC(!state.rtlAGC))}
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Temporal Resolution</SettingLabel>}>
          <SettingSelect
            value={state.displayTemporalResolution}
            onChange={(e) =>
              dispatch(
                setTemporalResolution(e.target.value as TemporalResolution),
              )
            }
          >
            {TEMPORAL_RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {getTemporalResolutionLabel(resolution)}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Power Scale</SettingLabel>}>
          <SettingSelect
            value={state.powerScale}
            onChange={(e) =>
              dispatch(setPowerScale(e.target.value as PowerScale))
            }
          >
            {POWER_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {scale === "dB" ? "dB (relative)" : "dBm (approximate)"}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <MirrorSpectrumRow
          label={<SettingLabel>Mirror spectrum below 0Hz</SettingLabel>}
        >
          <Toggle
            aria-label="Mirror spectrum below 0Hz"
            $active={mirrorIqBasebandBelowZero}
            onClick={() =>
              dispatch(setMirrorIqBasebandBelowZero(!mirrorIqBasebandBelowZero))
            }
          />
        </MirrorSpectrumRow>
      </SectionGrid>

      <SettingsSubsectionTitle>
        Signals.yaml defaults (read-only)
      </SettingsSubsectionTitle>
      <SectionGrid>
        <SettingsRow label={<SettingLabel>Sample Rate</SettingLabel>}>
          <ReadOnlyValue>
            {signalsDefaults
              ? formatFrequency(signalsDefaults.sample_rate, {
                  precisionMHz: 3,
                  trimTrailingZeros: true,
                })
              : "Waiting for backend"}
          </ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label={<SettingLabel>Center Frequency</SettingLabel>}>
          <ReadOnlyValue>
            {signalsDefaults
              ? formatFrequency(signalsDefaults.center_frequency, {
                  precisionMHz: 3,
                  trimTrailingZeros: true,
                })
              : "Waiting for backend"}
          </ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label={<SettingLabel>Gain / PPM</SettingLabel>}>
          <ReadOnlyValue>
            {signalsDefaults
              ? `${signalsDefaults.gain.tuner_gain} dB / ${signalsDefaults.ppm}`
              : "Waiting for backend"}
          </ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label={<SettingLabel>FFT / Display</SettingLabel>}>
          <ReadOnlyValue>
            {signalsDefaults
              ? `${signalsDefaults.fft?.default_size ?? "—"} / ${signalsDefaults.display?.min_db ?? "—"}..${signalsDefaults.display?.max_db ?? "—"} dB`
              : "Waiting for backend"}
          </ReadOnlyValue>
        </SettingsRow>
      </SectionGrid>

      <SettingsSubsectionTitle>Frontend defaults</SettingsSubsectionTitle>
      <SectionGrid>
        <SettingsRow label={<SettingLabel>Starting dB range</SettingLabel>}>
          <ReadOnlyValue>
            {(() => {
              const limits = getVisualizerDefaultDbLimits("dB");
              return `${limits.min}..${limits.max} dB`;
            })()}
          </ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label={<SettingLabel>Starting zoom</SettingLabel>}>
          <ReadOnlyValue>{FRONTEND_VISUALIZER_DEFAULTS.zoom}x</ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label={<SettingLabel>Maximum zoom</SettingLabel>}>
          <NumberInput
            aria-label="Maximum zoom"
            type="number"
            min={VISUALIZER_MAX_ZOOM_LIMITS.min}
            max={VISUALIZER_MAX_ZOOM_LIMITS.max}
            step={VISUALIZER_MAX_ZOOM_LIMITS.step}
            value={state.maxVizZoom}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) dispatch(setMaxVizZoom(value));
            }}
          />
        </SettingsRow>
      </SectionGrid>
    </SettingsSectionBlock>
  );
};

const LoginSettingsSection: React.FC = () => {
  const [bypass, setBypass] = useState(getBypassStartPage());

  const handleChange = (next: boolean) => {
    setBypass(next);
    setBypassStartPage(next);
  };

  return (
    <SettingsSectionBlock data-settings-section="login">
      <SectionTitle>
        <KeyRound size={16} aria-hidden="true" />
        Login
      </SectionTitle>
      <SettingsRow
        label={<SettingLabel>Bypass after logging in</SettingLabel>}
        tooltip="Skip the start page and land directly in the app after signing in."
      >
        <Toggle
          aria-label="Bypass after logging in"
          $active={bypass}
          onClick={() => handleChange(!bypass)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
};

const IqCaptureSettingsSection: React.FC = () => {
  const [capture, setCapture] = useState(() => getSettingsDefaults().capture);

  const update = (partial: Partial<typeof capture>) => {
    const next = { ...capture, ...partial };
    setCapture(next);
    setCaptureDefaults(partial);
  };

  return (
    <SettingsSectionBlock data-settings-section="iq-capture">
      <SectionTitle>
        <FileSignal size={16} aria-hidden="true" />
        I/Q Capture Settings
      </SectionTitle>
      <SectionGrid>
        <SettingsRow label={<SettingLabel>Default duration mode</SettingLabel>}>
          <SettingSelect
            aria-label="Default duration mode"
            value={capture.captureDurationMode}
            onChange={(e) =>
              update({
                captureDurationMode: e.target.value as "timed" | "manual",
              })
            }
          >
            <option value="timed">Timed</option>
            <option value="manual">Manual</option>
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Default duration (s)</SettingLabel>}>
          <NumberInput
            type="number"
            min={1}
            value={capture.captureDurationS}
            onChange={(e) =>
              update({ captureDurationS: Math.max(1, Number(e.target.value)) })
            }
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>File type</SettingLabel>}>
          <SettingSelect
            value={capture.captureFileType}
            onChange={(e) =>
              update({ captureFileType: e.target.value as CaptureFileType })
            }
          >
            {CAPTURE_FILE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Acquisition mode</SettingLabel>}>
          <SettingSelect
            value={capture.acquisitionMode}
            onChange={(e) =>
              update({
                acquisitionMode: e.target.value as CaptureAcquisitionMode,
              })
            }
          >
            {CAPTURE_ACQUISITION_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow
          label={<SettingLabel>Encrypted (AES-256-GCM)</SettingLabel>}
        >
          <Toggle
            $active={capture.captureEncrypted}
            onClick={() =>
              update({ captureEncrypted: !capture.captureEncrypted })
            }
          />
        </SettingsRow>

        <SettingsRow
          label={<SettingLabel>Playback after capture</SettingLabel>}
        >
          <Toggle
            $active={capture.capturePlayback}
            onClick={() =>
              update({ capturePlayback: !capture.capturePlayback })
            }
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Geolocation</SettingLabel>}>
          <Toggle
            $active={capture.captureGeolocation}
            onClick={() =>
              update({ captureGeolocation: !capture.captureGeolocation })
            }
          />
        </SettingsRow>
      </SectionGrid>
    </SettingsSectionBlock>
  );
};

const SnapshotSettingsSection: React.FC = () => {
  const [snapshot, setSnapshot] = useState(
    () => getSettingsDefaults().snapshot,
  );

  const update = (partial: Partial<typeof snapshot>) => {
    const next = { ...snapshot, ...partial };
    setSnapshot(next);
    setSnapshotDefaults(partial);
  };

  return (
    <SettingsSectionBlock data-settings-section="snapshot">
      <SectionTitle>
        <Camera size={16} aria-hidden="true" />
        Snapshot &amp; Fast Snapshot
      </SectionTitle>
      <SectionGrid>
        <SettingsRow
          label={<SettingLabel>Whole channel (default)</SettingLabel>}
        >
          <Toggle
            $active={snapshot.snapshotWhole}
            onClick={() => update({ snapshotWhole: !snapshot.snapshotWhole })}
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Include waterfall</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotShowWaterfall}
            onClick={() =>
              update({ snapshotShowWaterfall: !snapshot.snapshotShowWaterfall })
            }
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Include stats</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotShowStats}
            onClick={() =>
              update({ snapshotShowStats: !snapshot.snapshotShowStats })
            }
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Use theme colors</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotUseThemeColors}
            onClick={() =>
              update({
                snapshotUseThemeColors: !snapshot.snapshotUseThemeColors,
              })
            }
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Include geolocation</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotShowGeolocation}
            onClick={() =>
              update({
                snapshotShowGeolocation: !snapshot.snapshotShowGeolocation,
              })
            }
          />
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Aspect ratio</SettingLabel>}>
          <SettingSelect
            value={snapshot.snapshotAspectRatio}
            onChange={(e) =>
              update({
                snapshotAspectRatio: e.target
                  .value as typeof snapshot.snapshotAspectRatio,
              })
            }
          >
            {SNAPSHOT_ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio === "default" ? "Default" : ratio}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow label={<SettingLabel>Format</SettingLabel>}>
          <SettingSelect
            value={snapshot.snapshotFormat}
            onChange={(e) =>
              update({
                snapshotFormat: e.target
                  .value as typeof snapshot.snapshotFormat,
              })
            }
          >
            {SNAPSHOT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format === "png"
                  ? "PNG"
                  : format === "svg"
                    ? "SVG"
                    : "Animated SVG (1s)"}
              </option>
            ))}
          </SettingSelect>
        </SettingsRow>

        <SettingsRow
          label={<SettingLabel>Fast Snapshot: include stats</SettingLabel>}
        >
          <Toggle
            aria-label="Fast Snapshot: include stats"
            $active={snapshot.fastSnapshotShowStats}
            onClick={() =>
              update({
                fastSnapshotShowStats: !snapshot.fastSnapshotShowStats,
              })
            }
          />
        </SettingsRow>
      </SectionGrid>
    </SettingsSectionBlock>
  );
};

const FOOTER_LINK_CARDS: LinkCardItem[] = [
  {
    title: "Start Page",
    description: "Return to the app's starting point.",
    Icon: Home,
    to: "/get-started",
  },
  {
    title: "Lingo and Learn",
    description: "Browse the FAQ to learn radio and signal-processing terms.",
    Icon: Languages,
    to: "/learn",
  },
  {
    title: "View on GitHub",
    description: "Browse the N-APT source repository.",
    Icon: Code2,
    href: "https://github.com/ceane/n-apt",
  },
  {
    title: "More about N-APT",
    description:
      "Read the article about N-APT to learn about the signal that inspired the app.",
    Icon: BookOpen,
    href: "https://ceane.github.io/n-apt",
  },
  {
    title: "Terms and Conditions",
    description: "Read the Terms of Use and license summary for N-APT.",
    Icon: FileText,
    to: "/terms",
  },
  {
    title: "Privacy Policy",
    description: "See how the app handles authentication, sessions, and data.",
    Icon: Shield,
    to: "/privacy",
  },
  {
    title: "License",
    description: "N-APT's open source license.",
    Icon: ScrollText,
    to: "/license",
  },
  {
    title: "Contact",
    description: "Press and hold to reveal the contact email.",
    Icon: Mail,
    footer: <ContactReveal />,
  },
];

const SettingsFooter: React.FC = () => {
  return (
    <SettingsFooterRoot>
      <Attribution>
        <AttributionTitle>Attribution</AttributionTitle>
        <AttributionRow>
          <AttributionBadge>CC BY-SA</AttributionBadge>
          <span>
            Tower data provided by{" "}
            <AttributionLink
              href="https://opencellid.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenCelliD
            </AttributionLink>
            .
          </span>
        </AttributionRow>
        <AttributionDetail>
          CC BY-SA 4.0 license. Not for commercial use without proper licensing.
        </AttributionDetail>
        <AttributionSourceRow>
          <AttributionBadge>SDR++</AttributionBadge>
          <span>
            Waterfall colormaps adapted from the{" "}
            <AttributionLink
              href="https://github.com/AlexandreRouma/SDRPlusPlus/tree/master/root/res/colormaps"
              target="_blank"
              rel="noopener noreferrer"
            >
              SDR++ colormap collection
            </AttributionLink>
            .
          </span>
        </AttributionSourceRow>
        <AttributionAuthorList aria-label="SDR++ waterfall colormap authors">
          <AttributionAuthor>
            <AttributionAuthorName>Youssef Touil</AttributionAuthorName>
            <span> — Classic</span>
          </AttributionAuthor>
          <AttributionAuthor>
            <AttributionAuthorName>Paul (PD0SWL)</AttributionAuthorName>
            <span> — Classic Green</span>
          </AttributionAuthor>
          <AttributionAuthor>
            <AttributionAuthorName>Ryzerth</AttributionAuthorName>
            <span> — Electric, Grey Scale, WebSDR</span>
          </AttributionAuthor>
          <AttributionAuthor>
            <AttributionAuthorName>csete</AttributionAuthorName>
            <span> — GQRX</span>
          </AttributionAuthor>
          <AttributionAuthor>
            <AttributionAuthorName>B.I.D.S.</AttributionAuthorName>
            <span> — Inferno, Magma, Plasma, Viridis</span>
          </AttributionAuthor>
          <AttributionAuthor>
            <AttributionAuthorName>Yaroslav Andrianov</AttributionAuthorName>
            <span> — Smoke, Temper Colors, Vivid</span>
          </AttributionAuthor>
          <AttributionAuthor>
            <AttributionAuthorName>Google AI</AttributionAuthorName>
            <span> — Turbo</span>
          </AttributionAuthor>
        </AttributionAuthorList>
      </Attribution>

      <LinkCardGrid aria-label="Useful links">
        {FOOTER_LINK_CARDS.map((card) => (
          <LinkCardItemView key={card.title} {...card} />
        ))}
      </LinkCardGrid>
    </SettingsFooterRoot>
  );
};

interface SettingsRouteProps {
  /**
   * When provided, the shared app shell owns the MainLayout + SettingsSidebar
   * (so it persists across navigation) and SettingsRoute renders only its
   * page content, scrolling inside this container. When omitted, SettingsRoute
   * renders its own self-contained layout (used in isolation/tests).
   */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const SettingsContent: React.FC<{
  pageRef: React.RefObject<HTMLDivElement | null>;
}> = ({ pageRef }) => (
  <PageContent ref={pageRef}>
    <PageInner>
      <PageTitle>Settings</PageTitle>
      <PageSubtitle>
        App-wide preferences. I/Q Capture and Snapshot defaults are applied on
        the visualizer page.
      </PageSubtitle>
      <ThemeSettingsSection />
      <SdrSettingsSection />
      <LoginSettingsSection />
      <IqCaptureSettingsSection />
      <SnapshotSettingsSection />
      <SettingsFooter />
    </PageInner>
  </PageContent>
);

export const SettingsRoute: React.FC<SettingsRouteProps> = ({
  containerRef,
}) => {
  // Standalone mode (no shell container provided): render the layout +
  // sidebar ourselves so the page works in isolation and in tests.
  if (containerRef === undefined) {
    return <SettingsRouteStandalone />;
  }

  return <SettingsContent pageRef={containerRef} />;
};

/** Self-contained settings page: own MainLayout + sidebar + section scroll-spy. */
const SettingsRouteStandalone: React.FC = () => {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const { activeSectionId, scrollToSection } = useSettingsSectionScrollSpy({
    containerRef: pageRef,
    sectionIds: SETTINGS_SECTIONS.map((s) => s.id),
  });

  return (
    <MainLayout
      sidebar={
        <SettingsSidebar
          sections={SETTINGS_SECTIONS}
          activeSectionId={activeSectionId}
          onSectionClick={scrollToSection}
        />
      }
    >
      <SettingsContent pageRef={pageRef} />
    </MainLayout>
  );
};

export default SettingsRoute;
