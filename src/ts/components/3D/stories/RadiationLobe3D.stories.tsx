import React from "react";
import { RadiationLobe3D } from "@n-apt/components/3D/RadiationLobe3D";
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
      <RadiationLobe3D
        frequency={1900}
        powerDbm={43}
        apertureWidth={0.65}
        apertureHeight={1.8}
        showMultipathRays
        showScatteringCloud
        multipathStrength={0.32}
      />
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
        showMultipathRays
        showScatteringCloud
        multipathStrength={0.24}
        height={10}
        n={10}
        m={28}
      />
      <OrbitControls />
    </Canvas>
  </div>
);

export const UrbanMultipath = () => (
  <div style={{ width: "100%", height: "600px", background: "#050505" }}>
    <Canvas camera={{ position: [20, 16, 24], fov: 45 }}>
      <color attach="background" args={["#050505"]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <RadiationLobe3D
        frequency={2600}
        powerDbm={46}
        apertureWidth={0.75}
        apertureHeight={2.1}
        showMultipathRays
        showScatteringCloud
        multipathStrength={0.5}
      />
      <OrbitControls />
    </Canvas>
  </div>
);
