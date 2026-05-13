import React from "react";
import styled, { useTheme } from "styled-components";
import { 
  ZodiacAquarius, 
  Zap, 
  Compass, 
  Waves, 
  Activity, 
  MoveHorizontal, 
  Cpu 
} from "lucide-react";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { type AppStyledTheme } from "@n-apt/components/ui/Theme";
import { SidebarSectionTitle } from "./ui/Collapsible";

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
  border: 1px solid ${({ theme, $active }) => 
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
    grid-template-columns: repeat(auto-fill, minmax(${sidebar ? "140px" : "200px"}, 1fr));
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

      <OptionsGrid>
        <OptionToggle
          $active={state.stitchOptions.phaseCorrection}
          onClick={() => toggleOption("phaseCorrection")}
        >
          <Zap size={14} />
          <span>Phase Alignment</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.fmDeviationCorrection}
          onClick={() => toggleOption("fmDeviationCorrection")}
        >
          <Compass size={14} />
          <span>FM Correction</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.antiAliasing}
          onClick={() => toggleOption("antiAliasing")}
        >
          <Waves size={14} />
          <span>Anti-Aliasing</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.noiseFloorMatching}
          onClick={() => toggleOption("noiseFloorMatching")}
        >
          <Activity size={14} />
          <span>Noise Matching</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.crossfading}
          onClick={() => toggleOption("crossfading")}
        >
          <MoveHorizontal size={14} />
          <span>Seamless Crossfade</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.chineseRemainderSynthesis}
          onClick={() => toggleOption("chineseRemainderSynthesis")}
        >
          <Cpu size={14} />
          <span>Chinese Remainder Synthesis</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.jsAntiAliasing}
          onClick={() => toggleOption("jsAntiAliasing")}
        >
          <Waves size={14} />
          <span>JS Anti-Aliasing</span>
        </OptionToggle>

        <OptionToggle
          $active={state.stitchOptions.jsNoiseFloorMatching}
          onClick={() => toggleOption("jsNoiseFloorMatching")}
        >
          <Activity size={14} />
          <span>JS Noise Matching</span>
        </OptionToggle>
      </OptionsGrid>
    </Container>
  );
};

export default SignalComposition;
