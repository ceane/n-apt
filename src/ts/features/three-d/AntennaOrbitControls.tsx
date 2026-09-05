import React from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

const HALF_TURN = Math.PI / 2;

/**
 * Keeps the antenna preview moving through a bounded 180-degree viewing arc.
 * OrbitControls still owns pointer input; automatic motion pauses while the
 * user drags, then resumes from the dragged angle.
 */
export const AntennaOrbitControls: React.FC = () => {
  const controlsRef = React.useRef<OrbitControlsImpl>(null);
  const phaseRef = React.useRef(0.45);
  const draggingRef = React.useRef(false);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (!draggingRef.current) {
      phaseRef.current += delta * 0.6;
      controls.setAzimuthalAngle(Math.sin(phaseRef.current) * HALF_TURN);
    }

    controls.update();
  });

  const handleStart = React.useCallback(() => {
    draggingRef.current = true;
  }, []);

  const handleEnd = React.useCallback(() => {
    const angle = controlsRef.current?.getAzimuthalAngle() ?? 0;
    phaseRef.current = Math.asin(Math.max(-1, Math.min(1, angle / HALF_TURN)));
    draggingRef.current = false;
  }, []);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableZoom={false}
      enableDamping
      dampingFactor={0.08}
      autoRotate={false}
      minAzimuthAngle={-HALF_TURN}
      maxAzimuthAngle={HALF_TURN}
      minPolarAngle={Math.PI * 0.35}
      maxPolarAngle={Math.PI * 0.65}
      onStart={handleStart}
      onEnd={handleEnd}
    />
  );
};
