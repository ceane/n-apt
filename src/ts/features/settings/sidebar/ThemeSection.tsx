import React, { useState } from "react";
import styled from "styled-components";
import {
  Palette,
  Droplet,
  AudioLines,
  SquareDashedTopSolid,
  SwatchBook,
} from "lucide-react";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import {
  setAppMode as setAppModeAction,
  setAccentColor as setAccentColorAction,
  setFftColor as setFftColorAction,
  setWaterfallTheme as setWaterfallThemeAction,
  resetTheme as resetThemeAction,
} from "@n-apt/redux";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import { Row, Button, Toggle } from "@n-apt/ui";
import { Collapsible } from "@n-apt/ui/Collapsible";
import {
  SectionGrid as Section,
  CompactSelect,
  compactSelectInteractionStyles,
  IconLabel,
} from "@n-apt/ui/SidebarPrimitives";

const ResetWrapper = styled.div`
  margin-top: 12px;
  grid-column: 1 / -1;
`;

const ResetButton = styled(Button)`
  width: 100%;
  font-size: 10px;
  padding: 6px;
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
  border: 1px solid ${(props) => props.theme.borderHover};
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
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  padding: 2px 6px;
  width: 70px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }
`;

const SettingSelect = styled(CompactSelect)`
  ${compactSelectInteractionStyles}

  &:focus {
    background-color: ${(props) => props.theme.primaryAnchor};
  }
`;

const PatternSwatch = styled.span`
  display: inline-block;
  width: 42px;
  height: 20px;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  background-color: #05070d;
  background-image: repeating-linear-gradient(
    45deg,
    #c25100 0,
    #c25100 8px,
    transparent 8px,
    transparent 16px
  );
`;

export const ThemeSection: React.FC<{
  hideHeader?: boolean;
  className?: string;
}> = ({ hideHeader = false, className }) => {
  const appMode = useAppSelector((s) => s.theme.appMode);
  const accentColor = useAppSelector((s) => s.theme.accentColor);
  const fftColor = useAppSelector((s) => s.theme.fftColor);
  const waterfallTheme = useAppSelector((s) => s.theme.waterfallTheme);
  const patternOverNonHardwareSources = useAppSelector(
    (s) => s.theme.patternOverNonHardwareSources,
  );
  const dispatch = useAppDispatch();
  const [isOpen] = useState(true);

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
    <Section className={className}>
      <Collapsible
        icon={<SwatchBook size={14} />}
        label="Theme"
        defaultOpen={isOpen}
        hideHeader={hideHeader}
      >
        <Row label={<IconLabel icon={Palette} text="App Theme" />}>
          <SettingSelect
            aria-label="App Theme"
            value={appMode}
            onChange={(e) =>
              handleSetAppMode(e.target.value as "system" | "dark" | "light")
            }
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </SettingSelect>
        </Row>

        <Row label={<IconLabel icon={Droplet} text="Accent Color" />}>
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

        <Row label={<IconLabel icon={AudioLines} text="FFT Color" />}>
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

        <Row label={<IconLabel icon={SquareDashedTopSolid} text="Waterfall" />}>
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

        <Row
          label={
            <Toggle
              $active={patternOverNonHardwareSources}
              disabled
              aria-label="Pattern over non-hardware sources"
            >
              Pattern over non-hardware sources
            </Toggle>
          }
        >
          <PatternSwatch
            aria-label="45-degree diagonal stripe pattern"
            data-testid="non-hardware-pattern-swatch"
            title="Default pattern: 45-degree orange stripes"
          />
        </Row>

        <ResetWrapper>
          <ResetButton $variant="secondary" onClick={handleResetTheme}>
            Reset Theme to Defaults
          </ResetButton>
        </ResetWrapper>
      </Collapsible>
    </Section>
  );
};
