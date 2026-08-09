import React, { useEffect, useMemo } from "react";
import * as THREE from "three";

export const useSegmentArrow = (from: THREE.Vector3, to: THREE.Vector3, length = 0.22, width = 0.12) =>
  useMemo(() => {
    const direction = new THREE.Vector3().subVectors(to, from).normalize();
    const normal = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
    const tip = to.clone();
    const base = to.clone().addScaledVector(direction, -length);
    const left = base.clone().addScaledVector(normal, width / 2);
    const right = base.clone().addScaledVector(normal, -width / 2);
    return [tip, left, right];
  }, [from, to, length, width]);

export const ArrowHead: React.FC<{
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  z?: number;
}> = ({ from, to, color, z = 0.18 }) => {
  const points = useSegmentArrow(from, to);
  const shape = useMemo(() => {
    const triangle = new THREE.Shape();
    triangle.moveTo(points[0].x, points[0].y);
    triangle.lineTo(points[1].x, points[1].y);
    triangle.lineTo(points[2].x, points[2].y);
    triangle.closePath();
    return triangle;
  }, [points]);
  
  const geometry = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} position={[0, 0, z]}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
};
