// @ts-nocheck
import { motion } from "framer-motion";

export function ObstaclesMultipath() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Obstacles & Multipath Reflection</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          Radio waves interact with the environment through reflection, diffraction, and scattering.
          Multiple signal paths can cause interference patterns and signal degradation.
        </p>

        <div className="bg-card border border-border rounded-lg p-6 my-6">
          <h3 className="text-xl font-semibold text-foreground mb-4">Multipath Visualization</h3>
          <div className="relative h-64 bg-muted rounded overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 400 300">
              {/* Transmitter */}
              <circle cx="50" cy="150" r="8" fill="currentColor" className="text-foreground" />
              <text x="50" y="180" fill="currentColor" className="text-foreground" fontSize="12" textAnchor="middle">TX</text>

              {/* Receiver */}
              <circle cx="350" cy="150" r="8" fill="currentColor" className="text-foreground" />
              <text x="350" y="180" fill="currentColor" className="text-foreground" fontSize="12" textAnchor="middle">RX</text>

              {/* Obstacles */}
              <rect x="150" y="80" width="40" height="80" fill="currentColor" className="text-muted-foreground" opacity="0.6" />
              <rect x="250" y="140" width="40" height="100" fill="currentColor" className="text-muted-foreground" opacity="0.6" />

              {/* Direct path */}
              <motion.line
                x1="50" y1="150" x2="350" y2="150"
                stroke="currentColor"
                className="text-foreground"
                strokeWidth="2"
                strokeDasharray="5,5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              />

              {/* Reflected paths */}
              <motion.path
                d="M 50 150 Q 200 50 350 150"
                stroke="currentColor"
                className="text-foreground opacity-70"
                strokeWidth="2"
                fill="none"
                strokeDasharray="5,5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: 0.3 }}
              />

              <motion.path
                d="M 50 150 Q 200 250 350 150"
                stroke="currentColor"
                className="text-foreground opacity-50"
                strokeWidth="2"
                fill="none"
                strokeDasharray="5,5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: 0.6 }}
              />
            </svg>
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Propagation Effects</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Reflection</h4>
            <p className="text-muted-foreground text-sm">
              Waves bounce off large surfaces like buildings, creating multiple signal paths.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Diffraction</h4>
            <p className="text-muted-foreground text-sm">
              Waves bend around obstacles, allowing signals to reach shadowed areas.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Scattering</h4>
            <p className="text-muted-foreground text-sm">
              Small objects cause waves to spread in multiple directions.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-2">Fading</h4>
            <p className="text-muted-foreground text-sm">
              Signal strength variations due to constructive and destructive interference.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
