import React from "react";
import { Box, Cylinder, Text } from "@react-three/drei";
import * as THREE from "three";

export function RFMixer(props: any) {
  const silverBlock = new THREE.MeshStandardMaterial({
    color: "#d8d8d8",
    roughness: 0.4,
    metalness: 0.7,
  });

  const goldMetal = new THREE.MeshStandardMaterial({
    color: "#d4af37",
    roughness: 0.3,
    metalness: 0.8,
  });

  const labelMaterial = new THREE.MeshStandardMaterial({
    color: "#f4f4f4",
    roughness: 0.8,
    metalness: 0.1,
  });

  const width = 2.4;
  const height = 1.0;
  const depth = 2.4;

  const renderTopScrew = (x: number, z: number) => (
    <group position={[x, height / 2 + 0.01, z]}>
      <Cylinder args={[0.1, 0.1, 0.05, 16]} material={silverBlock} />
      {/* Phillips cross */}
      <Box
        args={[0.12, 0.06, 0.02]}
        position={[0, 0.01, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#555" })}
      />
      <Box
        args={[0.02, 0.06, 0.12]}
        position={[0, 0.01, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#555" })}
      />
    </group>
  );

  const renderHexScrew = (
    x: number,
    y: number,
    z: number,
    rotation: [number, number, number],
  ) => (
    <group position={[x, y, z]} rotation={rotation}>
      {/* Socket head cap screw */}
      <Cylinder
        args={[0.12, 0.12, 0.15, 16]}
        position={[0, 0.075, 0]}
        material={
          new THREE.MeshStandardMaterial({
            color: "#888",
            roughness: 0.5,
            metalness: 0.6,
          })
        }
      />
      <Cylinder
        args={[0.06, 0.06, 0.16, 6]}
        position={[0, 0.075, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#333" })}
      />
    </group>
  );

  const renderFlangeSMA = (
    position: [number, number, number],
    rotation: [number, number, number],
    flangeSize: [number, number, number],
    screwPos1: [number, number, number],
    screwPos2: [number, number, number],
  ) => (
    <group position={position} rotation={rotation}>
      {/* Gold Flange */}
      <Box
        args={flangeSize}
        position={[0, flangeSize[1] / 2, 0]}
        material={goldMetal}
      />

      {/* Hex Screws on Flange */}
      {renderHexScrew(screwPos1[0], flangeSize[1], screwPos1[2], [0, 0, 0])}
      {renderHexScrew(screwPos2[0], flangeSize[1], screwPos2[2], [0, 0, 0])}

      {/* SMA Barrel (Female Threaded) */}
      <Cylinder
        args={[0.2, 0.2, 0.5, 32]}
        position={[0, flangeSize[1] + 0.25, 0]}
        material={goldMetal}
      />
      {/* White dielectric */}
      <Cylinder
        args={[0.14, 0.14, 0.51, 32]}
        position={[0, flangeSize[1] + 0.25, 0]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      {/* Center hole/pin */}
      <Cylinder
        args={[0.04, 0.04, 0.52, 16]}
        position={[0, flangeSize[1] + 0.25, 0]}
        material={new THREE.MeshStandardMaterial({ color: "#222" })}
      />
    </group>
  );

  return (
    <group {...props}>
      {/* Main Block */}
      <Box args={[width, height, depth]} material={silverBlock} />

      {/* Top Label */}
      <group
        position={[0, height / 2 + 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <Box args={[1.8, 1.8, 0.01]} material={labelMaterial} />

        {/* Letters R, L, I */}
        <Text
          position={[-0.7, 0.4, 0.01]}
          fontSize={0.25}
          color="#111"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          R
        </Text>
        <Text
          position={[0, -0.7, 0.01]}
          fontSize={0.25}
          color="#111"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          L
        </Text>
        <Text
          position={[0.7, 0.4, 0.01]}
          fontSize={0.25}
          color="#111"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          I
        </Text>
      </group>

      {/* Top Screws */}
      {renderTopScrew(-width / 2 + 0.2, -depth / 2 + 0.2)}
      {renderTopScrew(width / 2 - 0.2, -depth / 2 + 0.2)}
      {renderTopScrew(-width / 2 + 0.2, depth / 2 - 0.2)}
      {renderTopScrew(width / 2 - 0.2, depth / 2 - 0.2)}

      {/* Left Port (R) */}
      {renderFlangeSMA(
        [-width / 2, -height / 2 + 0.3, 0],
        [0, 0, Math.PI / 2],
        [0.8, 0.2, 0.8],
        [0.25, 0, 0],
        [-0.25, 0, 0],
      )}

      {/* Bottom Port (L) - facing front in 3D */}
      {renderFlangeSMA(
        [0, -height / 2 + 0.3, depth / 2],
        [Math.PI / 2, 0, 0],
        [0.8, 0.2, 0.8],
        [0.25, 0, 0],
        [-0.25, 0, 0],
      )}

      {/* Right Port (I) */}
      {renderFlangeSMA(
        [width / 2, -height / 2 + 0.3, 0],
        [0, 0, -Math.PI / 2],
        [0.8, 0.2, 0.8],
        [0.25, 0, 0],
        [-0.25, 0, 0],
      )}
    </group>
  );
}
