import type { Story } from "@ladle/react";
import { PolarRadioWaveWebGPU } from "../PolarRadioWaveWebGPU";

export default {
  title: "ThreeD/Polar Radio Wave WebGPU",
  component: PolarRadioWaveWebGPU,
};

export const Default: Story = () => (
  <div style={{ width: "800px", height: "600px" }}>
    <PolarRadioWaveWebGPU />
  </div>
);

export const CustomSettings: Story = () => (
  <div style={{ width: "800px", height: "600px" }}>
    <PolarRadioWaveWebGPU
      aperture={60}
      beamWidth={15}
      rotation={45}
      frequency={2.4}
    />
  </div>
);

export const WideBeam: Story = () => (
  <div style={{ width: "800px", height: "600px" }}>
    <PolarRadioWaveWebGPU
      aperture={80}
      beamWidth={60}
      rotation={0}
      frequency={1.0}
    />
  </div>
);
