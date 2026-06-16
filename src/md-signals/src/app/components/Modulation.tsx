// @ts-nocheck
import { motion } from "framer-motion";
import { useState } from "react";

export function Modulation() {
  const [modulationType, setModulationType] = useState<'AM' | 'FM' | 'PM'>('AM');

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Modulation</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          Modulation is the process of encoding information onto a carrier wave by varying one or more
          of its properties: amplitude, frequency, or phase.
        </p>

        <div className="bg-card border border-border rounded-lg p-6 my-6">
          <div className="flex gap-4 mb-4">
            <button
              onClick={() => setModulationType('AM')}
              className={`px-4 py-2 rounded ${modulationType === 'AM' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'} transition-colors`}
            >
              Amplitude Modulation (AM)
            </button>
            <button
              onClick={() => setModulationType('FM')}
              className={`px-4 py-2 rounded ${modulationType === 'FM' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'} transition-colors`}
            >
              Frequency Modulation (FM)
            </button>
            <button
              onClick={() => setModulationType('PM')}
              className={`px-4 py-2 rounded ${modulationType === 'PM' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'} transition-colors`}
            >
              Phase Modulation (PM)
            </button>
          </div>

          <div className="relative h-48 bg-muted rounded overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 800 200">
              {modulationType === 'AM' && (
                <motion.path
                  d="M0,100 Q50,60 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100"
                  fill="none"
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth="2"
                  animate={{
                    d: [
                      "M0,100 Q50,60 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100",
                      "M0,100 Q50,30 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100",
                      "M0,100 Q50,60 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100",
                    ],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
              )}

              {modulationType === 'FM' && (
                <motion.path
                  d="M0,100 Q40,60 80,100 T160,100 T240,100 T320,100 T400,100 T480,100 T560,100 T640,100 T720,100 T800,100"
                  fill="none"
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth="2"
                  animate={{
                    d: [
                      "M0,100 Q40,60 80,100 T160,100 T240,100 T320,100 T400,100 T480,100 T560,100 T640,100 T720,100 T800,100",
                      "M0,100 Q25,60 50,100 T100,100 T150,100 T200,100 T250,100 T300,100 T350,100 T400,100 T450,100 T500,100 T550,100 T600,100 T650,100 T700,100 T750,100 T800,100",
                      "M0,100 Q40,60 80,100 T160,100 T240,100 T320,100 T400,100 T480,100 T560,100 T640,100 T720,100 T800,100",
                    ],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
              )}

              {modulationType === 'PM' && (
                <motion.path
                  d="M0,100 Q50,60 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100"
                  fill="none"
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth="2"
                  animate={{
                    d: [
                      "M0,100 Q50,60 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100",
                      "M0,100 Q50,140 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100",
                      "M0,100 Q50,60 100,100 T200,100 T300,100 T400,100 T500,100 T600,100 T700,100 T800,100",
                    ],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </svg>
          </div>

          <p className="text-muted-foreground mt-4">
            {modulationType === 'AM' && 'Amplitude Modulation varies the signal strength to encode information.'}
            {modulationType === 'FM' && 'Frequency Modulation varies the frequency to encode information.'}
            {modulationType === 'PM' && 'Phase Modulation varies the phase shift to encode information.'}
          </p>
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
