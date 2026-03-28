import React, { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { theme } from "../../../theme";

export const useWavePoints = (
  phase = 0,
  amplitude = 1,
  frequency = 1,
  offsetY = 0,
  samples = 220,
  stretch = Math.PI * 2,
) => {
  const { viewport } = useThree();

  const points = useMemo(() => {
    const xMin = -viewport.width * 0.56;
    const xMax = viewport.width * 0.56;
    const pts: THREE.Vector3[] = [];

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(xMin, xMax, t);
      const angle = t * stretch * frequency + phase;
      const y = Math.sin(angle) * amplitude + offsetY;
      pts.push(new THREE.Vector3(x, y, 0));
    }

    return pts;
  }, [phase, amplitude, frequency, offsetY, samples, stretch, viewport.width]);

  return points;
};

export const useTubeGeometry = (points: THREE.Vector3[], radius: number, segments = 420) =>
  useMemo(() => {
    if (!points.length || points.length < 4) return null;
    // Ensure minimum radius for WebGPU
    const actualRadius = Math.max(radius, 0.01);
    const curve = new THREE.CatmullRomCurve3(points);
    curve.curveType = "centripetal";
    curve.tension = 0.5;
    // Conservative segment calculation for WebGPU
    const actualSegments = Math.max(8, Math.min(segments, Math.floor(points.length / 2)));
    return new THREE.TubeGeometry(curve, actualSegments, actualRadius, 6, false);
  }, [points, radius, segments]);

export const WaveTube: React.FC<{
  points: THREE.Vector3[];
  color: string;
  thickness?: number;
  opacity?: number;
  z?: number;
  segments?: number;
}> = ({ points, color, thickness = 0.055, opacity = 1, z = 0, segments = 420 }) => {
  const geometry = useTubeGeometry(points, thickness, segments);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry || !points.length) return null;

  return (
    <mesh geometry={geometry} position={[0, 0, z]} frustumCulled={false}>
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
};

export const DottedWave: React.FC<{
  points: THREE.Vector3[];
  color: string;
  step?: number;
  size?: number;
  opacity?: number;
  z?: number;
}> = ({ points, color, step = 10, size = 0.055, opacity = 0.8, z = 0.12 }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);

  const dots = useMemo(() => {
    if (!points.length) return [];
    return points.filter((_, index) => index % step === 0);
  }, [points, step]);

  useEffect(() => {
    if (!meshRef.current || dots.length === 0) return;
    
    dots.forEach((point, i) => {
      transform.position.set(point.x, point.y, z);
      transform.updateMatrix();
      meshRef.current!.setMatrixAt(i, transform.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.count = dots.length;
  }, [dots, z, transform]);

  const actualSize = Math.max(size, 0.01);

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, 500]} frustumCulled={false}>
      <sphereGeometry args={[actualSize, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </instancedMesh>
  );
};

export const DashedWave: React.FC<{
  points: THREE.Vector3[];
  color: string;
  z?: number;
  opacity?: number;
  dashLength?: number;
  gapLength?: number;
  thickness?: number;
}> = ({ points, color, z = 0, opacity = 0.65, dashLength = 6, gapLength = 4, thickness = 0.025 }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    
    let count = 0;
    for (let i = 0; i < points.length - 1; i += (dashLength + gapLength)) {
      const end = Math.min(i + dashLength, points.length - 1);
      for (let j = i; j < end; j++) {
        const p1 = points[j];
        const p2 = points[j + 1];
        if (!p1 || !p2) continue;

        const dist = p1.distanceTo(p2);
        transform.position.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, z);
        
        // Orient the dash along the segment
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        transform.rotation.set(0, 0, angle);
        transform.scale.set(dist * 1.05, thickness, 1);
        
        transform.updateMatrix();
        meshRef.current.setMatrixAt(count++, transform.matrix);
      }
    }
    
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.count = count;
  }, [points, dashLength, gapLength, z, thickness, transform]);

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, 1200]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
};

export const useGridTexture = () =>
  useMemo(() => {
    if (typeof document === "undefined") return null;

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = theme.colors.gridBorder;
    ctx.lineWidth = 2;

    const spacing = 64;
    for (let x = 0; x <= canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, []);

export const GridBackdrop: React.FC = () => {
  const texture = useGridTexture();

  useEffect(() => () => texture?.dispose(), [texture]);

  return (
    <mesh position={[0, 0, -0.4]}>
      <planeGeometry args={[8.6, 4.8]} />
      <meshBasicMaterial
        color={theme.colors.gridBase}
        map={texture ?? undefined}
        transparent
        opacity={texture ? 0.9 : 1}
      />
    </mesh>
  );
};

export const useLinearPoints = (start: THREE.Vector3, end: THREE.Vector3, segments = 80) =>
  useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      pts.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(start.x, end.x, t),
          THREE.MathUtils.lerp(start.y, end.y, t),
          THREE.MathUtils.lerp(start.z, end.z, t),
        ),
      );
    }
    return pts;
  }, [start, end, segments]);

export const useSinePathBetweenPoints = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  amplitude = 0.12,
  cycles = 8,
  samples = 180,
) =>
  useMemo(() => {
    const delta = new THREE.Vector3().subVectors(end, start);
    const length = delta.length();
    if (length === 0) return [start.clone()];

    const direction = delta.clone().normalize();
    const normal = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
    const pts: THREE.Vector3[] = [];

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const base = start.clone().addScaledVector(direction, length * t);
      const offset = Math.sin(t * Math.PI * 2 * cycles) * amplitude;
      pts.push(base.addScaledVector(normal, offset));
    }

    return pts;
  }, [start, end, amplitude, cycles, samples]);
