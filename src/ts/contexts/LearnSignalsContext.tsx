import React, { createContext, useContext, useEffect, useState } from "react";
import { useParams } from "react-router";

export type SignalSection =
  | "Radio Waves"
  | "Obstacles & Multipath Reflection"
  | "Modulation"
  | "Heterodyning"
  | "Tx (Transmit/Broadcasting)"
  | "Rx (Receive)"
  | "FFT (Rx) and IFFT (Tx)"
  | "Triangulation"
  | "Aperture"
  | "I/Q Captures"
  | "FFT & IFFT";

export const LEARN_SIGNALS_SECTION_SLUGS: Record<string, SignalSection> = {
  "radio-waves": "Radio Waves",
  "obstacles-multipath": "Obstacles & Multipath Reflection",
  modulation: "Modulation",
  heterodyning: "Heterodyning",
  tx: "Tx (Transmit/Broadcasting)",
  rx: "Rx (Receive)",
  "fft-rx-ifft-tx": "FFT (Rx) and IFFT (Tx)",
  triangulation: "Triangulation",
  aperture: "Aperture",
  "iq-captures": "I/Q Captures",
  "fft-ifft": "FFT & IFFT",
};

export const LEARN_SIGNALS_SECTION_PATHS: Record<SignalSection, string> = {
  "Radio Waves": "radio-waves",
  "Obstacles & Multipath Reflection": "obstacles-multipath",
  Modulation: "modulation",
  Heterodyning: "heterodyning",
  "Tx (Transmit/Broadcasting)": "tx",
  "Rx (Receive)": "rx",
  "FFT (Rx) and IFFT (Tx)": "fft-rx-ifft-tx",
  Triangulation: "triangulation",
  Aperture: "aperture",
  "I/Q Captures": "iq-captures",
  "FFT & IFFT": "fft-ifft",
};

export const getLearnSignalsSectionPath = (section: SignalSection): string =>
  LEARN_SIGNALS_SECTION_PATHS[section];

export const getLearnSignalsSectionFromSlug = (
  slug: string | undefined,
): SignalSection | undefined =>
  slug ? LEARN_SIGNALS_SECTION_SLUGS[slug] : undefined;

interface LearnSignalsContextType {
  activeSection: SignalSection;
  setActiveSection: (section: SignalSection) => void;
  showIntro: boolean;
  setShowIntro: (show: boolean) => void;
}

const LearnSignalsContext = createContext<LearnSignalsContextType | undefined>(
  undefined,
);

export const LearnSignalsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { sectionSlug } = useParams();
  const section = getLearnSignalsSectionFromSlug(sectionSlug);
  const [showIntro, setShowIntro] = useState(section == null);
  const [activeSection, setActiveSection] = useState<SignalSection>(
    section ?? "Radio Waves",
  );

  useEffect(() => {
    if (section) {
      setActiveSection(section);
      setShowIntro(false);
    } else {
      setShowIntro(true);
    }
  }, [section]);

  return (
    <LearnSignalsContext.Provider
      value={{
        activeSection,
        setActiveSection,
        showIntro,
        setShowIntro,
      }}
    >
      {children}
    </LearnSignalsContext.Provider>
  );
};

export const useLearnSignals = () => {
  const context = useContext(LearnSignalsContext);
  if (!context) {
    throw new Error(
      "useLearnSignals must be used within a LearnSignalsProvider",
    );
  }
  return context;
};
