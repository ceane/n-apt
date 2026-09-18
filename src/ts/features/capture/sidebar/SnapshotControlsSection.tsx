import React from "react";
import styled, { keyframes } from "styled-components";
import { Row, Collapsible } from "@n-apt/ui";
import {
  SectionGrid as Section,
  CheckboxSwitch as ToggleSwitch,
  CheckboxSwitchInput,
  CheckboxSwitchSlider as ToggleSwitchSlider,
  SettingSelect as SettingSelectBase,
  IconLabel,
} from "@n-apt/ui/SidebarPrimitives";
import {
  BookA,
  Fullscreen,
  Grid2X2,
  Image as ImageIcon,
  MapPin,
  Paintbrush,
  Ratio,
  Scan,
  SquareDashedTopSolid,
} from "lucide-react";
import { useAppSelector } from "@n-apt/redux";
import type { SnapshotVideoFormat } from "@n-apt/capture/hooks/useSnapshot";

export type SnapshotAspectRatio =
  | "default"
  | "4:3"
  | "16:10"
  | "16:9"
  | "19.5:9";

const SettingSelect = styled(SettingSelectBase)<{ $disabled?: boolean }>`
  color: ${(props) =>
    props.$disabled ? props.theme.textMuted : props.theme.textPrimary};
  min-width: 80px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};

  &:hover {
    border-color: ${(props) =>
      props.$disabled ? "transparent" : props.theme.borderHover};
  }
`;

