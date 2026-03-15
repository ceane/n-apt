import type { Story } from "@ladle/react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { HorizonFocusGlobe } from "../HorizonFocusGlobe";

export default {
  title: "ThreeD/Horizon Focus Globe",
  component: HorizonFocusGlobe,
};

export const Active: Story = () => (
  <div style={{ width: "800px", height: "600px" }}>
    <Canvas camera={{ position: [0, 5, 10], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <HorizonFocusGlobe active={true} />
      <OrbitControls makeDefault />
    </Canvas>
  </div>
);

export const Inactive: Story = () => (
  <div style={{ width: "800px", height: "600px" }}>
    <Canvas camera={{ position: [0, 5, 10], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <HorizonFocusGlobe active={false} />
      <OrbitControls makeDefault />
    </Canvas>
  </div>
);
