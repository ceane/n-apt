// @ts-nocheck
import { useState } from "react";
import { IntroView } from "./components/IntroView";
import { RadioWaves } from "./components/RadioWaves";
import { ObstaclesMultipath } from "./components/ObstaclesMultipath";
import { Modulation } from "./components/Modulation";
import { Heterodyning } from "./components/Heterodyning";
import { Transmit } from "./components/Transmit";
import { Receive } from "./components/Receive";
import { FFT } from "./components/FFT";
import { ThemeToggle } from "./components/ThemeToggle";
import { TriangleLattice } from "./components/TriangleLattice";
import { Triangulation } from "./components/Triangulation";
import { Aperture } from "./components/Aperture";

type Section =
  | "Radio Waves"
  | "Obstacles & Multipath Reflection"
  | "Modulation"
  | "Heterodyning"
  | "Tx (Transmit/Broadcasting)"
  | "Rx (Receive)"
  | "FFT (Rx) and IFFT (Tx)"
  | "Triangulation"
  | "Aperture";

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>("Radio Waves");

  const sections: Section[] = [
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
    return <IntroView onComplete={() => setShowIntro(false)} />;
  }

  return (
    <div className="size-full flex bg-background relative">
      {/* Triangle lattice background */}
      <TriangleLattice />

      {/* Sidebar */}
      <aside className="w-1/4 min-w-[240px] bg-card/50 backdrop-blur-sm border-r border-border p-6 overflow-y-auto relative z-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">Signal Processing</h1>
          <ThemeToggle />
        </div>
        <nav className="space-y-2">
          {sections.map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                activeSection === section
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {section}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8 relative z-10">
        <div className="max-w-4xl mx-auto">
          {activeSection === "Radio Waves" && <RadioWaves />}
          {activeSection === "Obstacles & Multipath Reflection" && <ObstaclesMultipath />}
          {activeSection === "Modulation" && <Modulation />}
          {activeSection === "Heterodyning" && <Heterodyning />}
          {activeSection === "Tx (Transmit/Broadcasting)" && <Transmit />}
          {activeSection === "Rx (Receive)" && <Receive />}
          {activeSection === "FFT (Rx) and IFFT (Tx)" && <FFT />}
          {activeSection === "Triangulation" && <Triangulation />}
          {activeSection === "Aperture" && <Aperture />}
        </div>
      </main>
    </div>
  );
}