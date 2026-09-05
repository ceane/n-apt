import React from "react";
import { Box, Cylinder, Text } from "@react-three/drei";
import * as THREE from "three";

export function LocalOscillator(props: any) {
  const silverFaceplate = new THREE.MeshStandardMaterial({
    color: "#e0e0e0",
    roughness: 0.3,
    metalness: 0.8,
  });

  const goldMetal = new THREE.MeshStandardMaterial({
    color: "#d4af37",
    roughness: 0.3,
    metalness: 0.8,
  });

  const blackMaterial = new THREE.MeshStandardMaterial({
    color: "#111",
    roughness: 0.8,
    metalness: 0.2,
  });

  const pcbMaterial = new THREE.MeshStandardMaterial({
    color: "#0a4a2a",
    roughness: 0.9,
    metalness: 0.1,
  });

  const width = 10;
  const height = 2;
  const depth = 0.15;

  const renderScrew = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]} rotation={[Math.PI / 2, 0, 0]}>
      <Cylinder args={[0.12, 0.12, 0.05, 16]} material={silverFaceplate} />
      <Box
        args={[0.15, 0.06, 0.02]}
        position={[0, 0.01, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#555" })}
      />
      <Box
        args={[0.02, 0.06, 0.15]}
        position={[0, 0.01, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#555" })}
      />
    </group>
  );

  const renderSMA = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]} rotation={[Math.PI / 2, 0, 0]}>
      <Cylinder
        args={[0.22, 0.22, 0.1, 32]}
        position={[0, 0.05, 0]}
        material={goldMetal}
      />
      <Cylinder
        args={[0.18, 0.18, 0.2]}
        position={[0, 0.2, 0]}
        material={goldMetal}
      />
      <Cylinder
        args={[0.15, 0.15, 0.35, 32]}
        position={[0, 0.475, 0]}
        material={goldMetal}
      />
      <Cylinder
        args={[0.1, 0.1, 0.36, 32]}
        position={[0, 0.475, 0]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      <Cylinder
        args={[0.03, 0.03, 0.4, 16]}
        position={[0, 0.475, 0]}
        material={goldMetal}
      />
    </group>
  );

  const renderLine = (x: number, y: number, w: number, h: number) => (
    <Box
      args={[w, h, 0.02]}
      position={[x, y, depth / 2 + 0.01]}
      material={blackMaterial}
    />
  );

  const renderLED = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]} rotation={[Math.PI / 2, 0, 0]}>
      <Cylinder
        args={[0.06, 0.06, 0.02, 16]}
        material={
          new THREE.MeshStandardMaterial({ color: "#888", roughness: 0.5 })
        }
      />
    </group>
  );

  return (
    <group {...props}>
      {/* Front Faceplate */}
      <Box args={[width, height, depth]} material={silverFaceplate} />
      {/* Screws */}
      {renderScrew(-width / 2 + 0.3, height / 2 - 0.3)}
      {renderScrew(width / 2 - 0.3, height / 2 - 0.3)}
      {renderScrew(-width / 2 + 0.3, -height / 2 + 0.3)}
      {renderScrew(width / 2 - 0.3, -height / 2 + 0.3)}
      {/* High-density connector (Left) */}
      <group position={[-3.5, -0.1, depth / 2 + 0.01]}>
        <Box args={[1.6, 0.7, 0.1]} material={blackMaterial} />
        <Box
          args={[1.4, 0.5, 0.12]}
          position={[0, 0, 0]}
          material={new THREE.MeshStandardMaterial({ color: "#222" })}
        />
        {/* Inner gold slot */}
        <Box
          args={[1.0, 0.1, 0.15]}
          position={[0, 0, 0]}
          material={goldMetal}
        />
      </group>
      <Text
        position={[-3.5, 0.6, depth / 2 + 0.02]}
        fontSize={0.25}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        LO
      </Text>
      {/* LO OUT Section */}
      <Text
        position={[-0.8, 0.6, depth / 2 + 0.02]}
        fontSize={0.25}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        LO{"\n"}OUT
      </Text>
      {/* Line brackets for LO OUT */}
      {renderLine(-1.8, 0.8, 0.8, 0.02)} {/* Left horizontal */}
      {renderLine(-2.2, 0.65, 0.02, 0.3)} {/* Left vertical down */}
      {renderLine(0.2, 0.8, 0.8, 0.02)} {/* Right horizontal */}
      {renderLine(0.6, 0.65, 0.02, 0.3)} {/* Right vertical down */}
      {/* SMA 1 */}
      {renderSMA(-1.8, -0.1)}
      <Text
        position={[-2.2, 0.35, depth / 2 + 0.02]}
        fontSize={0.22}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        1
      </Text>
      <Text
        position={[-2.2, -0.7, depth / 2 + 0.02]}
        fontSize={0.22}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        LO 1
      </Text>
      {renderLED(-1.5, -0.7)}
      {/* SMA 2 */}
      {renderSMA(0.2, -0.1)}
      <Text
        position={[0.6, 0.35, depth / 2 + 0.02]}
        fontSize={0.22}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        2
      </Text>
      {/* REF Section */}
      <Text
        position={[2.4, 0.8, depth / 2 + 0.02]}
        fontSize={0.25}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        REF
      </Text>
      {/* Line brackets for REF */}
      {renderLine(1.45, 0.8, 0.5, 0.02)} {/* Left horizontal */}
      {renderLine(1.2, 0.65, 0.02, 0.3)} {/* Left vertical down */}
      {renderLine(3.4, 0.8, 1.2, 0.02)} {/* Right horizontal */}
      {renderLine(4.0, 0.65, 0.02, 0.3)} {/* Right vertical down */}
      {/* SMA IN */}
      {renderSMA(1.7, -0.1)}
      <Text
        position={[1.2, 0.35, depth / 2 + 0.02]}
        fontSize={0.22}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        IN
      </Text>
      <Text
        position={[1.0, -0.7, depth / 2 + 0.02]}
        fontSize={0.22}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        LOCK
      </Text>
      {renderLED(1.7, -0.7)}
      {/* SMA OUT */}
      {renderSMA(3.5, -0.1)}
      <Text
        position={[3.3, 0.35, depth / 2 + 0.02]}
        fontSize={0.22}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        OUT (100MHz)
      </Text>
      {/* Vertical Text FMC154 */}
      <Text
        position={[4.6, 0, depth / 2 + 0.02]}
        rotation={[0, 0, Math.PI / 2]}
        fontSize={0.25}
        color="#111"
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
      >
        FMC154
      </Text>
      {/* PCB and Backend Details */}
      <group position={[0, -0.1, -depth / 2 - 2.5]}>
        {/* Main PCB */}
        <Box
          args={[9.6, 0.1, 5]}
          position={[0, -0.85, 0]}
          material={pcbMaterial}
        />

        {/* RF Shielding Can */}
        <Box
          args={[5.0, 1.4, 4.6]}
          position={[1.5, -0.1, 0.1]}
          material={
            new THREE.MeshStandardMaterial({
              color: "#c0c0c0",
              roughness: 0.5,
              metalness: 0.8,
            })
          }
        />
        <Box
          args={[2.0, 1.0, 2.0]}
          position={[-2.0, -0.3, 1.0]}
          material={
            new THREE.MeshStandardMaterial({
              color: "#d0d0d0",
              roughness: 0.4,
              metalness: 0.7,
            })
          }
        />

        {/* Black Heatsink */}
        <Box
          args={[1.0, 1.0, 1.0]}
          position={[-3.5, -0.3, -1.0]}
          material={blackMaterial}
        />

        {/* Gold Standoffs */}
        <Cylinder
          args={[0.15, 0.15, 1.8]}
          position={[-4.5, -0.85, -2.2]}
          material={
            new THREE.MeshStandardMaterial({ color: "#d4af37", roughness: 0.4 })
          }
        />
        <Cylinder
          args={[0.15, 0.15, 1.8]}
          position={[4.5, -0.85, -2.2]}
          material={
            new THREE.MeshStandardMaterial({ color: "#d4af37", roughness: 0.4 })
          }
        />
      </group>
    </group>
  );
}
