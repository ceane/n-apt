import React from "react";
import { Box, Cylinder, Text, Plane } from "@react-three/drei";
import * as THREE from "three";

export function BasebandUnit(props: any) {
  const chassisMaterial = new THREE.MeshStandardMaterial({
    color: "#222222",
    metalness: 0.6,
    roughness: 0.7,
  });

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: "#2a2a2a",
    metalness: 0.5,
    roughness: 0.8,
  });

  const silverMetal = new THREE.MeshStandardMaterial({
    color: "#aaaaaa",
    metalness: 0.8,
    roughness: 0.3,
  });

  const blackMaterial = new THREE.MeshStandardMaterial({
    color: "#0a0a0a",
    metalness: 0.2,
    roughness: 0.9,
  });

  // Body dimensions (Approx 2U/3U rack mount server proportions)
  const width = 12;
  const height = 2.8;
  const depth = 10;

  const renderRackEar = (x: number) => (
    <group position={[x, 0, depth / 2 - 0.2]}>
      <Box args={[0.6, height, 0.4]} material={chassisMaterial} />
      {/* Mounting holes */}
      <Cylinder
        args={[0.08, 0.08, 0.45, 16]}
        position={[0, height / 2 - 0.4, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={blackMaterial}
      />
      <Cylinder
        args={[0.08, 0.08, 0.45, 16]}
        position={[0, -height / 2 + 0.4, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={blackMaterial}
      />
    </group>
  );

  const renderSfpPort = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]}>
      {/* Outer metal cage */}
      <Box args={[0.4, 0.3, 0.05]} material={silverMetal} />
      {/* Inner black port */}
      <Box args={[0.3, 0.2, 0.06]} material={blackMaterial} />
    </group>
  );

  const renderRj45Port = (x: number, y: number) => (
    <group position={[x, y, depth / 2 + 0.01]}>
      {/* Outer metal cage */}
      <Box args={[0.35, 0.4, 0.05]} material={silverMetal} />
      {/* Inner black port */}
      <Box args={[0.25, 0.3, 0.06]} material={blackMaterial} />
      {/* Gold pins hint */}
      <Box
        args={[0.15, 0.05, 0.07]}
        position={[0, 0.1, 0]}
        material={new THREE.MeshStandardMaterial({ color: "#ffd700" })}
      />
    </group>
  );

  const renderBladeLever = (x: number, y: number, flipped = false) => (
    <group position={[x, y, depth / 2 + 0.1]}>
      <Box
        args={[0.8, 0.15, 0.05]}
        position={[flipped ? -0.3 : 0.3, 0, 0]}
        material={blackMaterial}
      />
      <Cylinder
        args={[0.1, 0.1, 0.1]}
        position={[0, 0, -0.05]}
        rotation={[Math.PI / 2, 0, 0]}
        material={silverMetal}
      />
    </group>
  );

  // Generate rows of SFP ports for the blades
  const sfpRows = [];
  for (let row = 0; row < 3; row++) {
    const yPos = 0.8 - row * 0.7;
    for (let col = 0; col < 12; col++) {
      sfpRows.push(renderSfpPort(-3.5 + col * 0.5, yPos));
    }
    // Add levers for each row
    sfpRows.push(renderBladeLever(-4.5, yPos, false));
    sfpRows.push(renderBladeLever(3.5, yPos, true));
  }

  return (
    <group {...props}>
      {/* Main Chassis */}
      <Box args={[width, height, depth]} material={chassisMaterial} />

      {/* Rack Ears */}
      {renderRackEar(-width / 2 - 0.3)}
      {renderRackEar(width / 2 + 0.3)}

      {/* Front Panel Base */}
      <Box
        args={[width - 0.2, height - 0.2, 0.05]}
        position={[0, 0, depth / 2]}
        material={panelMaterial}
      />

      {/* SFP Blades */}
      {sfpRows}

      {/* Bottom section ports */}
      <group position={[0, -1.0, 0]}>
        {/* RJ45 Ports */}
        {renderRj45Port(-1.5, 0)}
        {renderRj45Port(-1.0, 0)}

        {/* Small SFP-like ports */}
        {renderSfpPort(0, 0)}
        {renderSfpPort(0.5, 0)}
        {renderSfpPort(1.0, 0)}
        {renderSfpPort(1.5, 0)}

        {/* Sync/GNSS SMA connectors */}
        <group
          position={[2.8, 0, depth / 2 + 0.05]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <Cylinder
            args={[0.1, 0.1, 0.15, 16]}
            position={[-0.2, 0, 0]}
            material={silverMetal}
          />
          <Cylinder
            args={[0.1, 0.1, 0.15, 16]}
            position={[0.2, 0, 0]}
            material={silverMetal}
          />
          <Text
            position={[-0.2, 0.1, 0.15]}
            fontSize={0.1}
            color="white"
            rotation={[-Math.PI / 2, 0, 0]}
          >
            SYNC
          </Text>
          <Text
            position={[0.2, 0.1, 0.15]}
            fontSize={0.1}
            color="white"
            rotation={[-Math.PI / 2, 0, 0]}
          >
            GNSS
          </Text>
        </group>
      </group>

      {/* Left side power terminal */}
      <group position={[-5.2, 0, depth / 2 + 0.05]}>
        <Box args={[0.6, 1.2, 0.2]} material={blackMaterial} />
        {/* Power screws */}
        <Cylinder
          args={[0.08, 0.08, 0.22, 16]}
          position={[0, 0.3, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={silverMetal}
        />
        <Cylinder
          args={[0.08, 0.08, 0.22, 16]}
          position={[0, -0.3, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={silverMetal}
        />
      </group>

      {/* Side mesh pattern (right side visible in image) */}
      <Plane
        args={[depth * 0.9, height * 0.8]}
        position={[width / 2 + 0.01, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <meshStandardMaterial
          color="#1a1a1a"
          metalness={0.8}
          roughness={0.5}
          wireframe={true}
        />
      </Plane>
    </group>
  );
}
