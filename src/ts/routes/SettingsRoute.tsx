import React, { useRef, useState } from "react";
import styled from "styled-components";
import { MainLayout } from "@n-apt/components/MainLayout";
import {
  SettingsSidebar,
  type SettingsSidebarSection,
} from "@n-apt/components/sidebar/SettingsSidebar";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import { Row, Toggle } from "@n-apt/components/ui";
import { useSettingsSectionScrollSpy } from "@n-apt/hooks/useSettingsSectionScrollSpy";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
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
} from "@n-apt/redux";
import type { TemporalResolution } from "@n-apt/utils/temporalResolution";
import type { PowerScale } from "@n-apt/redux/slices/spectrumSlice";
import type { CaptureFileType } from "@n-apt/consts/schemas/websocket";
import {
  getBypassStartPage,
  setBypassStartPage,
} from "@n-apt/utils/bypassStartPage";
import {
  getSettingsDefaults,
  setCaptureDefaults,
  setSnapshotDefaults,
  type CaptureAcquisitionMode,
} from "@n-apt/utils/settingsDefaults";
import {
  getTemporalResolutionLabel,
} from "@n-apt/utils/temporalResolution";
import {
  LinkCardGrid,
  LinkCardItemView,
  type LinkCardItem,
} from "@n-apt/components/ui/LinkCardGrid";
import { ContactReveal } from "@n-apt/components/ui/ContactReveal";
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

