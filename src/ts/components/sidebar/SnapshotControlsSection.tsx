import React from "react";
import styled from "styled-components";
import { Row, Collapsible } from "@n-apt/components/ui";
import { Toggle as ToggleBase } from "@n-apt/components/ui/Toggle";
import {
  BookA,
  Fullscreen,
  Grid2X2,
  Image as ImageIcon,
  MapPin,
  Scan,
  SquareDashedTopSolid,
} from "lucide-react";
import type { SnapshotVideoFormat } from "@n-apt/hooks/useSnapshot";

const ToggleWrapper = styled.div`
  display: flex;
  align-items: center;
  pointer-events: auto;
`;

const StyledToggle = (props: { $active: boolean; onClick?: () => void; disabled?: boolean; children?: React.ReactNode; title?: string }) => (
  <ToggleWrapper
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!props.disabled && props.onClick) {
        props.onClick();
      }
    }}
  >
    <ToggleBase {...props} />
  </ToggleWrapper>
);

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

const LabelWithIcon = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  line-height: 1.2;

  svg {
    width: 14px;
    height: 14px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.5;
  }
`;

const IconLabel: React.FC<{ icon: React.ComponentType<any>; text: string }> = ({ icon: IconComponent, text }) => (
  <LabelWithIcon>
    <IconComponent size={14} strokeWidth={1.75} aria-hidden="true" />
    {text}
  </LabelWithIcon>
);

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

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? props.theme.primaryAnchor : props.theme.surface)};
  border: 1px solid ${(props) => (props.$paused ? props.theme.primary : props.theme.borderHover)};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? props.theme.primary : props.theme.textPrimary)};
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

const ErrorText = styled.div`
  color: ${(props) => props.theme.danger};
  font-size: 10px;
  margin-top: -4px;
  grid-column: 2;
`;

interface SnapshotControlsSectionProps {
  snapshotWhole: boolean;
  snapshotShowWaterfall: boolean;
  snapshotShowStats: boolean;
  snapshotFormat: "png" | "svg" | SnapshotVideoFormat;
  snapshotGridPreference: boolean;
  snapshotShowGeolocation: boolean;
  snapshotGeolocationError: string | null;
  supportedSnapshotVideoFormat: SnapshotVideoFormat | null;
  onSnapshotWholeChange: (value: boolean) => void;
  onSnapshotShowWaterfallChange: (value: boolean) => void;
  onSnapshotShowStatsChange: (value: boolean) => void;
  onSnapshotShowGeolocationChange: (value: boolean) => void;
  onSnapshotFormatChange: (value: "png" | "svg" | SnapshotVideoFormat) => void;
  onSnapshotGridPreferenceChange: (value: boolean) => void;
  onSnapshot: () => void;
}

export const SnapshotControlsSection: React.FC<
  SnapshotControlsSectionProps
> = ({
  snapshotWhole,
  snapshotShowWaterfall,
  snapshotShowStats,
  snapshotFormat,
  snapshotGridPreference,
  snapshotShowGeolocation,
  snapshotGeolocationError,
  supportedSnapshotVideoFormat,
  onSnapshotWholeChange,
  onSnapshotShowWaterfallChange,
  onSnapshotShowStatsChange,
  onSnapshotShowGeolocationChange,
  onSnapshotFormatChange,
  onSnapshotGridPreferenceChange,
  onSnapshot,
}) => {
    return (
      <Section>
        <Collapsible
          icon={<Fullscreen size={14} />}
          label="Snapshot Controls"
          defaultOpen={false}
        >
          <Row label={<IconLabel icon={Scan} text="Range" />}>
            <SettingSelect
              value={snapshotWhole ? "whole" : "onscreen"}
              onChange={(e) =>
                onSnapshotWholeChange(e.target.value === "whole")
              }
              style={{ minWidth: "120px" }}
            >
              <option value="onscreen">On screen</option>
              <option value="whole">Whole Channel</option>
            </SettingSelect>
          </Row>

          <Row label={<IconLabel icon={SquareDashedTopSolid} text="Waterfall" />}>
            <StyledToggle
              $active={snapshotShowWaterfall}
              onClick={() => onSnapshotShowWaterfallChange(!snapshotShowWaterfall)}
            />
          </Row>

<Row label={<IconLabel icon={Grid2X2} text="Grid" />}>
            <StyledToggle
              $active={snapshotGridPreference}
              onClick={() => onSnapshotGridPreferenceChange(!snapshotGridPreference)}
            />
          </Row>

          <Row label={<IconLabel icon={BookA} text="Stats" />}>
            <StyledToggle
              $active={snapshotShowStats}
              onClick={() => onSnapshotShowStatsChange(!snapshotShowStats)}
            />
          </Row>

          <div style={{ display: 'contents', opacity: (snapshotShowStats && !snapshotGeolocationError) ? 1 : 0.5 }}>
            <Row label={<IconLabel icon={MapPin} text="Geolocation" />}>
              <StyledToggle
              $active={snapshotShowGeolocation && snapshotShowStats && !snapshotGeolocationError}
              onClick={() => onSnapshotShowGeolocationChange(!snapshotShowGeolocation)}
              disabled={!snapshotShowStats || !!snapshotGeolocationError}
            />
            </Row>
            {snapshotGeolocationError && (
              <Row label="">
                <ErrorText>{snapshotGeolocationError}</ErrorText>
              </Row>
            )}
          </div>

          <Row label={<IconLabel icon={ImageIcon} text="Format" />}>
            <SettingSelect
              value={snapshotFormat}
              onChange={(e) =>
                onSnapshotFormatChange(e.target.value as "png" | "svg" | SnapshotVideoFormat)
              }
              style={{ minWidth: "110px" }}
            >
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
              {supportedSnapshotVideoFormat && (
                <option value={supportedSnapshotVideoFormat}>
                  {supportedSnapshotVideoFormat === "mp4" ? "MP4 1s" : "WEBM 1s"}
                </option>
              )}
            </SettingSelect>
          </Row>

          <SnapshotActionButton
            $paused={false}
            onClick={onSnapshot}
            style={{ marginTop: "8px" }}
          >
            Save snapshot
          </SnapshotActionButton>
        </Collapsible >
      </Section >
    );
  };
