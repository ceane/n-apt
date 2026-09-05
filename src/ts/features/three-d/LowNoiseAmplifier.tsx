import React from "react";
import { Box, Cylinder, Text } from "@react-three/drei";
import * as THREE from "three";

export function LowNoiseAmplifier(props: any) {
  const silverMaterial = new THREE.MeshStandardMaterial({
    color: "#d0d0d0",
    metalness: 0.8,
    roughness: 0.2,
  });

  const goldMaterial = new THREE.MeshStandardMaterial({
    color: "#ffd700",
    metalness: 0.9,
    roughness: 0.15,
  });

  const screwMaterial = new THREE.MeshStandardMaterial({
    color: "#a0a0a0",
    metalness: 0.9,
    roughness: 0.4,
  });

  // Body dimensions
  const width = 4;
  const height = 2.2;
  const depth = 1;

  const renderScrew = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]} rotation={[Math.PI / 2, 0, 0]}>
      <Cylinder args={[0.08, 0.08, 0.02, 16]} material={screwMaterial} />
      {/* Screw cross */}
      <Box
        args={[0.1, 0.03, 0.01]}
        position={[0, -0.01, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#333" })}
      />
      <Box
        args={[0.01, 0.03, 0.1]}
        position={[0, -0.01, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#333" })}
      />
    </group>
  );

  const renderSMAConnector = (xOffset: number, rotationY: number) => (
    <group position={[xOffset, 0, 0]} rotation={[0, 0, rotationY]}>
      {/* Base block */}
      <Box
        args={[0.2, 0.6, 0.6]}
        position={[0.1, 0, 0]}
        material={goldMaterial}
      />
      {/* Outer threaded cylinder */}
      <Cylinder
        args={[0.25, 0.25, 0.6, 32]}
        position={[0.4, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={goldMaterial}
      />
      {/* Inner dielectric (white) */}
      <Cylinder
        args={[0.18, 0.18, 0.61, 32]}
        position={[0.4, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      {/* Center pin (gold) */}
      <Cylinder
        args={[0.03, 0.03, 0.65, 16]}
        position={[0.4, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={goldMaterial}
      />
    </group>
  );

  return (
    <group {...props}>
      {/* Main Body */}
      <Box args={[width, height, depth]} material={silverMaterial} />

      {/* Front Label */}
      <group position={[0, 0, depth / 2 + 0.01]}>
        {/* Label background */}
        <Box
          args={[3.2, 1.8, 0.01]}
          material={new THREE.MeshStandardMaterial({ color: "white" })}
        />
        {/* Label Border */}
        <Box
          args={[3.1, 1.7, 0.015]}
          material={new THREE.MeshStandardMaterial({ color: "black" })}
        />
        <Box
          args={[3.05, 1.65, 0.02]}
          material={new THREE.MeshStandardMaterial({ color: "white" })}
        />

        {/* Text */}
        <Text
          position={[0, 0.2, 0.03]}
          fontSize={0.4}
          color="black"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          PE15A1012
        </Text>

        <Text
          position={[-1.3, 0, 0.03]}
          fontSize={0.15}
          color="black"
          anchorX="left"
          anchorY="middle"
        >
          RF IN
        </Text>

        <Text
          position={[1.3, -0.3, 0.03]}
          fontSize={0.15}
          color="black"
          anchorX="right"
          anchorY="middle"
        >
          RF OUT
        </Text>

        <Text
          position={[0.3, 0.6, 0.03]}
          fontSize={0.15}
          color="black"
          anchorX="left"
          anchorY="middle"
        >
          GND +12V
        </Text>
      </group>

      {/* Screws */}
      {renderScrew(-1.7, 0.8)}
      {renderScrew(1.7, 0.8)}
      {renderScrew(-1.7, -0.8)}
      {renderScrew(1.7, -0.8)}

      {/* Left SMA */}
      {renderSMAConnector(-width / 2, Math.PI)}

      {/* Right SMA */}
      {renderSMAConnector(width / 2, 0)}

      {/* Top Toggle Switch */}
      <group position={[0.5, height / 2, 0]}>
        {/* Base hex nut */}
        <Cylinder
          args={[0.15, 0.15, 0.1, 6]}
          position={[0, 0.05, 0]}
          material={silverMaterial}
        />
        {/* Switch bat */}
        <Cylinder
          args={[0.04, 0.08, 0.4, 16]}
          position={[0, 0.25, 0]}
          material={silverMaterial}
        />
        <Cylinder
          args={[0.06, 0.06, 0.1, 16]}
          position={[0, 0.45, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={silverMaterial}
        />
      </group>

      {/* Top Gold Pin */}
      <group position={[1.2, height / 2, 0]}>
        {/* Base */}
        <Cylinder
          args={[0.12, 0.12, 0.1, 16]}
          position={[0, 0.05, 0]}
          material={goldMaterial}
        />
        {/* Pin */}
        <Cylinder
          args={[0.04, 0.04, 0.3, 16]}
          position={[0, 0.2, 0]}
          material={goldMaterial}
        />
        <Cylinder
          args={[0.06, 0.06, 0.05, 16]}
          position={[0, 0.35, 0]}
          material={new THREE.MeshStandardMaterial({ color: "black" })}
        />
      </group>
    </group>
  );
}
