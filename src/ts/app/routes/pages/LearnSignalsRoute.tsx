import React from "react";
import styled from "styled-components";
import { useNavigate } from "react-router";
import {
  useLearnSignals,
  SignalSection,
  getLearnSignalsSectionPath,
} from "@n-apt/learn/public/context/LearnSignalsContext";
import {
  LearnSignalsInteractiveShell,
  LearnSignalsNavButton,
  LearnSignalsNavGroupTitle,
} from "@n-apt/learn/layout/LearnSignalsInteractiveShell";
import { LearnSignalsIntroStage } from "@n-apt/learn/layout/LearnSignalsIntroStage";
import { RadioWaves } from "@n-apt/learn/RadioWaves";
import { ObstaclesMultipath } from "@n-apt/learn/ObstaclesMultipath";
import { Modulation } from "@n-apt/learn/Modulation";
import { Heterodyning } from "@n-apt/learn/Heterodyning";
import { Transmit } from "@n-apt/learn/Transmit";
import { Receive } from "@n-apt/learn/Receive";
import { TriangleLattice } from "@n-apt/learn/TriangleLattice";
import { Triangulation } from "@n-apt/learn/Triangulation";
import { Aperture } from "@n-apt/learn/Aperture";
import { IQCapturesContent } from "@n-apt/learn/faq/IQCapturesContent";
import { FFTIFFTContent } from "@n-apt/learn/faq/FFTIFFTContent";
import { RMSContent } from "@n-apt/learn/faq/RMSContent";

import "@n-apt/learn/styles/index.css";

const SignalsContentScope = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  font-family: ${(props) => props.theme.typography.sans};

  &,
  * {
    font-family: ${(props) => props.theme.typography.sans};
  }
`;

const SignalsMain = styled.main`
  position: relative;
  z-index: 10;
  height: 100%;
  padding: 48px;
  background-color: ${(props) => props.theme.background};
  overflow-y: auto;
  box-sizing: border-box;

  h2 {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.8px;
    color: ${(props) => props.theme.textPrimary};
    margin-top: 0;
    margin-bottom: 20px;
  }

  p.text-muted-foreground {
    font-size: 15px;
    line-height: 1.6;
    color: ${(props) => props.theme.textSecondary};
    margin-bottom: 28px;
  }

  .bg-card {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    border-radius: 12px !important;
    padding: 24px !important;
    margin: 28px 0 !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;

    h3 {
      font-size: 18px;
      font-weight: 600;
      color: ${(props) => props.theme.textPrimary};
      margin-top: 0;
      margin-bottom: 16px;
    }
  }

  .bg-muted {
    background-color: ${(props) => props.theme.surfaceHover} !important;
    border-radius: 8px !important;
    border: 1px solid ${(props) => props.theme.border} !important;

    svg path {
      stroke: ${(props) => props.theme.textPrimary} !important;
    }
  }

  h3 {
    font-size: 18px;
    font-weight: 600;
    color: ${(props) => props.theme.textPrimary};
    margin-top: 32px;
    margin-bottom: 16px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-left: 0;
    list-style-type: none;

    li {
      font-size: 14px;
      color: ${(props) => props.theme.textSecondary};

      strong {
        color: ${(props) => props.theme.textPrimary};
        font-weight: 600;
      }
    }
  }

  .bg-accent {
    background-color: ${(props) => props.theme.surfaceHover} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    border-radius: 8px !important;
    padding: 16px !important;
    margin-top: 28px !important;

    p {
      margin: 0;
      font-size: 14px;
      color: ${(props) => props.theme.textPrimary};
      line-height: 1.5;

      strong {
        font-weight: 600;
      }
    }
  }

  button {
    font-size: 13px !important;
    font-weight: 500 !important;
    padding: 10px 18px !important;
    border-radius: 8px !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    cursor: pointer !important;
    transition: all 0.2s ease !important;
    background-color: ${(props) => props.theme.surface} !important;
    color: ${(props) => props.theme.textSecondary} !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    line-height: 1.4;

    &:hover {
      background-color: ${(props) => props.theme.surfaceHover} !important;
      color: ${(props) => props.theme.textPrimary} !important;
    }

    &.bg-primary {
      background-color: ${(props) => props.theme.primary} !important;
      color: ${(props) => props.theme.background} !important;
      border-color: ${(props) => props.theme.primary} !important;
      font-weight: 600 !important;
    }
  }

  .border-b button {
    border: none !important;
    border-bottom: 2px solid transparent !important;
    background-color: transparent !important;
    border-radius: 0 !important;
    padding: 12px 18px !important;

    &:hover {
      background-color: transparent !important;
      color: ${(props) => props.theme.textPrimary} !important;
    }

    &.border-foreground {
      border-bottom: 2px solid ${(props) => props.theme.textPrimary} !important;
      color: ${(props) => props.theme.textPrimary} !important;
    }
  }
