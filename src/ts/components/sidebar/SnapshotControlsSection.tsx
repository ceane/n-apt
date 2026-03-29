import React from "react";
import styled from "styled-components";
import { Row, Collapsible } from "@n-apt/components/ui";
import {
  BookA,
  Fullscreen,
  Grid2X2,
  Image as ImageIcon,
  MapPin,
  Scan,
  SquareDashedTopSolid,
} from "lucide-react";

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

const ToggleSwitch = styled.label`
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: pointer;
`;

const ToggleSwitchInput = styled.input`
  opacity: 0;
  width: 44px;
  height: 24px;
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  cursor: pointer;

  &:checked + span {
    background-color: ${(props) => props.theme.primary};
  }

  &:checked + span:before {
    transform: translateX(20px);
  }
`;

const ToggleSwitchSlider = styled.span`
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) => props.theme.borderHover};
  transition: 0.2s;
  border-radius: 24px;

  &:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
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
  snapshotFormat: "png" | "svg";
  snapshotGridPreference: boolean;
  snapshotShowGeolocation: boolean;
  snapshotGeolocationError: string | null;
  onSnapshotWholeChange: (value: boolean) => void;
  onSnapshotShowWaterfallChange: (value: boolean) => void;
  onSnapshotShowStatsChange: (value: boolean) => void;
  onSnapshotShowGeolocationChange: (value: boolean) => void;
  onSnapshotFormatChange: (value: "png" | "svg") => void;
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
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotShowWaterfall}
                onChange={(e) =>
                  onSnapshotShowWaterfallChange(e.target.checked)
                }
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </Row>

          <Row label={<IconLabel icon={SquareDashedTopSolid} text="Waterfall" />}>
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotShowWaterfall}
                onChange={(e) =>
                  onSnapshotShowWaterfallChange(e.target.checked)
                }
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </Row>

          <Row label={<IconLabel icon={Grid2X2} text="Grid" />}>
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotGridPreference}
                onChange={(e) =>
                  onSnapshotGridPreferenceChange(e.target.checked)
                }
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </Row>

          <Row label={<IconLabel icon={BookA} text="Stats" />}>
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotShowStats}
                onChange={(e) => onSnapshotShowStatsChange(e.target.checked)}
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </Row>

          <div style={{ display: 'contents', opacity: (snapshotShowStats && !snapshotGeolocationError) ? 1 : 0.5 }}>
            <Row label={<IconLabel icon={MapPin} text="Geolocation" />}>
              <ToggleSwitch>
                <ToggleSwitchInput
                  type="checkbox"
                  checked={snapshotShowGeolocation && snapshotShowStats && !snapshotGeolocationError}
                  disabled={!snapshotShowStats || !!snapshotGeolocationError}
                  onChange={(e) => onSnapshotShowGeolocationChange(e.target.checked)}
                />
                <ToggleSwitchSlider />
              </ToggleSwitch>
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
                onSnapshotFormatChange(e.target.value as "png" | "svg")
              }
              style={{ minWidth: "110px" }}
            >
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
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
