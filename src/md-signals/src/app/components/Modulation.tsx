// @ts-nocheck
import {
  AmplitudeModulationCanvas,
  FrequencyModulationCanvas,
  PhaseShiftingCanvas,
} from "@n-apt/md-preview/components/canvas";

export function Modulation() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Modulation</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          Modulation is the process of encoding information onto a carrier wave by varying one or more
          of its properties: amplitude, frequency, or phase.
        </p>

        <div className="space-y-8 my-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Amplitude Modulation (AM)</h3>
            <AmplitudeModulationCanvas />
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Frequency Modulation (FM)</h3>
            <FrequencyModulationCanvas />
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Phase Modulation (PM)</h3>
            <PhaseShiftingCanvas />
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Common Modulation Schemes</h3>
        <ul className="text-muted-foreground space-y-2 mt-4">
          <li><strong className="text-foreground">ASK (Amplitude Shift Keying):</strong> Digital version of AM</li>
          <li><strong className="text-foreground">FSK (Frequency Shift Keying):</strong> Digital version of FM</li>
          <li><strong className="text-foreground">PSK (Phase Shift Keying):</strong> Digital version of PM</li>
          <li><strong className="text-foreground">QAM (Quadrature Amplitude Modulation):</strong> Combines amplitude and phase</li>
        </ul>
      </div>
    </div>
  );
}
