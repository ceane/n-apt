import React from "react";
import { Box, Cylinder, Text } from "@react-three/drei";
import * as THREE from "three";

export function FrequencySynthesizer(props: any) {
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

  // Body dimensions
  const baseWidth = 5.8;
  const baseHeight = 5.4;
  const baseDepth = 0.1;

  const bodyWidth = 5.0;
  const bodyHeight = 5.0;
  const bodyDepth = 0.8;

  const renderTopSMA = (x: number) => (
    <group position={[x, bodyHeight / 2, 0]}>
      {/* Base flange */}
      <Cylinder
        args={[0.22, 0.22, 0.05, 32]}
        position={[0, 0.025, 0]}
        material={goldMaterial}
      />
      {/* Smooth barrel */}
      <Cylinder
        args={[0.18, 0.18, 0.2, 32]}
        position={[0, 0.15, 0]}
        material={goldMaterial}
      />
      {/* Threaded barrel */}
      <Cylinder
        args={[0.15, 0.15, 0.35, 32]}
        position={[0, 0.425, 0]}
        material={goldMaterial}
      />
      {/* Inner dielectric (white) */}
      <Cylinder
        args={[0.1, 0.1, 0.36, 32]}
        position={[0, 0.425, 0]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      {/* Center pin (gold) */}
      <Cylinder
        args={[0.03, 0.03, 0.4, 16]}
        position={[0, 0.425, 0]}
        material={goldMaterial}
      />
    </group>
  );

  const renderBottomPort = (x: number, w: number, h: number, label: string) => (
    <group position={[x, -bodyHeight / 2, 0]}>
      {/* Port hole */}
      <Box
        args={[w, 0.1, h]}
        position={[0, 0.05, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#111" })}
      />
      <Text
        position={[0, 0.3, bodyDepth / 2 + 0.02]}
        fontSize={0.15}
        color="black"
        anchorX="center"
        anchorY="bottom"
        fontWeight="bold"
      >
        {label}
      </Text>
    </group>
  );

  return (
    <group {...props}>
      {/* Base Plate */}
      <Box
        args={[baseWidth, baseHeight, baseDepth]}
        position={[0, 0, -bodyDepth / 2]}
        material={silverMaterial}
      />

      {/* Main Body */}
      <Box
        args={[bodyWidth, bodyHeight, bodyDepth]}
        material={silverMaterial}
      />

      {/* Front Label */}
      <group position={[0, 0.1, bodyDepth / 2 + 0.01]}>
        {/* Label background */}
        <Box
          args={[4.6, 3.8, 0.01]}
          material={new THREE.MeshStandardMaterial({ color: "white" })}
        />
        {/* Label Border */}
        <Box
          args={[4.5, 3.7, 0.015]}
          material={new THREE.MeshStandardMaterial({ color: "#444" })}
        />
        <Box
          args={[4.45, 3.65, 0.02]}
          material={new THREE.MeshStandardMaterial({ color: "white" })}
        />

        {/* Top Text Blocks */}
        <Text
          position={[-1.5, 1.4, 0.03]}
          fontSize={0.16}
          color="black"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          Source 1
        </Text>
        <Text
          position={[-1.5, 1.2, 0.03]}
          fontSize={0.12}
          color="black"
          anchorX="center"
          anchorY="middle"
        >
          -15dBm ~ +15dBm
        </Text>

        <Text
          position={[0, 1.5, 0.03]}
          fontSize={0.16}
          color="black"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          Ext. Ref. / EFC
        </Text>
        <Text
          position={[0, 1.25, 0.03]}
          fontSize={0.12}
          color="black"
          anchorX="center"
          anchorY="middle"
        >
          -20dBm ~ 10dBm{"\n"}EFC 0.0 - 3.3Vdc
        </Text>

        <Text
          position={[1.5, 1.4, 0.03]}
          fontSize={0.16}
          color="black"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          Source 2
        </Text>
        <Text
          position={[1.5, 1.2, 0.03]}
          fontSize={0.12}
          color="black"
          anchorX="center"
          anchorY="middle"
        >
          -15dBm ~ +15dBm
        </Text>

        {/* Center Text */}
        <Text
          position={[0, -0.1, 0.03]}
          fontSize={0.22}
          color="black"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          Dual Frequency Synthesizer
        </Text>
        <Text
          position={[0, -0.4, 0.03]}
          fontSize={0.18}
          color="black"
          anchorX="center"
          anchorY="middle"
        >
          20MHz ~ 6400MHz
        </Text>

        {/* Pb Logo (fake) */}
        <group position={[-1.8, -1.4, 0.03]}>
          <Cylinder
            args={[0.15, 0.15, 0.01, 32]}
            rotation={[Math.PI / 2, 0, 0]}
            material={new THREE.MeshBasicMaterial({ color: "black" })}
          />
          <Cylinder
            args={[0.13, 0.13, 0.02, 32]}
            rotation={[Math.PI / 2, 0, 0]}
            material={new THREE.MeshBasicMaterial({ color: "white" })}
          />
          <Text
            position={[0, 0, 0.02]}
            fontSize={0.12}
            color="black"
            anchorX="center"
            anchorY="middle"
          >
            Pb
          </Text>
        </group>
      </group>

      {/* Top SMAs */}
      {renderTopSMA(-1.5)}
      {renderTopSMA(0)}
      {renderTopSMA(1.5)}

      {/* Bottom Ports */}
      {renderBottomPort(-1.5, 0.6, 0.4, "User Port")}
      {renderBottomPort(0, 0.5, 0.3, "USB (micro)")}
      {renderBottomPort(1.5, 0.6, 0.4, "+6Vdc 300mA")}
    </group>
  );
}
