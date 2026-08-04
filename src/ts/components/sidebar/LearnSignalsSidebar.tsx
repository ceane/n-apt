import React from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import {
  useLearnSignals,
  SignalSection,
  getLearnSignalsSectionPath,
} from "@n-apt/contexts/LearnSignalsContext";
import { BookOpen } from "lucide-react";
import { LearnSignalsNavGroupTitle } from "@n-apt/components/layout/LearnSignalsInteractiveShell";

const RouteContent = styled.div`
  padding: 4cqh 3cqw;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const InfoBox = styled.div`
  background: ${(props) => props.theme.primaryAnchor};
  border: 1px solid ${(props) => props.theme.primaryAlpha};
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 8px;
`;

const InfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  font-family: ${(props) => props.theme.typography.mono};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const InfoText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  line-height: 1.5;
`;

const SectionButton = styled.button<{ $isActive: boolean }>`
  width: 100%;
  text-align: left;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.primary : props.theme.border)};
  background: ${(props) =>
    props.$isActive ? props.theme.surface : "transparent"};
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) => props.theme.surfaceHover};
    color: ${(props) => props.theme.textPrimary};
    border-color: ${(props) => props.theme.borderHover};
  }
`;

export const LearnSignalsSidebar: React.FC = () => {
  const { activeSection, showIntro } = useLearnSignals();
  const navigate = useNavigate();

  const sections: SignalSection[] = [
    "Radio Waves",
    "Obstacles & Multipath Reflection",
    "Modulation",
    "Heterodyning",
    "Tx (Transmit/Broadcasting)",
    "Rx (Receive)",
    "FFT (Rx) and IFFT (Tx)",
    "Triangulation",
    "Aperture",
    "I/Q Captures",
    "FFT & IFFT",
  ];

  const capturingSections: SignalSection[] = ["I/Q Captures", "FFT & IFFT"];
  const coreSections = sections.filter(
    (section) => !capturingSections.includes(section),
  );

  const renderButton = (section: SignalSection) => (
    <SectionButton
      key={section}
      $isActive={!showIntro && activeSection === section}
      onClick={() =>
        navigate(`/learn-signals/${getLearnSignalsSectionPath(section)}`)
      }
    >
      {section}
    </SectionButton>
  );

  return (
    <RouteContent>
      <InfoBox>
        <InfoTitle>
          <BookOpen size={14} />
          Signal Processing
        </InfoTitle>
        <InfoText>
          Interactive visual guide to RF spectrum concepts, wave propagation,
          modulation, heterodyning, and FFT processing.
        </InfoText>
      </InfoBox>

      <SectionButton
        $isActive={showIntro}
        onClick={() => navigate("/learn-signals")}
      >
        {showIntro ? "Introduction View" : "Show Introduction"}
      </SectionButton>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          marginTop: "8px",
        }}
      >
        {coreSections.map(renderButton)}
        <LearnSignalsNavGroupTitle>Capturing Signals</LearnSignalsNavGroupTitle>
        {capturingSections.map(renderButton)}
      </div>
    </RouteContent>
  );
};

export default LearnSignalsSidebar;
