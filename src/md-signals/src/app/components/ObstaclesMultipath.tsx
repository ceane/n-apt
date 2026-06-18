// @ts-nocheck
import { motion } from "framer-motion";
import MultipathReflectionCanvas from "@n-apt/md-preview/components/canvas/MultipathReflectionCanvas";

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
          <MultipathReflectionCanvas />
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
