import React from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

export const CanvasHelperLabel: React.FC<{ label: string }> = ({ label }) => <span>{label}</span>;

export const createCanvasVector = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

export const CanvasHelperHost: React.FC<React.PropsWithChildren> = ({ children }) => <Canvas>{children}</Canvas>;

export const useCanvasFrame = (callback: Parameters<typeof useFrame>[0]) => {
  useFrame(callback);
};
