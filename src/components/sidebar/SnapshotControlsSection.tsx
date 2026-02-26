import React from "react";
import styled from "styled-components";

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitleCollapsible = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0 0 16px 0;
  cursor: pointer;
  text-align: left;
`;

const SectionTitleLabel = styled.span`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const SectionTitleToggle = styled.span`
  font-size: 12px;
  color: #555;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
`;

const CollapsibleBody = styled.div`
  margin-top: 8px;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`;

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
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

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
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
    background-color: #00d4ff;
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
  background-color: #444;
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
  background-color: ${(props) => (props.$paused ? "#2a2a2a" : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$paused ? "#00d4ff" : "#2a2a2a")};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? "#00d4ff" : "#ccc")};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #2a2a2a;
    border-color: #00d4ff;
    color: #00d4ff;
  }
`;

interface SnapshotControlsSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  snapshotWhole: boolean;
  snapshotShowWaterfall: boolean;
  snapshotShowStats: boolean;
  snapshotFormat: "png" | "svg";
  snapshotGridPreference: boolean;
  onSnapshotWholeChange: (value: boolean) => void;
  onSnapshotShowWaterfallChange: (value: boolean) => void;
  onSnapshotShowStatsChange: (value: boolean) => void;
  onSnapshotFormatChange: (value: "png" | "svg") => void;
  onSnapshotGridPreferenceChange: (value: boolean) => void;
  onSnapshot: () => void;
}

export const SnapshotControlsSection: React.FC<SnapshotControlsSectionProps> = ({
  isOpen,
  onToggle,
  snapshotWhole,
  snapshotShowWaterfall,
  snapshotShowStats,
  snapshotFormat,
  snapshotGridPreference,
  onSnapshotWholeChange,
  onSnapshotShowWaterfallChange,
  onSnapshotShowStatsChange,
  onSnapshotFormatChange,
  onSnapshotGridPreferenceChange,
  onSnapshot,
}) => {
  return (
    <Section>
      <SectionTitleCollapsible type="button" onClick={onToggle}>
        <SectionTitleLabel>Snapshot /</SectionTitleLabel>
        <SectionTitleToggle>{isOpen ? "-" : "+"}</SectionTitleToggle>
      </SectionTitleCollapsible>

      {isOpen && (
        <CollapsibleBody>
          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Range</SettingLabel>
            </SettingLabelContainer>
            <SettingSelect
              value={snapshotWhole ? "whole" : "onscreen"}
              onChange={(e) => onSnapshotWholeChange(e.target.value === "whole")}
              style={{ minWidth: "120px" }}
            >
              <option value="onscreen">On screen</option>
              <option value="whole">Whole</option>
            </SettingSelect>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Waterfall</SettingLabel>
            </SettingLabelContainer>
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotShowWaterfall}
                onChange={(e) => onSnapshotShowWaterfallChange(e.target.checked)}
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Grid</SettingLabel>
            </SettingLabelContainer>
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotGridPreference}
                onChange={(e) => onSnapshotGridPreferenceChange(e.target.checked)}
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Stats</SettingLabel>
            </SettingLabelContainer>
            <ToggleSwitch>
              <ToggleSwitchInput
                type="checkbox"
                checked={snapshotShowStats}
                onChange={(e) => onSnapshotShowStatsChange(e.target.checked)}
              />
              <ToggleSwitchSlider />
            </ToggleSwitch>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Format</SettingLabel>
            </SettingLabelContainer>
            <SettingSelect
              value={snapshotFormat}
              onChange={(e) => onSnapshotFormatChange(e.target.value as "png" | "svg")}
              style={{ minWidth: "110px" }}
            >
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
            </SettingSelect>
          </SettingRow>

          <PauseButton
            $paused={false}
            onClick={onSnapshot}
            style={{ width: "100%", marginTop: "8px" }}
          >
            Save snapshot
          </PauseButton>
        </CollapsibleBody>
      )}
    </Section>
  );
};
