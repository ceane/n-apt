import React from "react";
import { Box, Cylinder, Text, Ring } from "@react-three/drei";
import * as THREE from "three";

export function AnalogDigitalConverter(props: any) {
  const pcbMaterial = new THREE.MeshStandardMaterial({
    color: "#0d47a1", // Dark blue PCB
    roughness: 0.8,
    metalness: 0.2,
  });

  const goldMetal = new THREE.MeshStandardMaterial({
    color: "#d4af37",
    roughness: 0.3,
    metalness: 0.8,
  });

  const silverMetal = new THREE.MeshStandardMaterial({
    color: "#d0d0d0",
    roughness: 0.4,
    metalness: 0.7,
  });

  const blackPlastic = new THREE.MeshStandardMaterial({
    color: "#111",
    roughness: 0.8,
    metalness: 0.2,
  });

  const greenTerminal = new THREE.MeshStandardMaterial({
    color: "#4caf50",
    roughness: 0.8,
    metalness: 0.1,
  });

  const width = 8;
  const height = 7;
  const depth = 0.1;

  const renderMountingHole = (x: number, y: number, withStandoff = false) => (
    <group position={[x, y, 0]}>
      {withStandoff ? (
        <Cylinder
          args={[0.2, 0.2, depth + 0.4, 32]}
          rotation={[Math.PI / 2, 0, 0]}
          material={silverMetal}
        />
      ) : (
        <>
          <Ring
            args={[0.15, 0.25, 32]}
            position={[0, 0, depth / 2 + 0.001]}
            material={goldMetal}
          />
          <Cylinder
            args={[0.15, 0.15, depth + 0.01, 32]}
            rotation={[Math.PI / 2, 0, 0]}
            material={new THREE.MeshBasicMaterial({ color: "#000" })}
          />
        </>
      )}
    </group>
  );

  const renderTestPoint = (x: number, y: number, label: string) => (
    <group position={[x, y, depth / 2 + 0.005]}>
      <Cylinder
        args={[0.1, 0.1, 0.05, 16]}
        rotation={[Math.PI / 2, 0, 0]}
        material={goldMetal}
      />
      <Cylinder
        args={[0.07, 0.07, 0.06, 16]}
        rotation={[Math.PI / 2, 0, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#e0e0e0" })}
      />
      <Text
        position={[0, -0.3, 0]}
        fontSize={0.15}
        color="#e0e0e0"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );

  const renderTerminalBlock = (x: number, y: number, label: string) => (
    <group position={[x, y, depth / 2 + 0.25]}>
      {/* Block Body */}
      <Box args={[0.8, 0.6, 0.5]} material={greenTerminal} />
      {/* Screws */}
      <Cylinder
        args={[0.1, 0.1, 0.51, 16]}
        position={[-0.2, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={silverMetal}
      />
      <Cylinder
        args={[0.1, 0.1, 0.51, 16]}
        position={[0.2, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={silverMetal}
      />
      {/* Label under it */}
      <Text
        position={[0, -0.5, -0.24]}
        fontSize={0.15}
        color="#e0e0e0"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>

      {/* Jumper Header Above */}
      <group position={[0, 0.8, 0]}>
        {/* Header Base */}
        <Box
          args={[0.2, 0.4, 0.1]}
          position={[0, 0, -0.2]}
          material={blackPlastic}
        />
        {/* Gold Pins */}
        <Cylinder
          args={[0.02, 0.02, 0.2]}
          position={[-0.05, 0.1, -0.1]}
          rotation={[Math.PI / 2, 0, 0]}
          material={goldMetal}
        />
        <Cylinder
          args={[0.02, 0.02, 0.2]}
          position={[0.05, 0.1, -0.1]}
          rotation={[Math.PI / 2, 0, 0]}
          material={goldMetal}
        />
        <Cylinder
          args={[0.02, 0.02, 0.2]}
          position={[-0.05, -0.1, -0.1]}
          rotation={[Math.PI / 2, 0, 0]}
          material={goldMetal}
        />
        <Cylinder
          args={[0.02, 0.02, 0.2]}
          position={[0.05, -0.1, -0.1]}
          rotation={[Math.PI / 2, 0, 0]}
          material={goldMetal}
        />
        {/* Jumper Cap */}
        <Box
          args={[0.2, 0.15, 0.15]}
          position={[0, 0.1, 0.02]}
          material={blackPlastic}
        />
      </group>
    </group>
  );

  return (
    <group {...props}>
      {/* Main PCB */}
      <Box args={[width, height, depth]} material={pcbMaterial} />

      {/* Mounting Holes */}
      {renderMountingHole(-3.5, 3.2, false)}
      {renderMountingHole(-3.0, 1.5, false)}
      {renderMountingHole(-3.0, -1.0, false)}
      {renderMountingHole(3.5, 3.2, true)}
      {renderMountingHole(3.5, -2.5, true)}

      {/* White Sticker */}
      <group position={[2.5, -0.2, depth / 2 + 0.01]}>
        <Box
          args={[2.0, 0.8, 0.02]}
          material={new THREE.MeshStandardMaterial({ color: "#f0f0f0" })}
        />
        <Text
          position={[0, 0.15, 0.02]}
          fontSize={0.2}
          color="#111"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          ADC3310EVM-PDK
        </Text>
        <Text
          position={[0, -0.2, 0.02]}
          fontSize={0.18}
          color="#111"
          anchorX="center"
          anchorY="middle"
        >
          DC0037 A
        </Text>
      </group>

      {/* CE Mark */}
      <Text
        position={[-2.0, 0.2, depth / 2 + 0.01]}
        fontSize={0.8}
        color="#e0e0e0"
        anchorX="center"
        anchorY="middle"
      >
        CE
      </Text>

      {/* Center IC */}
      <group position={[0.5, -0.5, depth / 2 + 0.05]}>
        <Box args={[0.6, 0.6, 0.1]} material={blackPlastic} />
        <Text
          position={[0, 0, 0.06]}
          fontSize={0.1}
          color="#666"
          anchorX="center"
          anchorY="middle"
        >
          U1
        </Text>
      </group>

      {/* Test Points (Approximated positions from image) */}
      {renderTestPoint(-1.5, 3.0, "POWER")}
      {renderTestPoint(0, 3.0, "D1")}
      {renderTestPoint(0.5, 2.5, "D3")}
      {renderTestPoint(1.2, 2.3, "D4")}
      {renderTestPoint(2.0, 3.0, "D13")}
      {renderTestPoint(2.0, 2.5, "D12")}
      {renderTestPoint(-1.0, 2.5, "D5")}
      {renderTestPoint(-0.5, 2.2, "D6")}
      {renderTestPoint(-1.0, 1.2, "D7")}
      {renderTestPoint(-0.5, 0.8, "SDI")}
      {renderTestPoint(-0.5, 1.5, "D8")}
      {renderTestPoint(0.5, -0.2, "ADR1")}
      {renderTestPoint(-0.2, -0.2, "ADR0")}
      {renderTestPoint(-0.5, -1.0, "REF")}

      {/* Bottom Terminal Blocks */}
      <group position={[0, -2.5, 0]}>
        {[-3.0, -2.1, -1.2, -0.3, 0.6, 1.5, 2.4, 3.3].map((x, i) =>
          renderTerminalBlock(x, 0, `+ CH${i} -`),
        )}
      </group>

      {/* Top Left Header (J1) */}
      <group position={[-3.2, 3.0, depth / 2 + 0.1]}>
        <Box args={[0.4, 0.6, 0.2]} material={blackPlastic} />
        <Text
          position={[0.5, 0, 0]}
          fontSize={0.15}
          color="#e0e0e0"
          anchorX="left"
          anchorY="middle"
        >
          PWR{"\n"}OFF
        </Text>
      </group>

      {/* Top Right Header (J2) */}
      <group position={[3.0, 2.8, depth / 2 + 0.1]}>
        <Box
          args={[0.5, 0.4, 0.3]}
          material={new THREE.MeshStandardMaterial({ color: "#f0f0f0" })}
        />
        <Text
          position={[0, -0.4, 0]}
          fontSize={0.15}
          color="#e0e0e0"
          anchorX="center"
          anchorY="middle"
        >
          VCC GND{"\n"}J2
        </Text>
      </group>

      {/* SMT components near center IC */}
      {[
        [-0.1, -0.3],
        [-0.1, -0.5],
        [-0.1, -0.7],
        [0.1, -0.1],
        [0.3, -0.1],
      ].map((pos, i) => (
        <Box
          key={`smt-${i}`}
          args={[0.1, 0.05, 0.05]}
          position={[pos[0] + 0.5, pos[1] - 0.5, depth / 2 + 0.025]}
          material={new THREE.MeshStandardMaterial({ color: "#8a7a6a" })}
        />
      ))}
    </group>
  );
}
