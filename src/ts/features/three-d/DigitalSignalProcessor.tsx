import React from "react";
import { Box, Cylinder, Text } from "@react-three/drei";
import * as THREE from "three";

export function DigitalSignalProcessor(props: any) {
  const chipBodyMaterial = new THREE.MeshStandardMaterial({
    color: "#222",
    roughness: 0.9,
    metalness: 0.1,
  });

  const pinMaterial = new THREE.MeshStandardMaterial({
    color: "#e0e0e0",
    roughness: 0.4,
    metalness: 0.6,
  });

  const dimpleMaterial = new THREE.MeshStandardMaterial({
    color: "#181818",
    roughness: 0.9,
    metalness: 0.1,
  });

  const bodyWidth = 4.4;
  const bodyHeight = 4.4;
  const bodyDepth = 0.2;

  // Generate pins
  const pins = [];
  const pinsPerSide = 36;
  const pinSpacing = 4.0 / pinsPerSide;

  for (let i = 0; i < pinsPerSide; i++) {
    const offset = -2.0 + pinSpacing / 2 + i * pinSpacing;

    // Top edge
    pins.push(
      <group key={`top-${i}`} position={[offset, bodyHeight / 2, 0]}>
        <Box
          args={[0.05, 0.2, 0.02]}
          position={[0, 0.1, 0]}
          material={pinMaterial}
        />
        <Box
          args={[0.05, 0.02, 0.1]}
          position={[0, 0.2, -0.04]}
          material={pinMaterial}
        />
      </group>,
    );
    // Bottom edge
    pins.push(
      <group key={`bot-${i}`} position={[offset, -bodyHeight / 2, 0]}>
        <Box
          args={[0.05, 0.2, 0.02]}
          position={[0, -0.1, 0]}
          material={pinMaterial}
        />
        <Box
          args={[0.05, 0.02, 0.1]}
          position={[0, -0.2, -0.04]}
          material={pinMaterial}
        />
      </group>,
    );
    // Left edge
    pins.push(
      <group key={`left-${i}`} position={[-bodyWidth / 2, offset, 0]}>
        <Box
          args={[0.2, 0.05, 0.02]}
          position={[-0.1, 0, 0]}
          material={pinMaterial}
        />
        <Box
          args={[0.02, 0.05, 0.1]}
          position={[-0.2, 0, -0.04]}
          material={pinMaterial}
        />
      </group>,
    );
    // Right edge
    pins.push(
      <group key={`right-${i}`} position={[bodyWidth / 2, offset, 0]}>
        <Box
          args={[0.2, 0.05, 0.02]}
          position={[0.1, 0, 0]}
          material={pinMaterial}
        />
        <Box
          args={[0.02, 0.05, 0.1]}
          position={[0.2, 0, -0.04]}
          material={pinMaterial}
        />
      </group>,
    );
  }

  return (
    <group {...props}>
      {/* Main Chip Body */}
      {/* We use a slightly smaller box and add corner boxes to approximate chamfers,
          or just a simple box for the LQFP package body */}
      <Box
        args={[bodyWidth, bodyHeight, bodyDepth]}
        material={chipBodyMaterial}
      />

      {/* Pins */}
      <group position={[0, 0, -bodyDepth / 2 + 0.05]}>{pins}</group>

      {/* Front Face Details */}
      <group position={[0, 0, bodyDepth / 2 + 0.005]}>
        {/* Dimples */}
        {/* Pin 1 indicator (Top Left) */}
        <Cylinder
          args={[0.18, 0.18, 0.02, 32]}
          position={[-1.7, 1.7, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={dimpleMaterial}
        />
        {/* Mold mark (Bottom Right) */}
        <Cylinder
          args={[0.18, 0.18, 0.02, 32]}
          position={[1.7, -1.7, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={dimpleMaterial}
        />

        {/* Text */}
        <Text
          position={[-0.9, 0.9, 0]}
          fontSize={0.65}
          color="#aaa"
          anchorX="center"
          anchorY="middle"
        >
          DSP
        </Text>
        <Text
          position={[-0.9, 0.2, 0]}
          fontSize={0.35}
          color="#aaa"
          anchorX="center"
          anchorY="middle"
        >
          TMS320
        </Text>
        <Text
          position={[0, -0.3, 0]}
          fontSize={0.35}
          color="#aaa"
          anchorX="center"
          anchorY="middle"
        >
          VC5509APGE
        </Text>
        <Text
          position={[0, -0.8, 0]}
          fontSize={0.35}
          color="#aaa"
          anchorX="center"
          anchorY="middle"
        >
          4A-46AFKTW
        </Text>

        {/* G4 and Underline */}
        <Text
          position={[1.0, -1.3, 0]}
          fontSize={0.35}
          color="#aaa"
          anchorX="center"
          anchorY="middle"
        >
          G4
        </Text>
        <Box
          args={[0.4, 0.03, 0.01]}
          position={[1.0, -1.55, 0]}
          material={new THREE.MeshBasicMaterial({ color: "#aaa" })}
        />
      </group>
    </group>
  );
}
