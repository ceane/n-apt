import type { Story } from "@ladle/react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, OrbitControls } from "@react-three/drei";
import Brain from "@n-apt/components/3D/Brain";

export default {
  title: "ThreeD/Brain Model",
  component: Brain,
};

export const Default: Story = () => (
  <div style={{ width: "800px", height: "600px" }}>
    <Canvas camera={{ position: [0, 0, 2], fov: 35 }}>
      <ambientLight intensity={0.8} />
      <pointLight position={[2.5, 2.2, 2.5]} intensity={1.2} />
      <Bounds fit clip observe margin={1.35}>
        <Center>
          <Brain />
        </Center>
      </Bounds>
      <OrbitControls makeDefault />
    </Canvas>
  </div>
);
