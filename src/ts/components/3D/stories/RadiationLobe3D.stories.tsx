import React from "react";
import { RadiationLobe3D } from "../RadiationLobe3D";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

export default {
  title: "ThreeD/Radiation Lobe 3D",
};

export const Default = () => (
  <div style={{ width: "100%", height: "600px", background: "#050505" }}>
    <Canvas camera={{ position: [20, 20, 20], fov: 45 }}>
      <color attach="background" args={["#050505"]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <RadiationLobe3D frequency={1900} powerDbm={43} apertureWidth={0.65} apertureHeight={1.8} />
      <OrbitControls />
    </Canvas>
  </div>
);

export const HighDirectivity = () => (
  <div style={{ width: "100%", height: "600px", background: "#050505" }}>
    <Canvas camera={{ position: [20, 20, 20], fov: 45 }}>
      <color attach="background" args={["#050505"]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <RadiationLobe3D
        frequency={3500}
        powerDbm={49}
        apertureWidth={1.25}
        apertureHeight={2.6}
        height={10}
        n={10}
        m={28}
      />
      <OrbitControls />
    </Canvas>
  </div>
);
