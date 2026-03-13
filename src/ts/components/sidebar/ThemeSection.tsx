import React, { useState } from "react";
import styled from "styled-components";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import { setAppMode as setAppModeAction, setAccentColor as setAccentColorAction, setFftColor as setFftColorAction, setWaterfallTheme as setWaterfallThemeAction, resetTheme as resetThemeAction } from "@n-apt/redux";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import { Row, Button } from "@n-apt/components/ui";
import {
  CollapsibleTitle,
  CollapsibleBody,
} from "@n-apt/components/ui/Collapsible";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

const ColorInputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ColorSquare = styled.input`
  appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid #444;
  cursor: pointer;
  padding: 0;
  background: none;

  &::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  &::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }
`;

const HexInput = styled.input`
  background-color: transparent;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  padding: 2px 6px;
  width: 70px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }
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
  min-width: 0;
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
    border-color: ${(props) => props.theme.primary};
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

export const ThemeSection: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dispatch = useAppDispatch();
  const {
    appMode,
    accentColor,
    fftColor,
    waterfallTheme,
  } = useAppSelector(state => state.theme);

  const handleSetAppMode = (mode: "system" | "dark" | "light") => {
    dispatch(setAppModeAction(mode));
  };

  const handleSetAccentColor = (color: string) => {
    dispatch(setAccentColorAction(color));
  };

  const handleSetFftColor = (color: string) => {
    dispatch(setFftColorAction(color));
  };

  const handleSetWaterfallTheme = (theme: string) => {
    dispatch(setWaterfallThemeAction(theme));
  };

  const handleResetTheme = () => {
    dispatch(resetThemeAction());
  };

  return (
    <Section>
      <CollapsibleTitle
        label="Theme"
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
      />
      {isOpen && (
        <CollapsibleBody>
          <Row label="App Theme" tooltip="Switch between system, dark, and light modes.">
            <SettingSelect
              value={appMode}
              onChange={(e) => handleSetAppMode(e.target.value as "system" | "dark" | "light")}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </SettingSelect>
          </Row>

          <Row label="Accent" tooltip="Choose the primary accent color for buttons and sliders.">
            <ColorInputWrapper>
              <ColorSquare
                type="color"
                value={accentColor}
                onChange={(e) => handleSetAccentColor(e.target.value)}
              />
              <HexInput
                type="text"
                value={accentColor}
                onChange={(e) => handleSetAccentColor(e.target.value)}
              />
            </ColorInputWrapper>
          </Row>

          <Row label="FFT Color" tooltip="Choose the color for the FFT line and fill.">
            <ColorInputWrapper>
              <ColorSquare
                type="color"
                value={fftColor}
                onChange={(e) => handleSetFftColor(e.target.value)}
              />
              <HexInput
                type="text"
                value={fftColor}
                onChange={(e) => handleSetFftColor(e.target.value)}
              />
            </ColorInputWrapper>
          </Row>

          <Row label="Waterfall" tooltip="Select a colormap for the waterfall display.">
            <SettingSelect
              value={waterfallTheme}
              onChange={(e) => handleSetWaterfallTheme(e.target.value)}
            >
              {Object.keys(WATERFALL_COLORMAPS).map((id) => (
                <option key={id} value={id}>
                  {id.charAt(0).toUpperCase() + id.slice(1).replace("_", " ")}
                </option>
              ))}
            </SettingSelect>
          </Row>

          <div style={{ marginTop: "12px", gridColumn: "1 / -1" }}>
            <Button
              $variant="secondary"
              onClick={handleResetTheme}
              style={{ width: "100%", fontSize: "10px", padding: "6px" }}
            >
              Reset Theme to Defaults
            </Button>
          </div>
        </CollapsibleBody>
      )}
    </Section>
  );
};
