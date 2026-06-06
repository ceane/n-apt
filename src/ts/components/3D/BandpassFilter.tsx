import React from "react";
import { Box, Cylinder, Text } from "@react-three/drei";
import * as THREE from "three";

export function BandpassFilter(props: any) {
  const whiteMetal = new THREE.MeshStandardMaterial({
    color: "#e8e8e8",
    roughness: 0.4,
    metalness: 0.2,
  });

  const silverMetal = new THREE.MeshStandardMaterial({
    color: "#d0d0d0",
    roughness: 0.3,
    metalness: 0.8,
  });

  const labelMaterial = new THREE.MeshStandardMaterial({
    color: "#e0e4e6",
    roughness: 0.6,
    metalness: 0.1,
  });

  // Body dimensions
  const width = 4;
  const height = 1.6;
  const depth = 1.4;

  const renderScrew = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]} rotation={[Math.PI / 2, 0, 0]}>
      <Cylinder args={[0.08, 0.08, 0.03, 16]} material={silverMetal} />
      {/* Screw cross */}
      <Box
        args={[0.1, 0.04, 0.01]}
        position={[0, -0.015, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#555" })}
      />
      <Box
        args={[0.01, 0.04, 0.1]}
        position={[0, -0.015, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#555" })}
      />
    </group>
  );

  const renderLeftSMA = () => (
    <group position={[-width / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      {/* Base flange with screws attached to side */}
      <Box
        args={[0.8, 0.1, 0.8]}
        position={[0, 0.05, 0]}
        material={silverMetal}
      />
      <Cylinder
        args={[0.06, 0.06, 0.15, 16]}
        position={[0.3, 0.1, 0.3]}
        material={silverMetal}
      />
      <Cylinder
        args={[0.06, 0.06, 0.15, 16]}
        position={[-0.3, 0.1, -0.3]}
        material={silverMetal}
      />

      {/* Threaded cylinder (female SMA) */}
      <Cylinder
        args={[0.18, 0.18, 0.4, 32]}
        position={[0, 0.3, 0]}
        material={silverMetal}
      />
      {/* Inner dielectric */}
      <Cylinder
        args={[0.12, 0.12, 0.41, 32]}
        position={[0, 0.3, 0]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      {/* Center hole/pin */}
      <Cylinder
        args={[0.03, 0.03, 0.42, 16]}
        position={[0, 0.3, 0]}
        material={new THREE.MeshStandardMaterial({ color: "#222" })}
      />
    </group>
  );

  const renderRightSMA = () => (
    <group position={[width / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
      {/* Base flange with screws attached to side */}
      <Box
        args={[0.8, 0.1, 0.8]}
        position={[0, 0.05, 0]}
        material={silverMetal}
      />
      <Cylinder
        args={[0.06, 0.06, 0.15, 16]}
        position={[0.3, 0.1, 0.3]}
        material={silverMetal}
      />
      <Cylinder
        args={[0.06, 0.06, 0.15, 16]}
        position={[-0.3, 0.1, -0.3]}
        material={silverMetal}
      />

      {/* Hex nut part for Male SMA */}
      <Cylinder
        args={[0.22, 0.22, 0.2, 6]}
        position={[0, 0.2, 0]}
        material={silverMetal}
      />
      {/* Inner barrel */}
      <Cylinder
        args={[0.16, 0.16, 0.2, 32]}
        position={[0, 0.4, 0]}
        material={silverMetal}
      />
      {/* Inner dielectric */}
      <Cylinder
        args={[0.12, 0.12, 0.41, 32]}
        position={[0, 0.3, 0]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      {/* Center pin (gold) */}
      <Cylinder
        args={[0.02, 0.02, 0.45, 16]}
        position={[0, 0.3, 0]}
        material={new THREE.MeshStandardMaterial({ color: "#ffd700" })}
      />
    </group>
  );

  return (
    <group {...props}>
      {/* Main Body */}
      <Box args={[width, height, depth]} material={whiteMetal} />

      {/* Front Label */}
      <group position={[0, 0, depth / 2 + 0.005]}>
        {/* Label background with rounded-like look (using standard box here) */}
        <Box args={[3.2, 1.1, 0.01]} material={labelMaterial} />
        {/* Border line */}
        <Box
          args={[3.15, 1.05, 0.015]}
          material={new THREE.MeshStandardMaterial({ color: "#a0a0a0" })}
        />
        <Box args={[3.1, 1.0, 0.02]} material={labelMaterial} />

        {/* Text */}
        <Text
          position={[0, 0.2, 0.03]}
          fontSize={0.25}
          color="#222"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          PE8724
        </Text>
        <Text
          position={[0, -0.1, 0.03]}
          fontSize={0.22}
          color="#222"
          anchorX="center"
          anchorY="middle"
        >
          DC to 300 MHz
        </Text>
        <Text
          position={[0, -0.4, 0.03]}
          fontSize={0.22}
          color="#222"
          anchorX="center"
          anchorY="middle"
        >
          D.C. 1224
        </Text>
      </group>

      {/* Screws */}
      {renderScrew(-width / 2 + 0.2, height / 2 - 0.2)}
      {renderScrew(width / 2 - 0.2, height / 2 - 0.2)}
      {renderScrew(-width / 2 + 0.2, -height / 2 + 0.2)}
      {renderScrew(width / 2 - 0.2, -height / 2 + 0.2)}

      {/* Center top/bottom screws */}
      {renderScrew(0, height / 2 - 0.2)}
      {renderScrew(0, -height / 2 + 0.2)}

      {/* SMA Connectors */}
      {renderLeftSMA()}
      {renderRightSMA()}
    </group>
  );
}
