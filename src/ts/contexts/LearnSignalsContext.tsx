import React, { createContext, useContext, useState } from "react";

export type SignalSection =
  | "Radio Waves"
  | "Obstacles & Multipath Reflection"
  | "Modulation"
  | "Heterodyning"
  | "Tx (Transmit/Broadcasting)"
  | "Rx (Receive)"
  | "FFT (Rx) and IFFT (Tx)"
  | "Triangulation"
  | "Aperture";

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
  const [showIntro, setShowIntro] = useState(true);
  const [activeSection, setActiveSection] =
    useState<SignalSection>("Radio Waves");

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
