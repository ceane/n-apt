import React from "react";

export const IBarMarker: React.FC<{
  position: [number, number, number];
  height?: number;
  width?: number;
  color?: string;
  z?: number;
}> = ({ position, height = 0.4, width = 0.2, color = "#9ca3af", z = 0.15 }) => {
  return (
    <group position={position}>
      {/* Vertical */}
      <mesh position={[0, 0, z]}>
        <planeGeometry args={[0.02, height]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Top */}
      <mesh position={[0, height / 2, z]}>
        <planeGeometry args={[width, 0.02]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -height / 2, z]}>
        <planeGeometry args={[width, 0.02]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
};

export const PointMarker: React.FC<{
  position: [number, number, number];
  color?: string;
  radius?: number;
  ring?: boolean;
}> = ({ position, color = "#3b82f6", radius = 0.16, ring = true }) => {
  return (
    <group position={position}>
      <mesh position={[0, 0, 0.24]}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {ring && (
        <>
          <mesh position={[0, 0, 0.22]}>
            <ringGeometry args={[radius * 1.6, radius * 2.1, 64]} />
            <meshBasicMaterial color="#9cc7ec" transparent opacity={0.9} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.21]}>
            <ringGeometry args={[radius * 2.6, radius * 3, 64]} />
            <meshBasicMaterial color="#dbe8f6" transparent opacity={0.95} toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  );
};