`;

const CAPTURING_SECTIONS: SignalSection[] = [
  "I/Q Captures",
  "FFT & IFFT",
  "RMS",
];

const renderSignalsNav = (
  sections: SignalSection[],
  activeSection: SignalSection,
  navigate: (path: string) => void,
  showIntro: boolean,
) => {
  const capturingSections = CAPTURING_SECTIONS.filter((section) =>
    sections.includes(section),
  );
  const coreSections = sections.filter(
    (section) => !CAPTURING_SECTIONS.includes(section),
  );

  const renderButton = (section: SignalSection) => (
    <LearnSignalsNavButton
      key={section}
      type="button"
      $active={!showIntro && activeSection === section}
      onClick={() => navigate(`/learn/${getLearnSignalsSectionPath(section)}`)}
    >
      {section}
    </LearnSignalsNavButton>
  );

  return (
    <>
      <LearnSignalsNavButton
        type="button"
        $active={showIntro}
        onClick={() => navigate("/learn")}
      >
        Introduction
      </LearnSignalsNavButton>
      {coreSections.map(renderButton)}
      {capturingSections.length > 0 && (
        <>
          <LearnSignalsNavGroupTitle>
            Capturing Signals
          </LearnSignalsNavGroupTitle>
          {capturingSections.map(renderButton)}
        </>
      )}
    </>
  );
};

export const LearnSignalsRoute: React.FC = () => {
  const { activeSection, setActiveSection, showIntro, setShowIntro } =
    useLearnSignals();
  const navigate = useNavigate();

  const sections: SignalSection[] = [
    "Radio Waves",
    "Obstacles & Multipath Reflection",
    "Modulation",
    "Heterodyning",
    "Tx (Transmit/Broadcasting)",
    "Rx (Receive)",
    "Triangulation",
    "Aperture",
    "I/Q Captures",
    "FFT & IFFT",
    "RMS",
  ];

  const nav = renderSignalsNav(
    sections,
    activeSection,
    (path) => navigate(path),
    showIntro,
  );

  if (showIntro) {
    return <LearnSignalsIntroStage onComplete={() => setShowIntro(false)} />;
  }

  return (
    <LearnSignalsInteractiveShell nav={nav}>
      <SignalsContentScope>
        <TriangleLattice />
        <SignalsMain>
          <div className="max-w-4xl mx-auto">
            {activeSection === "Radio Waves" && <RadioWaves />}
            {activeSection === "Obstacles & Multipath Reflection" && (
              <ObstaclesMultipath />
            )}
            {activeSection === "Modulation" && <Modulation />}
            {activeSection === "Heterodyning" && <Heterodyning />}
            {activeSection === "Tx (Transmit/Broadcasting)" && <Transmit />}
            {activeSection === "Rx (Receive)" && <Receive />}
            {activeSection === "Triangulation" && <Triangulation />}
            {activeSection === "Aperture" && <Aperture />}
            {activeSection === "I/Q Captures" && <IQCapturesContent />}
            {activeSection === "FFT & IFFT" && <FFTIFFTContent />}
            {activeSection === "RMS" && <RMSContent />}
          </div>
        </SignalsMain>
      </SignalsContentScope>
    </LearnSignalsInteractiveShell>
  );
};

export default LearnSignalsRoute;
