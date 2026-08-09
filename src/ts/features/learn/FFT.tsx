// @ts-nocheck
import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export function FFT() {
  const [timeData, setTimeData] = useState<number[]>([]);
  const [freqData, setFreqData] = useState<number[]>([]);

  useEffect(() => {
    const time = Array.from({ length: 64 }, (_, i) => {
      const t = i / 64;
      return Math.sin(2 * Math.PI * 3 * t) + 0.5 * Math.sin(2 * Math.PI * 7 * t) + 0.3 * Math.sin(2 * Math.PI * 11 * t);
    });
    setTimeData(time);

    const freq = Array.from({ length: 32 }, (_, i) => {
      if (i === 3 || i === 7 || i === 11) {
        return 0.7 + Math.random() * 0.3;
      }
      return Math.random() * 0.1;
    });
    setFreqData(freq);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">FFT (Rx) and IFFT (Tx)</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          The Fast Fourier Transform (FFT) and Inverse Fast Fourier Transform (IFFT) are algorithms
          that convert signals between time and frequency domains. FFT is used in receivers for signal
          analysis, while IFFT is used in transmitters for signal synthesis.
        </p>

        <div className="bg-card border border-border rounded-lg p-6 my-6">
          <h3 className="text-xl font-semibold text-foreground mb-4">Time ↔ Frequency Domain</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Time Domain Signal</p>
              <div className="h-40 bg-muted rounded p-4">
                <svg className="w-full h-full" viewBox="0 0 320 100">
                  <polyline
                    points={timeData.map((val, i) => `${i * 5},${50 - val * 20}`).join(' ')}
                    fill="none"
                    stroke="currentColor"
                    className="text-foreground"
                    strokeWidth="2"
                  />
                  <line x1="0" y1="50" x2="320" y2="50" stroke="currentColor" className="text-muted-foreground opacity-30" strokeWidth="1" />
                </svg>
              </div>
              <p className="text-xs text-muted-foreground/60 mt-2 text-center">Amplitude vs Time</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Frequency Domain (FFT)</p>
              <div className="h-40 bg-muted rounded p-4">
                <svg className="w-full h-full" viewBox="0 0 320 100">
                  {freqData.map((val, i) => (
                    <motion.rect
                      key={i}
                      x={i * 10}
                      y={100 - val * 80}
                      width="8"
                      height={val * 80}
                      fill="currentColor"
                      className="text-foreground"
                      initial={{ height: 0 }}
                      animate={{ height: val * 80 }}
                      transition={{ duration: 0.5, delay: i * 0.02 }}
                    />
                  ))}
                </svg>
              </div>
              <p className="text-xs text-muted-foreground/60 mt-2 text-center">Magnitude vs Frequency</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 mt-6">
            <div className="text-center">
              <div className="bg-primary text-primary-foreground px-6 py-2 rounded-lg">Time Domain</div>
            </div>
            <div className="text-foreground text-2xl">⇄</div>
            <div className="text-sm text-muted-foreground">
              <div>FFT →</div>
              <div>← IFFT</div>
            </div>
            <div className="text-foreground text-2xl">⇄</div>
            <div className="text-center">
              <div className="bg-primary text-primary-foreground px-6 py-2 rounded-lg">Frequency Domain</div>
            </div>
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Applications</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Receiver (FFT)</h4>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>• Spectrum analysis</li>
              <li>• Channel estimation</li>
              <li>• Signal detection</li>
              <li>• OFDM demodulation</li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Transmitter (IFFT)</h4>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>• OFDM modulation</li>
              <li>• Multi-carrier synthesis</li>
              <li>• Spectral shaping</li>
              <li>• Signal generation</li>
            </ul>
          </div>
        </div>

        <div className="bg-accent border border-border rounded-lg p-4 mt-6">
          <h4 className="font-semibold text-foreground mb-2">OFDM (Orthogonal Frequency Division Multiplexing)</h4>
          <p className="text-accent-foreground text-sm">
            Modern wireless systems like Wi-Fi and LTE use OFDM, which relies heavily on FFT/IFFT
            to transmit data across multiple orthogonal subcarriers simultaneously.
          </p>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Computational Efficiency</h3>
        <p className="text-muted-foreground mt-2">
          The FFT algorithm reduces computational complexity from O(N²) to O(N log N), making
          real-time signal processing feasible for modern communication systems.
        </p>
      </div>
    </div>
  );
}