const SettingLabel = styled.span`
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
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

const SectionGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
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
      <ThemeSection hideHeader />
    </SettingsSectionBlock>
  );
};

const SdrSettingsSection: React.FC = () => {
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.spectrum);
  const [tempFftSize, setTempFftSize] = useState(String(state.fftSize));

  const commitFftSize = (raw: string) => {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      dispatch(setFftSize(value));
      dispatch(setSdrSettingsBundle({ fftSize: value }));
    }
  };

  return (
    <SettingsSectionBlock data-settings-section="sdr">
      <SectionTitle>
        <SlidersHorizontal size={16} aria-hidden="true" />
        SDR Settings
      </SectionTitle>
      <SectionGrid>
        <Row label={<SettingLabel>Sample Rate</SettingLabel>}>
          <SettingSelect
            value={state.sampleRateHz}
            onChange={(e) => {
              const value = Number(e.target.value);
              dispatch(setSampleRate(value));
              dispatch(setSdrSettingsBundle({ sampleRateHz: value }));
            }}
          >
            {[state.sampleRateHz, 3_200_000, 1_600_000, 800_000].map(
              (rate) => (
                <option key={rate} value={rate}>
                  {(rate / 1_000_000).toFixed(1)} MHz
                </option>
              ),
            )}
          </SettingSelect>
        </Row>

        <Row label={<SettingLabel>FFT Size</SettingLabel>}>
          <NumberInput
            type="number"
            min={16}
            step={16}
            value={tempFftSize}
            onChange={(e) => {
              setTempFftSize(e.target.value);
              commitFftSize(e.target.value);
            }}
          />
        </Row>

        <Row label={<SettingLabel>FFT Window</SettingLabel>}>
          <SettingSelect
            value={state.fftWindow}
            onChange={(e) => dispatch(setFftWindow(e.target.value))}
          >
            {FFT_WINDOW_OPTIONS.map((windowName) => (
              <option key={windowName} value={windowName}>
                {windowName}
              </option>
            ))}
          </SettingSelect>
        </Row>

        <Row label={<SettingLabel>Frame Rate (logical)</SettingLabel>}>
          <NumberInput
            type="number"
            min={1}
            value={state.fftFrameRate}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value >= 1) {
                dispatch(setFftFrameRate(value));
              }
            }}
          />
        </Row>

        <Row label={<SettingLabel>Gain (dB)</SettingLabel>}>
          <NumberInput
            type="number"
            step={1}
            value={state.gain}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) dispatch(setGain(value));
            }}
          />
        </Row>

        <Row label={<SettingLabel>PPM</SettingLabel>}>
          <NumberInput
            type="number"
            step={1}
            value={state.ppm}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) dispatch(setPpm(value));
            }}
          />
        </Row>

        <Row label={<SettingLabel>Tuner AGC</SettingLabel>}>
          <Toggle
            $active={state.tunerAGC}
            onClick={() => dispatch(setTunerAGC(!state.tunerAGC))}
          />
        </Row>

        <Row label={<SettingLabel>RTL AGC</SettingLabel>}>
          <Toggle
            $active={state.rtlAGC}
            onClick={() => dispatch(setRtlAGC(!state.rtlAGC))}
          />
        </Row>

        <Row label={<SettingLabel>Temporal Resolution</SettingLabel>}>
          <SettingSelect
            value={state.displayTemporalResolution}
            onChange={(e) =>
              dispatch(
                setTemporalResolution(
                  e.target.value as TemporalResolution,
                ),
              )
            }
          >
            {TEMPORAL_RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {getTemporalResolutionLabel(resolution)}
              </option>
            ))}
          </SettingSelect>
        </Row>

        <Row label={<SettingLabel>Power Scale</SettingLabel>}>
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
        </Row>
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
      <Row
        label={
          <SettingLabel>Bypass after logging in</SettingLabel>
        }
        tooltip="Skip the start page and land directly in the app after signing in."
      >
        <Toggle $active={bypass} onClick={() => handleChange(!bypass)} />
      </Row>
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
        <Row label={<SettingLabel>Default duration mode</SettingLabel>}>
          <SettingSelect
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
        </Row>

        <Row label={<SettingLabel>Default duration (s)</SettingLabel>}>
          <NumberInput
            type="number"
            min={1}
            value={capture.captureDurationS}
            onChange={(e) =>
              update({ captureDurationS: Math.max(1, Number(e.target.value)) })
            }
          />
        </Row>

        <Row label={<SettingLabel>File type</SettingLabel>}>
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
        </Row>

        <Row label={<SettingLabel>Acquisition mode</SettingLabel>}>
          <SettingSelect
            value={capture.acquisitionMode}
            onChange={(e) =>
              update({
                acquisitionMode: e.target
                  .value as CaptureAcquisitionMode,
              })
            }
          >
            {CAPTURE_ACQUISITION_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </SettingSelect>
        </Row>

        <Row label={<SettingLabel>Encrypted (AES-256-GCM)</SettingLabel>}>
          <Toggle
            $active={capture.captureEncrypted}
            onClick={() =>
              update({ captureEncrypted: !capture.captureEncrypted })
            }
          />
        </Row>

        <Row label={<SettingLabel>Playback after capture</SettingLabel>}>
          <Toggle
            $active={capture.capturePlayback}
            onClick={() =>
              update({ capturePlayback: !capture.capturePlayback })
            }
          />
        </Row>

        <Row label={<SettingLabel>Geolocation</SettingLabel>}>
          <Toggle
            $active={capture.captureGeolocation}
            onClick={() =>
              update({ captureGeolocation: !capture.captureGeolocation })
            }
          />
        </Row>
      </SectionGrid>
    </SettingsSectionBlock>
  );
};

const SnapshotSettingsSection: React.FC = () => {
  const [snapshot, setSnapshot] = useState(() =>
    getSettingsDefaults().snapshot,
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
        <Row label={<SettingLabel>Whole channel (default)</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotWhole}
            onClick={() => update({ snapshotWhole: !snapshot.snapshotWhole })}
          />
        </Row>

        <Row label={<SettingLabel>Include waterfall</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotShowWaterfall}
            onClick={() =>
              update({ snapshotShowWaterfall: !snapshot.snapshotShowWaterfall })
            }
          />
        </Row>

        <Row label={<SettingLabel>Include stats</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotShowStats}
            onClick={() =>
              update({ snapshotShowStats: !snapshot.snapshotShowStats })
            }
          />
        </Row>

        <Row label={<SettingLabel>Use theme colors</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotUseThemeColors}
            onClick={() =>
              update({
                snapshotUseThemeColors: !snapshot.snapshotUseThemeColors,
              })
            }
          />
        </Row>

        <Row label={<SettingLabel>Include geolocation</SettingLabel>}>
          <Toggle
            $active={snapshot.snapshotShowGeolocation}
            onClick={() =>
              update({
                snapshotShowGeolocation: !snapshot.snapshotShowGeolocation,
              })
            }
          />
        </Row>

        <Row label={<SettingLabel>Aspect ratio</SettingLabel>}>
          <SettingSelect
            value={snapshot.snapshotAspectRatio}
            onChange={(e) =>
              update({
                snapshotAspectRatio: e.target.value as typeof snapshot.snapshotAspectRatio,
              })
            }
          >
            {SNAPSHOT_ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio === "default" ? "Default" : ratio}
              </option>
            ))}
          </SettingSelect>
        </Row>

        <Row label={<SettingLabel>Format</SettingLabel>}>
          <SettingSelect
            value={snapshot.snapshotFormat}
            onChange={(e) =>
              update({
                snapshotFormat: e.target.value as typeof snapshot.snapshotFormat,
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
        </Row>

        <Row label={<SettingLabel>Fast Snapshot: include stats</SettingLabel>}>
          <Toggle
            $active={snapshot.fastSnapshotShowStats}
            onClick={() =>
              update({
                fastSnapshotShowStats: !snapshot.fastSnapshotShowStats,
              })
            }
          />
        </Row>
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
    to: "/learn-signals",
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
          CC BY-SA 4.0 license. Not for commercial use without proper
          licensing.
        </AttributionDetail>
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
