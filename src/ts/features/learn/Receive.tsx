// @ts-nocheck
import { motion } from "framer-motion";

export function Receive() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Rx (Receive)</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          The receiver (Rx) captures electromagnetic waves and converts them back into usable information.
          This involves signal capture, filtering, amplification, demodulation, and decoding.
        </p>

        <div className="bg-card border border-border rounded-lg p-6 my-6">
          <h3 className="text-xl font-semibold text-foreground mb-4">Receiver Architecture</h3>

          <div className="space-y-4">
            <div className="h-32 bg-muted rounded overflow-hidden mb-6">
              <svg className="w-full h-full" viewBox="0 0 800 150">
                {/* Antenna */}
                <line x1="100" y1="75" x2="100" y2="30" stroke="currentColor" className="text-foreground" strokeWidth="3" />
                <line x1="100" y1="75" x2="100" y2="120" stroke="currentColor" className="text-foreground" strokeWidth="3" />

                {/* Incoming waves */}
                {[0, 1, 2, 3].map((i) => (
                  <motion.circle
                    key={i}
                    cx="100"
                    cy="75"
                    r="80"
                    fill="none"
                    stroke="currentColor"
                    className="text-foreground"
                    strokeWidth="2"
                    initial={{ r: 80, opacity: 0 }}
                    animate={{ r: 20, opacity: 0.8 }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.5,
                      ease: "easeIn",
                    }}
                  />
                ))}
              </svg>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Antenna
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                RF Amplifier
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Mixer
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                IF Amplifier
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Demodulator
              </div>
              <div className="text-foreground text-2xl">→</div>
              <div className="bg-primary text-primary-foreground px-4 py-3 rounded-lg min-w-[140px] text-center">
                Data Output
              </div>
            </div>
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Key Components</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Antenna</h4>
            <p className="text-muted-foreground text-sm">
              Captures electromagnetic waves and converts them to electrical signals.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Low Noise Amplifier (LNA)</h4>
            <p className="text-muted-foreground text-sm">
              Amplifies weak signals while minimizing added noise.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Band-Pass Filter</h4>
            <p className="text-muted-foreground text-sm">
              Selects desired frequency range and rejects unwanted signals.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Demodulator</h4>
            <p className="text-muted-foreground text-sm">
              Extracts information from the modulated carrier wave.
            </p>
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Receiver Performance Metrics</h3>
        <ul className="text-muted-foreground space-y-2 mt-4">
          <li><strong className="text-foreground">Sensitivity:</strong> Minimum signal strength for reliable reception</li>
          <li><strong className="text-foreground">Selectivity:</strong> Ability to reject adjacent channel interference</li>
          <li><strong className="text-foreground">Dynamic Range:</strong> Range of signal strengths that can be processed</li>
          <li><strong className="text-foreground">Noise Figure:</strong> Measure of noise added by the receiver</li>
        </ul>
      </div>
    </div>
  );
}