const ToggleSwitchInput = styled(CheckboxSwitchInput).attrs({
  $plainDisabled: true,
})``;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) =>
    props.$paused ? props.theme.primaryAnchor : props.theme.surface};
  border: 1px solid
    ${(props) =>
      props.$paused ? props.theme.primary : props.theme.borderHover};
  border-radius: 8px;
  color: ${(props) =>
    props.$paused ? props.theme.primary : props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: ${(props) => props.theme.primary}0d;
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const SnapshotActionButton = styled(PauseButton)`
  width: 100%;
  max-width: 100%;
  grid-column: 1 / -1;
  box-sizing: border-box;
  align-self: stretch;
`;

const blink = keyframes`
  0% { opacity: 0.25; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1); }
  100% { opacity: 0.25; transform: scale(0.9); }
`;

const SnapshotButtonContent = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;

const SnapshotStatusDot = styled.span<{ $active: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: ${(props) => props.theme.primary};
  opacity: ${(props) => (props.$active ? 1 : 0)};
  animation: ${(props) => (props.$active ? blink : "none")} 1s ease-in-out
    infinite;
`;

const ErrorText = styled.div`
  display: inline-flex;
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
  color: ${(props) => props.theme.danger};
  font-size: 10px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

interface SnapshotControlsSectionProps {
  snapshotWhole: boolean;
  snapshotShowWaterfall: boolean;
  snapshotShowStats: boolean;
  snapshotUseThemeColors: boolean;
  snapshotFormat: "png" | "svg" | SnapshotVideoFormat | "animated-svg";
  snapshotGridPreference: boolean;
  snapshotShowGeolocation: boolean;
  snapshotGeolocationError: string | null;
  supportedSnapshotVideoFormat: SnapshotVideoFormat | null;
  snapshotAspectRatio: SnapshotAspectRatio;
  onSnapshotWholeChange: (value: boolean) => void;
  onSnapshotShowWaterfallChange: (value: boolean) => void;
  onSnapshotShowStatsChange: (value: boolean) => void;
  onSnapshotUseThemeColorsChange: (value: boolean) => void;
  onSnapshotShowGeolocationChange: (value: boolean) => void;
  onSnapshotFormatChange: (
    value: "png" | "svg" | SnapshotVideoFormat | "animated-svg",
  ) => void;
  onSnapshotGridPreferenceChange: (value: boolean) => void;
  onSnapshotAspectRatioChange: (value: SnapshotAspectRatio) => void;
  onSnapshot: () => void;
  titlePulseToken?: number;
  isFileMode?: boolean;
  hasFileLoaded?: boolean;
  wholeChannelDisabled?: boolean;
  wholeChannelDisabledReason?: string;
}

export const SnapshotControlsSection: React.FC<
  SnapshotControlsSectionProps
> = ({
  snapshotWhole,
  snapshotShowWaterfall,
  snapshotShowStats,
  snapshotUseThemeColors,
  snapshotFormat,
  snapshotGridPreference,
  snapshotShowGeolocation,
  snapshotGeolocationError,
  supportedSnapshotVideoFormat,
  snapshotAspectRatio,
  onSnapshotWholeChange,
  onSnapshotShowWaterfallChange,
  onSnapshotShowStatsChange,
  onSnapshotUseThemeColorsChange,
  onSnapshotShowGeolocationChange,
  onSnapshotFormatChange,
  onSnapshotGridPreferenceChange,
  onSnapshotAspectRatioChange,
  onSnapshot,
  titlePulseToken,
  isFileMode = false,
  hasFileLoaded = false,
  wholeChannelDisabled = false,
  wholeChannelDisabledReason = "Whole-channel snapshots are unavailable for this source",
}) => {
  const progress = useAppSelector((state) => state.snapshot);
  const isCapturing =
    progress.stage === "started" ||
    progress.stage === "collecting" ||
    progress.stage === "encoding";

  const buttonLabel = isCapturing
    ? (progress.message ?? "Saving snapshot")
    : "Save snapshot";

  const isDisabled = isFileMode && !hasFileLoaded;
  const effectiveSnapshotWhole = wholeChannelDisabled ? false : snapshotWhole;

  return (
    <Section>
      <Collapsible
        icon={<Fullscreen size={14} />}
        label="Take a Snapshot"
        defaultOpen={false}
        titlePulseToken={titlePulseToken}
      >
        <Row label={<IconLabel icon={Scan} text="Range" />}>
          <SettingSelect
            value={effectiveSnapshotWhole ? "whole" : "onscreen"}
            onChange={(e) => {
              const nextWhole =
                e.target.value === "whole" && !wholeChannelDisabled;
              onSnapshotWholeChange(nextWhole);
            }}
            style={{ minWidth: "120px" }}
            $disabled={isDisabled}
            title={
              wholeChannelDisabled ? wholeChannelDisabledReason : undefined
            }
          >
            <option value="onscreen">On screen</option>
            {!wholeChannelDisabled ? (
              <option value="whole">Whole Channel</option>
            ) : null}
          </SettingSelect>
        </Row>

        <Row label={<IconLabel icon={SquareDashedTopSolid} text="Waterfall" />}>
          <ToggleSwitch>
            <ToggleSwitchInput
              type="checkbox"
              checked={snapshotShowWaterfall}
              disabled={isDisabled}
              onChange={(e) => onSnapshotShowWaterfallChange(e.target.checked)}
            />
            <ToggleSwitchSlider />
          </ToggleSwitch>
        </Row>

        <Row label={<IconLabel icon={Grid2X2} text="Grid" />}>
          <ToggleSwitch>
            <ToggleSwitchInput
              type="checkbox"
              checked={snapshotGridPreference}
              disabled={isDisabled}
              onChange={(e) => onSnapshotGridPreferenceChange(e.target.checked)}
            />
            <ToggleSwitchSlider />
          </ToggleSwitch>
        </Row>

        <Row label={<IconLabel icon={Paintbrush} text="Use Theme Colors?" />}>
          <ToggleSwitch>
            <ToggleSwitchInput
              type="checkbox"
              checked={snapshotUseThemeColors}
              disabled={isDisabled}
              onChange={(e) => onSnapshotUseThemeColorsChange(e.target.checked)}
            />
            <ToggleSwitchSlider />
          </ToggleSwitch>
        </Row>

        <Row label={<IconLabel icon={BookA} text="Stats" />}>
          <ToggleSwitch>
            <ToggleSwitchInput
              type="checkbox"
              checked={snapshotShowStats}
              disabled={isDisabled}
              onChange={(e) => onSnapshotShowStatsChange(e.target.checked)}
            />
            <ToggleSwitchSlider />
          </ToggleSwitch>
        </Row>

        <div
          style={{
            display: "contents",
            opacity: snapshotShowStats && !snapshotGeolocationError ? 1 : 0.5,
          }}
        >
          <Row label={<IconLabel icon={MapPin} text="Geolocation" />}>
            {snapshotGeolocationError && (
              <ErrorText title={snapshotGeolocationError}>
                {snapshotGeolocationError}
              </ErrorText>
            )}
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={
                  snapshotShowGeolocation &&
                  snapshotShowStats &&
                  !snapshotGeolocationError
                }
                disabled={
                  !snapshotShowStats || !!snapshotGeolocationError || isDisabled
                }
                onChange={(e) =>
                  onSnapshotShowGeolocationChange(e.target.checked)
                }
              />
              <ToggleSwitchSlider />
              </ToggleSwitch>
          </Row>
        </div>

        <Row label={<IconLabel icon={Ratio} text="Aspect Ratio" />}>
          <SettingSelect
            value={snapshotAspectRatio}
            onChange={(e) =>
              onSnapshotAspectRatioChange(e.target.value as SnapshotAspectRatio)
            }
            style={{ minWidth: "100px" }}
            $disabled={isDisabled}
          >
            <option value="default">Default</option>
            <option value="4:3">4:3</option>
            <option value="16:10">16:10</option>
            <option value="16:9">16:9</option>
            <option value="19.5:9">19.5:9</option>
          </SettingSelect>
        </Row>

        <Row label={<IconLabel icon={ImageIcon} text="Format" />}>
          <SettingSelect
            value={snapshotFormat}
            onChange={(e) =>
              onSnapshotFormatChange(
                e.target.value as
                  | "png"
                  | "svg"
                  | SnapshotVideoFormat
                  | "animated-svg",
              )
            }
            style={{ minWidth: "110px" }}
            $disabled={isDisabled}
          >
            <option value="png">PNG</option>
            <option value="svg">SVG</option>
            <option value="animated-svg">Animated SVG (1s)</option>
            {supportedSnapshotVideoFormat && (
              <option value={supportedSnapshotVideoFormat}>
                {supportedSnapshotVideoFormat === "mp4"
                  ? "MP4 (1s)"
                  : "WebM (1s)"}
              </option>
            )}
          </SettingSelect>
        </Row>

        <SnapshotActionButton
          $paused={false}
          onClick={onSnapshot}
          style={{ marginTop: "8px" }}
          disabled={isDisabled}
        >
          <SnapshotButtonContent>
            <SnapshotStatusDot $active={isCapturing} />
            {isDisabled ? "Load a file to capture" : buttonLabel}
          </SnapshotButtonContent>
        </SnapshotActionButton>
      </Collapsible>
    </Section>
  );
};
