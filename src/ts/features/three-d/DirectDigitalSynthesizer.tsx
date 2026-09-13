import React from "react";
import { Box, Cylinder, Text, Ring } from "@react-three/drei";
import * as THREE from "three";

export function DirectDigitalSynthesizer(props: any) {
  const chipMaterial = new THREE.MeshStandardMaterial({
    color: "#1a1a1a",
    roughness: 0.9,
    metalness: 0.1,
  });

  const goldMaterial = new THREE.MeshStandardMaterial({
    color: "#d4af37",
    roughness: 0.3,
    metalness: 0.8,
  });

  const width = 4;
  const height = 4;
  const depth = 0.3;

  // Generate edge pads
  const pads = [];
  const padCount = 11;
  const padSpacing = width / (padCount + 1);

  for (let i = 0; i < padCount; i++) {
    const offset = -width / 2 + padSpacing * (i + 1);
    // Top edge
    pads.push(
      <Box
        key={`top-${i}`}
        args={[0.15, 0.3, 0.1]}
        position={[offset, height / 2, 0]}
        material={goldMaterial}
      />,
    );
    // Bottom edge
    pads.push(
      <Box
        key={`bot-${i}`}
        args={[0.15, 0.3, 0.1]}
        position={[offset, -height / 2, 0]}
        material={goldMaterial}
      />,
    );
    // Left edge
    pads.push(
      <Box
        key={`left-${i}`}
        args={[0.3, 0.15, 0.1]}
        position={[-width / 2, offset, 0]}
        material={goldMaterial}
      />,
    );
    // Right edge
    pads.push(
      <Box
        key={`right-${i}`}
        args={[0.3, 0.15, 0.1]}
        position={[width / 2, offset, 0]}
        material={goldMaterial}
      />,
    );
  }

  return (
    <group {...props}>
      {/* Main Chip Body */}
      <Box args={[width, height, depth]} material={chipMaterial} />

      {/* Gold Edge Pads */}
      <group position={[0, 0, 0]}>{pads}</group>

      {/* Front Face Details */}
      <group position={[0, 0, depth / 2 + 0.01]}>
        {/* Logo */}
        <group position={[-1.2, 1.2, 0]}>
          <Ring args={[0.25, 0.3, 32]} material={goldMaterial} />
          {/* Sine wave approx inside logo */}
          <Text
            position={[0, 0, 0.01]}
            fontSize={0.4}
            color="#d4af37"
            anchorX="center"
            anchorY="middle"
          >
            ~
          </Text>
        </group>

        {/* Top Text Blocks */}
        <Text
          position={[0.4, 1.25, 0]}
          fontSize={0.5}
          color="#d4af37"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          DDS-30
        </Text>
        <Text
          position={[0.4, 0.8, 0]}
          fontSize={0.25}
          color="#d4af37"
          anchorX="center"
          anchorY="middle"
        >
          DIRECT DIGITAL{"\n"}SYNTHESIZER
        </Text>

        {/* LF / MF / HF Box */}
        <group position={[0, 0.15, 0]}>
          <Box
            args={[2.8, 0.6, 0.01]}
            position={[0, 0, -0.005]}
            material={goldMaterial}
          />
          <Box
            args={[2.7, 0.5, 0.015]}
            position={[0, 0, -0.005]}
            material={chipMaterial}
          />
          <Text
            position={[0, 0, 0.01]}
            fontSize={0.3}
            color="#d4af37"
            anchorX="center"
            anchorY="middle"
          >
            LF / MF / HF
          </Text>
        </group>

        {/* Specs Text */}
        <Text
          position={[0, -0.5, 0]}
          fontSize={0.25}
          color="#d4af37"
          anchorX="center"
          anchorY="middle"
        >
          0 Hz - 30 MHz
        </Text>
        <Text
          position={[0, -0.9, 0]}
          fontSize={0.25}
          color="#d4af37"
          anchorX="center"
          anchorY="middle"
        >
          32-BIT DDS CORE
        </Text>
        <Text
          position={[0, -1.3, 0]}
          fontSize={0.25}
          color="#d4af37"
          anchorX="center"
          anchorY="middle"
        >
          SPI INTERFACE
        </Text>

        {/* Bottom Corner Text & Dot */}
        <Cylinder
          args={[0.06, 0.06, 0.02, 16]}
          position={[-1.6, -1.6, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={goldMaterial}
        />
        <Text
          position={[-1.3, -1.6, 0]}
          fontSize={0.2}
          color="#d4af37"
          anchorX="left"
          anchorY="middle"
        >
          2501
        </Text>
        <Text
          position={[1.7, -1.6, 0]}
          fontSize={0.2}
          color="#d4af37"
          anchorX="right"
          anchorY="middle"
        >
          DDS30-LF
        </Text>
      </group>

      {/* Back Face Details */}
      <group position={[0, 0, -depth / 2 - 0.01]} rotation={[0, Math.PI, 0]}>
        {/* Large center thermal pad */}
        <Box args={[1.5, 1.5, 0.01]} material={goldMaterial} />

        {/* Crystal Oscillator */}
        <group position={[-1.2, -0.8, 0]}>
          <Box
            args={[0.6, 0.8, 0.1]}
            material={
              new THREE.MeshStandardMaterial({
                color: "#c0c0c0",
                roughness: 0.4,
                metalness: 0.7,
              })
            }
          />
          <Text
            position={[0, 0, 0.06]}
            fontSize={0.12}
            color="#444"
            anchorX="center"
            anchorY="middle"
          >
            25.000{"\n"}MHz
          </Text>
        </group>

        {/* Various SMT components (Capacitors) */}
        {[
          [-0.8, 1.2],
          [-0.5, 1.2],
          [-0.2, 1.2],
          [0.1, 1.2],
          [0.4, 1.2],
          [1.2, -0.8],
          [1.2, -0.5],
          [1.2, -0.2],
          [-1.2, 0.2],
          [-1.2, -0.2],
          [0.2, -1.2],
          [0.5, -1.2],
          [0.8, -1.2],
        ].map((pos, idx) => (
          <Box
            key={`smt-${idx}`}
            args={[0.15, 0.25, 0.05]}
            position={[pos[0], pos[1], 0.02]}
            material={
              new THREE.MeshStandardMaterial({
                color: "#8a7a6a",
                roughness: 0.7,
              })
            }
          />
        ))}

        {/* SMT Resistors */}
        {[
          [-0.8, 0.8],
          [-0.5, 0.8],
          [0.8, -0.8],
          [0.5, -0.8],
        ].map((pos, idx) => (
          <Box
            key={`res-${idx}`}
            args={[0.15, 0.2, 0.04]}
            position={[pos[0], pos[1], 0.02]}
            material={
              new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.8 })
            }
          />
        ))}
      </group>
    </group>
  );
}
