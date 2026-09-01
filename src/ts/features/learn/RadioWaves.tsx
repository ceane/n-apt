// @ts-nocheck
import { RadioWavesCanvas } from "@n-apt/app-article/components/canvas/RadioWavesCanvas";

export function RadioWaves() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Radio Waves</h2>

      <div className="prose prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed">
          Radio waves are electromagnetic waves that travel at the speed of light. They are characterized
          by their frequency and wavelength, which determine their propagation characteristics and applications.
        </p>

        <div className="my-6">
          <RadioWavesCanvas hideTitle={true} />
        </div>

        <h3 className="text-xl font-semibold text-foreground mt-6">Key Properties</h3>
        <ul className="text-muted-foreground space-y-2">
          <li><strong className="text-foreground">Frequency:</strong> Number of oscillations per second (Hz)</li>
          <li><strong className="text-foreground">Wavelength:</strong> Distance between wave peaks (λ = c/f)</li>
          <li><strong className="text-foreground">Amplitude:</strong> Wave height, determines signal strength</li>
          <li><strong className="text-foreground">Phase:</strong> Position in the wave cycle</li>
        </ul>

        <div className="bg-accent border border-border rounded-lg p-4 mt-6">
          <p className="text-accent-foreground">
            <strong>Speed of Light:</strong> All electromagnetic waves travel at c ≈ 3 × 10⁸ m/s in vacuum
          </p>
        </div>
      </div>
    </div>
  );
}
