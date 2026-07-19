import React from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import {
  useLearnSignals,
  SignalSection,
} from "@n-apt/contexts/LearnSignalsContext";
import { IntroView } from "@n-apt/md-signals/src/app/components/IntroView";
import { RadioWaves } from "@n-apt/md-signals/src/app/components/RadioWaves";
import { ObstaclesMultipath } from "@n-apt/md-signals/src/app/components/ObstaclesMultipath";
import { Modulation } from "@n-apt/md-signals/src/app/components/Modulation";
import { Heterodyning } from "@n-apt/md-signals/src/app/components/Heterodyning";
import { Transmit } from "@n-apt/md-signals/src/app/components/Transmit";
import { Receive } from "@n-apt/md-signals/src/app/components/Receive";
import { FFT } from "@n-apt/md-signals/src/app/components/FFT";
import { TriangleLattice } from "@n-apt/md-signals/src/app/components/TriangleLattice";
import { Triangulation } from "@n-apt/md-signals/src/app/components/Triangulation";
import { Aperture } from "@n-apt/md-signals/src/app/components/Aperture";
import { ThemeToggle } from "@n-apt/md-signals/src/app/components/ThemeToggle";

// Import CSS styles of md-signals
import "@n-apt/md-signals/src/styles/index.css";

const StandaloneSignalsWrapper = styled.div`
  /* Keep this route's colors local while sharing the app typography token. */
  font-family: ${(props) => props.theme.typography.sans};

  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};

  /* Ensure nested interactive content uses the same shared typography. */
  &,
  * {
    font-family: ${(props) => props.theme.typography.sans};
  }

  /* Sidebar styling matching Figma Make */
  aside {
    background-color: ${(props) => props.theme.background};
    border-right: 1px solid ${(props) => props.theme.border};
    padding: 32px 24px;
    width: 280px;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    box-sizing: border-box;
    z-index: 10;

    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: ${(props) => props.theme.textPrimary};
      margin: 0;
    }

    nav {
      margin-top: 32px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    button {
      font-size: 14px;
      font-weight: 500;
      padding: 12px 16px;
      border-radius: 8px;
      text-align: left;
      width: 100%;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      background: transparent;
      color: ${(props) => props.theme.textSecondary};

      &:hover {
        background-color: ${(props) => props.theme.surfaceHover};
        color: ${(props) => props.theme.textPrimary};
      }

      &.bg-primary {
        background-color: ${(props) => props.theme.primary} !important;
        color: ${(props) => props.theme.background} !important;
        font-weight: 600;
      }
    }

    .border-t {
      border-top: 1px solid ${(props) => props.theme.border} !important;
    }

    a.back-to-napt {
      font-size: 14px !important;
      font-weight: 500 !important;
      padding: 12px 16px !important;
      border-radius: 8px !important;
      text-align: left !important;
      width: 100% !important;
      box-sizing: border-box !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      color: ${(props) => props.theme.textSecondary} !important;
      text-decoration: none !important;

      &:hover {
        background-color: ${(props) => props.theme.surfaceHover} !important;
        color: ${(props) => props.theme.textPrimary} !important;
      }
    }

    /* Style the ThemeToggle button specifically */
    button[aria-label="Toggle theme"] {
      border: 1px solid ${(props) => props.theme.border} !important;
      background-color: transparent !important;
      color: ${(props) => props.theme.textPrimary} !important;
      width: 36px !important;
      height: 36px !important;
      min-width: 36px !important;
      padding: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 8px !important;

      &:hover {
        background-color: ${(props) => props.theme.surfaceHover} !important;
        border-color: ${(props) => props.theme.borderHover} !important;
      }

      svg {
        width: 16px !important;
        height: 16px !important;
        color: ${(props) => props.theme.textPrimary} !important;
      }
    }
  }

  /* Main content styling matching Figma Make */
  main {
    padding: 48px;
    background-color: ${(props) => props.theme.background};
    flex: 1;
    overflow-y: auto;
    z-index: 10;

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

    /* Wave Visualization card styling */
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

    /* Wave Visualization svg container */
    .bg-muted {
      background-color: ${(props) => props.theme.surfaceHover} !important;
      border-radius: 8px !important;
      border: 1px solid ${(props) => props.theme.border} !important;

      svg path {
        stroke: ${(props) => props.theme.textPrimary} !important;
      }
    }

    /* Key Properties section */
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

    /* Speed of light box */
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

    /* Tabs/Pills inside pages (e.g. Modulation tabs, Triangulation tabs) */
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
  }
`;

export const LearnSignalsRoute: React.FC = () => {
  const { activeSection, setActiveSection, showIntro, setShowIntro } =
    useLearnSignals();

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
  ];

  if (showIntro) {
    return (
      <div
        className="size-full bg-background relative overflow-y-auto"
        style={{ height: "100%", width: "100%" }}
      >
        <IntroView onComplete={() => setShowIntro(false)} />
      </div>
    );
  }

  return (
    <StandaloneSignalsWrapper>
      {/* Triangle lattice background */}
      <TriangleLattice />

      {/* Sidebar */}
      <aside>
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1>Signal Processing</h1>
            <ThemeToggle />
          </div>
          <nav className="space-y-2">
            {sections.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={activeSection === section ? "bg-primary" : ""}
              >
                {section}
              </button>
            ))}
            <div className="pt-4 border-t mt-4">
              <Link to="/" className="back-to-napt">
                ← Back to N-APT
              </Link>
            </div>
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main>
        <div className="max-w-4xl mx-auto">
          {activeSection === "Radio Waves" && <RadioWaves />}
          {activeSection === "Obstacles & Multipath Reflection" && (
            <ObstaclesMultipath />
          )}
          {activeSection === "Modulation" && <Modulation />}
          {activeSection === "Heterodyning" && <Heterodyning />}
          {activeSection === "Tx (Transmit/Broadcasting)" && <Transmit />}
          {activeSection === "Rx (Receive)" && <Receive />}
          {activeSection === "FFT (Rx) and IFFT (Tx)" && <FFT />}
          {activeSection === "Triangulation" && <Triangulation />}
          {activeSection === "Aperture" && <Aperture />}
        </div>
      </main>
    </StandaloneSignalsWrapper>
  );
};

export default LearnSignalsRoute;
