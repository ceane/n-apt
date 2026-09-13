// @ts-nocheck
import { motion } from "framer-motion";

export function Transmit() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Tx (Transmit/Broadcasting)</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          The transmitter (Tx) converts information into electromagnetic waves that can propagate through
          space. This involves signal generation, modulation, amplification, and radiation.
        </p>

        <div className="bg-card border border-border rounded-lg p-6 my-6">
          <h3 className="text-xl font-semibold text-foreground mb-4">Transmitter Architecture</h3>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Data Source
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Modulator
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Amplifier
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Antenna
              </div>
            </div>

            <div className="h-32 bg-muted rounded overflow-hidden mt-6">
              <svg className="w-full h-full" viewBox="0 0 800 150">
                {/* Antenna */}
                <line x1="700" y1="75" x2="700" y2="30" stroke="currentColor" className="text-foreground" strokeWidth="3" />
                <line x1="700" y1="75" x2="700" y2="120" stroke="currentColor" className="text-foreground" strokeWidth="3" />

                {/* Radiating waves */}
                {[0, 1, 2, 3].map((i) => (
                  <motion.circle
                    key={i}
                    cx="700"
                    cy="75"
                    r="20"
                    fill="none"
                    stroke="currentColor"
                    className="text-foreground"
                    strokeWidth="2"
                    initial={{ r: 20, opacity: 0.8 }}
                    animate={{ r: 80, opacity: 0 }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.5,
                      ease: "easeOut",
                    }}
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Key Components</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Signal Generator</h4>
            <p className="text-muted-foreground text-sm">
              Creates the carrier wave at the desired frequency.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Modulator</h4>
            <p className="text-muted-foreground text-sm">
              Encodes information onto the carrier wave using AM, FM, or digital modulation.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Power Amplifier</h4>
            <p className="text-muted-foreground text-sm">
              Boosts signal strength to achieve desired transmission range.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Antenna</h4>
            <p className="text-muted-foreground text-sm">
              Converts electrical signals into electromagnetic waves for propagation.
            </p>
          </div>
        </div>

        <div className="bg-accent border border-border rounded-lg p-4 mt-6">
          <p className="text-accent-foreground">
            <strong>Note:</strong> Transmitter design must comply with regulatory requirements for
            frequency allocation, power limits, and spurious emissions.
          </p>
        </div>
      </div>
    </div>
  );
}
