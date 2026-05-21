import React from "react";
import styled, { useTheme } from "styled-components";
import {
  ZodiacAquarius,
  TrainTrack,
  Radius,
  Waves,
  Combine,
  MoveHorizontal,
  Percent,
} from "lucide-react";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { type AppStyledTheme } from "@n-apt/components/ui/Theme";
import { SidebarSectionTitle } from "./ui/Collapsible";
import { Tooltip } from "./ui/Tooltip";

// OptionWrapper removed as Tooltip is now nested within OptionToggle

interface SignalCompositionProps {
  sidebar?: boolean;
}

const OptionToggle = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: ${({ theme, $active }) =>
    $active ? `${theme.colors.primary}15` : theme.colors.background};
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.border};
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 11px;
  font-weight: 500;
  color: ${({ theme, $active }) =>
    $active ? theme.colors.textPrimary : theme.colors.textSecondary};

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    background: ${({ theme }) => `${theme.colors.primary}08`};
  }

  svg {
    color: ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.textMuted};
  }
`;

const Select = styled.select`
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  outline: none;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const SignalComposition: React.FC<SignalCompositionProps> = ({ sidebar }) => {
  const theme = useTheme() as AppStyledTheme;
  const { state, dispatch } = useSpectrumStore();

  const Container = styled.div`
    ${sidebar
      ? `
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 8px;
    `
      : `
      padding: 24px;
      background: ${theme.colors.surface};
      border-bottom: 1px solid ${theme.colors.border};
      display: flex;
      flex-direction: column;
      gap: 20px;
    `}
  `;

  const Header = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
  `;

  const Title = styled.h2`
    font-size: 14px;
    font-weight: 600;
    color: ${theme.colors.textPrimary};
    margin: 0;
  `;

  const OptionsGrid = styled.div`
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(${sidebar ? "140px" : "200px"}, 1fr)
    );
    gap: ${sidebar ? "8px" : "12px"};
  `;

  const toggleOption = (option: keyof typeof state.stitchOptions) => {
    dispatch({
      type: "SET_STITCH_OPTION",
      option,
      enabled: !state.stitchOptions[option],
    });
  };

  return (
    <Container>
      {sidebar ? (
        <SidebarSectionTitle
          icon={<ZodiacAquarius size={14} />}
          title="Signal Composition"
        />
      ) : (
        <Header>
          <ZodiacAquarius size={20} color={theme.colors.primary} />
          <Title>Signal Composition</Title>
        </Header>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: `${theme.colors.surface}`,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: "6px",
          marginBottom: "4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Combine size={14} color={theme.colors.textMuted} />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: theme.colors.textSecondary,
            }}
          >
            Acquisition Mode
          </span>
        </div>
        <Select
          value={state.stitchOptions.acquisitionMode}
          onChange={(e) =>
            dispatch({
              type: "SET_STITCH_OPTION_VALUE",
              option: "acquisitionMode",
              value: e.target.value as any,
            })
          }
        >
          <option value="interleaved">Interleaved (TDMS)</option>
          <option value="stepwise">Stepwise</option>
        </Select>
      </div>

      <OptionsGrid>
        <OptionToggle
          $active={state.stitchOptions.phaseCorrection}
          onClick={() => toggleOption("phaseCorrection")}
        >
          <TrainTrack size={14} />
          <span style={{ flex: 1 }}>Phase Alignment</span>
          <Tooltip
            title="Backend: Phase Alignment"
            content="Calculates the phase offset between overlapping frames in the Rust backend and applies a corrective rotation to Hop 2. Essential for coherent signal reconstruction."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.fmDeviationCorrection}
          onClick={() => toggleOption("fmDeviationCorrection")}
        >
          <Radius size={14} />
          <span style={{ flex: 1 }}>FM Correction</span>
          <Tooltip
            title="Backend: FM Correction"
            content="Estimates and compensates for frequency drift (kHz) between the two capture windows. Reduces artifacts caused by oscillator instability."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.antiAliasing}
          onClick={() => toggleOption("antiAliasing")}
        >
          <Waves size={14} />
          <span style={{ flex: 1 }}>Anti-Aliasing</span>
          <Tooltip
            title="Backend: Anti-Aliasing"
            content="Applies a digital filter during the stitching process in Rust to suppress aliasing components at the stitch boundaries."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.noiseFloorMatching}
          onClick={() => toggleOption("noiseFloorMatching")}
        >
          <Combine size={14} />
          <span style={{ flex: 1 }}>Noise Matching</span>
          <Tooltip
            title="Backend: Noise Matching"
            content="Adjusts the relative gain of Hop 1 and Hop 2 to ensure a consistent noise floor level across the stitched transition."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.crossfading}
          onClick={() => toggleOption("crossfading")}
        >
          <MoveHorizontal size={14} />
          <span style={{ flex: 1 }}>Seamless Crossfade</span>
          <Tooltip
            title="Backend: Crossfade"
            content="Uses a weighted blend window at the overlap region to smoothly transition between the two frames."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.chineseRemainderSynthesis}
          onClick={() => toggleOption("chineseRemainderSynthesis")}
        >
          <Percent size={14} />
          <span style={{ flex: 1 }}>Chinese Remainder Synthesis</span>
          <Tooltip
            title="Backend: Chinese Remainder Synthesis"
            content="Uses Chinese Remainder Theorem logic to resolve frequency ambiguities in the interleaved capture sequence."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.jsAntiAliasing}
          onClick={() => toggleOption("jsAntiAliasing")}
        >
          <Waves size={14} />
          <span style={{ flex: 1 }}>JS Anti-Aliasing</span>
          <Tooltip
            title="Frontend: JS Anti-Aliasing"
            content="Client-side smoothing applied during final canvas rendering. Provides a cleaner visual presentation of the reconstructed spectrum."
          />
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.jsNoiseFloorMatching}
          onClick={() => toggleOption("jsNoiseFloorMatching")}
        >
          <Combine size={14} />
          <span style={{ flex: 1 }}>JS Noise Matching</span>
          <Tooltip
            title="Frontend: JS Noise Matching"
            content="JavaScript-based histogram matching applied to the rendered trace to eliminate visible 'seams' in the UI."
          />
        </OptionToggle>
      </OptionsGrid>
    </Container>
  );
};

export default SignalComposition;
