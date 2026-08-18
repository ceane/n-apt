import React from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import type { Group } from "three";

export type ProjectionPoint = {
  x: number;
  y: number;
};

export const ProjectionPointReporter: React.FC<{
  modelRef: React.RefObject<Group | null>;
  onPoint?: (point: ProjectionPoint) => void;
}> = ({ modelRef, onPoint }) => {
  const { camera, gl } = useThree();
  const localPoint = React.useMemo(() => new Vector3(-1.42, 0.04, 0.04), []);
  const projectedPoint = React.useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!onPoint || !modelRef.current) return;

    projectedPoint.copy(localPoint);
    modelRef.current.localToWorld(projectedPoint);
    projectedPoint.project(camera);

    const rect = gl.domElement.getBoundingClientRect();
    onPoint({
      x: rect.left + ((projectedPoint.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projectedPoint.y) / 2) * rect.height,
    });
  });

  return null;
};
