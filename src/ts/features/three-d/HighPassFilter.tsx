import React from "react";
import { Cylinder } from "@react-three/drei";
import * as THREE from "three";

export function HighPassFilter(props: any) {
  const silverMetal = new THREE.MeshStandardMaterial({
    color: "#d0d0d0",
    roughness: 0.3,
    metalness: 0.8,
  });

  const goldMetal = new THREE.MeshStandardMaterial({
    color: "#d4af37",
    roughness: 0.3,
    metalness: 0.8,
  });

  // Since it's an inline barrel, we'll align it along the X axis
  // It has a gold hex nut on the left, a silver smooth barrel in the middle,
  // and a gold threaded connector on the right.

  return (
    <group {...props}>
      {/* Left Male SMA (Gold Hex Nut) */}
      <group position={[-0.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder
          args={[0.35, 0.35, 0.4, 6]}
          position={[0, 0, 0]}
          material={goldMetal}
        />
        {/* Inner gold barrel */}
        <Cylinder
          args={[0.2, 0.2, 0.3, 32]}
          position={[0, -0.2, 0]}
          material={goldMetal}
        />
        {/* White dielectric */}
        <Cylinder
          args={[0.15, 0.15, 0.31, 32]}
          position={[0, -0.2, 0]}
          material={new THREE.MeshStandardMaterial({ color: "white" })}
        />
        {/* Center pin */}
        <Cylinder
          args={[0.03, 0.03, 0.35, 16]}
          position={[0, -0.25, 0]}
          material={goldMetal}
        />
      </group>

      {/* Middle Silver Barrel */}
      <group position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder
          args={[0.4, 0.4, 1.2, 32]}
          position={[0, 0, 0]}
          material={silverMetal}
        />
      </group>

      {/* Right Female SMA (Gold Threaded) */}
      <group position={[0.8, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        {/* Threaded barrel */}
        <Cylinder
          args={[0.25, 0.25, 0.4, 32]}
          position={[0, 0, 0]}
          material={goldMetal}
        />
        {/* White dielectric */}
        <Cylinder
          args={[0.15, 0.15, 0.41, 32]}
          position={[0, 0, 0]}
          material={new THREE.MeshStandardMaterial({ color: "white" })}
        />
        {/* Center hole/receptacle */}
        <Cylinder
          args={[0.04, 0.04, 0.42, 16]}
          position={[0, 0, 0]}
          material={new THREE.MeshStandardMaterial({ color: "#222" })}
        />
      </group>
    </group>
  );
}
