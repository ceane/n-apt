import React from "react";
import { Box, Cylinder, Text, Ring } from "@react-three/drei";
import * as THREE from "three";

export function BasebandAmplifier(props: any) {
  const pcbMaterial = new THREE.MeshStandardMaterial({
    color: "#1b5e20",
    roughness: 0.9,
    metalness: 0.1,
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

  const width = 4.8;
  const height = 3.6;
  const depth = 0.1;

  const renderMountingHole = (x: number, y: number) => (
    <group position={[x, y, 0]}>
      {/* Gold Ring */}
      <Ring
        args={[0.1, 0.18, 32]}
        position={[0, 0, depth / 2 + 0.001]}
        material={silverMetal}
      />
      {/* Hole */}
      <Cylinder
        args={[0.1, 0.1, depth + 0.01, 32]}
        rotation={[Math.PI / 2, 0, 0]}
        material={new THREE.MeshBasicMaterial({ color: "#000" })}
      />
    </group>
  );

  const renderSMA = (x: number, y: number, rotationZ: number) => (
    <group position={[x, y, 0]} rotation={[0, 0, rotationZ]}>
      {/* Flange soldered to PCB */}
      <Box
        args={[0.3, 0.5, 0.15]}
        position={[0.15, 0, depth / 2 + 0.075]}
        material={goldMetal}
      />
      <Box
        args={[0.3, 0.5, 0.15]}
        position={[0.15, 0, -depth / 2 - 0.075]}
        material={goldMetal}
      />

      {/* Barrel */}
      <Cylinder
        args={[0.18, 0.18, 0.5, 32]}
        position={[0.4, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={goldMetal}
      />
      <Cylinder
        args={[0.12, 0.12, 0.51, 32]}
        position={[0.4, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={new THREE.MeshStandardMaterial({ color: "white" })}
      />
      <Cylinder
        args={[0.03, 0.03, 0.52, 16]}
        position={[0.4, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={goldMetal}
      />
    </group>
  );

  const renderIC = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.05]}>
      <Box args={[0.5, 0.7, 0.1]} material={blackPlastic} />
      {/* Pins */}
      {[0.2, 0.0, -0.2].map((py, i) => (
        <React.Fragment key={i}>
          <Box
            args={[0.1, 0.05, 0.05]}
            position={[-0.3, py, -0.02]}
            material={silverMetal}
          />
          <Box
            args={[0.1, 0.05, 0.05]}
            position={[0.3, py, -0.02]}
            material={silverMetal}
          />
        </React.Fragment>
      ))}
      <Text
        position={[0, 0, 0.06]}
        rotation={[0, 0, Math.PI / 2]}
        fontSize={0.12}
        color="#ccc"
        anchorX="center"
        anchorY="middle"
      >
        AD603AR
      </Text>
    </group>
  );

  return (
    <group {...props}>
      {/* PCB Base */}
      <Box args={[width, height, depth]} material={pcbMaterial} />

      {/* Mounting Holes */}
      {renderMountingHole(-width / 2 + 0.3, height / 2 - 0.3)}
      {renderMountingHole(width / 2 - 0.3, height / 2 - 0.3)}
      {renderMountingHole(-width / 2 + 0.3, -height / 2 + 0.3)}
      {renderMountingHole(width / 2 - 0.3, -height / 2 + 0.3)}

      {/* SMAs */}
      {renderSMA(-width / 2, 0, Math.PI)}
      {renderSMA(width / 2, 0, 0)}

      {/* Potentiometer */}
      <group position={[0, 1.0, depth / 2 + 0.2]}>
        <Box args={[0.8, 0.8, 0.4]} material={silverMetal} />
        <Cylinder
          args={[0.25, 0.25, 0.3, 32]}
          position={[0, 0, 0.3]}
          rotation={[Math.PI / 2, 0, 0]}
          material={blackPlastic}
        />
        <Box
          args={[0.05, 0.4, 0.31]}
          position={[0, 0, 0.3]}
          rotation={[Math.PI / 2, 0, Math.PI / 4]}
          material={new THREE.MeshStandardMaterial({ color: "#222" })}
        />
      </group>

      {/* ICs */}
      {renderIC(-0.8, -0.1)}
      {renderIC(0.8, -0.1)}

      {/* Terminal Block */}
      <group position={[0, -1.3, depth / 2 + 0.2]}>
        <Box args={[1.5, 0.6, 0.4]} material={greenTerminal} />
        {[-0.5, 0, 0.5].map((x, i) => (
          <Cylinder
            key={i}
            args={[0.15, 0.15, 0.41, 16]}
            position={[x, 0, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            material={silverMetal}
          />
        ))}
      </group>

      {/* Various SMT components */}
      {[
        [-1.6, 0.4],
        [-1.6, -0.4],
        [1.6, 0.4],
        [1.6, -0.4],
        [-0.4, 0.6],
        [0.4, 0.6],
        [-0.4, -0.6],
        [0.4, -0.6],
        [0, 0.3],
        [-1.2, 1.2],
        [-0.8, 1.2],
        [1.2, 0.2],
      ].map((pos, i) => (
        <Box
          key={`smt-${i}`}
          args={[0.15, 0.25, 0.05]}
          position={[pos[0], pos[1], depth / 2 + 0.025]}
          material={new THREE.MeshStandardMaterial({ color: "#8a7a6a" })}
        />
      ))}

      {/* Silkscreen Text */}
      <Text
        position={[-2.0, 0.8, depth / 2 + 0.01]}
        rotation={[0, 0, -Math.PI / 2]}
        fontSize={0.25}
        color="#ffd54f"
        anchorX="center"
        anchorY="middle"
      >
        AD603 VCA
      </Text>

      <group position={[0, -0.8, depth / 2 + 0.01]}>
        <Text
          position={[-1.8, 0, 0]}
          fontSize={0.2}
          color="#e0e0e0"
          anchorX="center"
          anchorY="middle"
        >
          IN
        </Text>
        <Box
          args={[3.0, 0.03, 0.01]}
          position={[0, 0, 0]}
          material={new THREE.MeshBasicMaterial({ color: "#e0e0e0" })}
        />
        <Text
          position={[1.5, 0, 0]}
          fontSize={0.2}
          color="#e0e0e0"
          anchorX="center"
          anchorY="middle"
        >
          {">"}
        </Text>
        <Text
          position={[2.0, 0, 0]}
          fontSize={0.2}
          color="#e0e0e0"
          anchorX="center"
          anchorY="middle"
        >
          OUT
        </Text>
      </group>
    </group>
  );
}
