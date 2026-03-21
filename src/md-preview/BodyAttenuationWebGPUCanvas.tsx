import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import styled from "styled-components";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { CanvasText } from "./CanvasText";

const BASE_URL = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const BODY_CHARACTER_SRC = `${BASE_URL}/md-preview/body-attenuation-character.png`;

const DEFAULTS = {
  transmitPowerDbm: -8,
  receivePowerDbm: -52,
  skinThicknessCm: 0.22,
  skullThicknessCm: 0.68,
  frequencyHz: 13.56e6,
  referenceFrequencyHz: 1e6,
  exponent: 0.5,
  skinLossRefDbPerCm: 1.1,
  skullLossRefDbPerCm: 2.35,
  mediumLossRefDbPerCm: 0.09,
  minDistanceCm: 2,
  maxDistanceCm: 58,
};

const SCENE_BOUNDS = {
  left: -4.35,
  right: 4.35,
  top: 2.72,
  bottom: -2.7,
};

const BODY_BOUNDS = {
  centerX: 0,
  centerY: -0.38,
  radiusX: 1.08,
  radiusY: 2.22,
};

const DISTANCE_ANCHORS = {
  tx: new THREE.Vector2(-4.15, 0.1),
  rx: new THREE.Vector2(4.15, 0.1),
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const formatDbm = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(0)}dBm`;
const formatDistance = (value: number) => `${value.toFixed(0)}m away`;

const formatFrequency = (valueHz: number) => {
  if (valueHz >= 1e9) {
    return `${(valueHz / 1e9).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}GHz`;
  }

  if (valueHz >= 1e6) {
    return `${(valueHz / 1e6).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}MHz`;
  }

  if (valueHz >= 1e3) {
    return `${(valueHz / 1e3).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}kHz`;
  }

  return `${valueHz.toFixed(0)}Hz`;
};

const getFrequencyClass = (valueHz: number) => {
  if (valueHz < 3e5) {
    return "LF";
  }

  if (valueHz < 3e6) {
    return "MF";
  }

  if (valueHz < 3e7) {
    return "HF";
  }

  if (valueHz < 3e8) {
    return "VHF";
  }

  if (valueHz < 1e9) {
    return "Low end microwave (pre L band)";
  }

  if (valueHz < 2e9) {
    return "L-band Microwave (1-2GHz)";
  }

  if (valueHz < 4e9) {
    return "S-band Microwave (2-4GHz)";
  }

  if (valueHz < 12e9) {
    return "X-band (8-12GHz)";
  }

  return "Microwave";
};

const toDistanceCm = (point: THREE.Vector2, anchor: THREE.Vector2) => {
  const units = point.distanceTo(anchor);
  return clamp(units * 10.5, DEFAULTS.minDistanceCm, DEFAULTS.maxDistanceCm);
};

const getEllipseTopY = (x: number) => {
  const normalizedX = clamp((x - BODY_BOUNDS.centerX) / BODY_BOUNDS.radiusX, -1, 1);
  const normalizedY = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
  return BODY_BOUNDS.centerY + normalizedY * BODY_BOUNDS.radiusY;
};

const constrainMarker = (x: number, y: number) => {
  const clampedX = clamp(x, SCENE_BOUNDS.left, SCENE_BOUNDS.right);
  const floorY = SCENE_BOUNDS.bottom + 0.18;
  const withinBodyX = Math.abs(clampedX - BODY_BOUNDS.centerX) <= BODY_BOUNDS.radiusX;
  const topOfBody = getEllipseTopY(clampedX) + 0.12;
  const clampedY = clamp(
    withinBodyX ? Math.max(y, topOfBody) : y,
    floorY,
    SCENE_BOUNDS.top,
  );

  return new THREE.Vector2(clampedX, clampedY);
};

const computeModel = (txDistance: number, rxDistance: number) => {
  const frequencyRatio = Math.pow(DEFAULTS.frequencyHz / DEFAULTS.referenceFrequencyHz, DEFAULTS.exponent);
  const lossSkin = DEFAULTS.skinThicknessCm * DEFAULTS.skinLossRefDbPerCm * frequencyRatio;
  const lossSkull = DEFAULTS.skullThicknessCm * DEFAULTS.skullLossRefDbPerCm * frequencyRatio;
  const lossEntry = lossSkin + lossSkull;
  const lossExit = lossSkin + lossSkull;
  const lossMedium = (txDistance + rxDistance) * DEFAULTS.mediumLossRefDbPerCm * 0.1 * frequencyRatio;
  const entry = DEFAULTS.transmitPowerDbm - lossEntry;
  const exit = entry - lossMedium;
  const receive = exit - lossExit;

  return {
    entry,
    exit,
    receive,
    lossEntry,
    lossExit,
    lossMedium,
  };
};

type LayoutMetrics = {
  markerX: number;
  markerY: number;
  txDistance: number;
  rxDistance: number;
  side: -1 | 1;
};

const toMetrics = (x: number, y: number): LayoutMetrics => {
  const point = constrainMarker(x, y);

  return {
    markerX: point.x,
    markerY: point.y,
    txDistance: toDistanceCm(point, DISTANCE_ANCHORS.tx),
    rxDistance: toDistanceCm(point, DISTANCE_ANCHORS.rx),
    side: point.x < BODY_BOUNDS.centerX ? -1 : 1,
  };
};

const getArrowRotation = (metrics: LayoutMetrics) => {
  const silhouetteLeft = BODY_BOUNDS.centerX - BODY_BOUNDS.radiusX;
  const silhouetteRight = BODY_BOUNDS.centerX + BODY_BOUNDS.radiusX;
  const normalizedX = clamp((metrics.markerX - silhouetteLeft) / (silhouetteRight - silhouetteLeft), 0, 1);
  const degrees = (1 - normalizedX) * 180;
  return THREE.MathUtils.degToRad(degrees);
};

const SceneContents: React.FC<{
  dragging: boolean;
  metrics: LayoutMetrics;
  model: ReturnType<typeof computeModel>;
  previewMetrics: LayoutMetrics;
  onPointerDown: (point: THREE.Vector3) => void;
  onPointerMove: (point: THREE.Vector3) => void;
  onPointerUp: () => void;
}> = ({ dragging, metrics, model, previewMetrics, onPointerDown, onPointerMove, onPointerUp }) => {
  const texture = useTexture(BODY_CHARACTER_SRC);
  const { size, camera } = useThree();

  useEffect(() => {
    if (camera.type === "OrthographicCamera") {
      const ortho = camera as THREE.OrthographicCamera;
      ortho.zoom = size.width / 10;
      ortho.updateProjectionMatrix();
    }
  }, [size, camera]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);

  const handleDown = useCallback((event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    onPointerDown(event.point);
  }, [onPointerDown]);

  const handleMove = useCallback((event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    if (!dragging) {
      return;
    }

    event.stopPropagation();
    onPointerMove(event.point);
  }, [dragging, onPointerMove]);

  const handleUp = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    onPointerUp();
  }, [onPointerUp]);

  return (
    <>
      <color attach="background" args={["#a7aac0"]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[0, 0, 3]} intensity={1.25} color="#ffffff" />

      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[10, 6.5]} />
        <meshBasicMaterial color="#a7aac0" />
      </mesh>

      <mesh
        position={[0, 0, 0.2]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerMissed={handleUp}
      >
        <planeGeometry args={[9.8, 6.2]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>

      <CanvasText position={[-4.1, 2.55, 0.35]} fontSize={0.16} color="#111217" anchorX="left" anchorY="middle" fontWeight={600} text="Endpoint A (Tx)" />
      <CanvasText position={[-4.1, 2.35, 0.35]} fontSize={0.14} color="#111217" anchorX="left" anchorY="middle" fontWeight={500} text={`${formatDbm(DEFAULTS.transmitPowerDbm)} / ${formatDistance(metrics.txDistance)}`} />

      <CanvasText position={[-1.2, 2.45, 0.35]} fontSize={0.18} color="#101117" anchorX="right" anchorY="middle" fontWeight={600} text="Entry" />
      <CanvasText position={[0, 2.45, 0.35]} fontSize={0.32} color="#101117" anchorX="center" anchorY="middle" fontWeight={700} text="Target" />
      <CanvasText position={[1.2, 2.45, 0.35]} fontSize={0.18} color="#101117" anchorX="left" anchorY="middle" fontWeight={600} text="Exit" />

      <CanvasText position={[4.1, 2.55, 0.35]} fontSize={0.16} color="#111217" anchorX="right" anchorY="middle" fontWeight={600} text="Endpoint B (Rx)" />
      <CanvasText position={[4.1, 2.35, 0.35]} fontSize={0.14} color="#111217" anchorX="right" anchorY="middle" fontWeight={500} text={`${formatDbm(model.receive)} / ${formatDistance(metrics.rxDistance)}`} />

      <mesh position={[0, -0.55, 0.15]}>
        <planeGeometry args={[2.7, 5.1]} />
        <meshBasicMaterial map={texture} transparent opacity={0.8} toneMapped={false} />
      </mesh>

      <group position={[previewMetrics.markerX, previewMetrics.markerY, 1.2]} rotation={[0, 0, getArrowRotation(previewMetrics)]} renderOrder={1000}>
        <CanvasText position={[0, 0, 0]} fontSize={0.68} color="#958564" anchorX="center" anchorY="middle" fontWeight={700} text="➤" />
      </group>

      <CanvasText position={[-3.05, 0.2, 0.45]} fontSize={0.78} color="#101117" anchorX="center" anchorY="middle" fontWeight={900} letterSpacing={-0.02} text={formatDbm(model.entry)} />

      <CanvasText position={[3.05, -0.68, 0.45]} fontSize={0.78} color="#101117" anchorX="center" anchorY="middle" fontWeight={900} letterSpacing={-0.02} text={formatDbm(model.exit)} />

      <CanvasText position={[-4.1, -2.1, 0.45]} fontSize={0.46} color="#111217" anchorX="left" anchorY="middle" fontWeight={900} letterSpacing={-0.02} text={formatFrequency(DEFAULTS.frequencyHz)} />

      <CanvasText position={[-4.1, -2.55, 0.45]} fontSize={0.26} color="#111217" anchorX="left" anchorY="middle" fontWeight={500} letterSpacing={-0.01} text={`${getFrequencyClass(DEFAULTS.frequencyHz)} frequency`} />
    </>
  );
};

type RendererProps = Record<string, unknown>;

const createWebGpuRenderer = async (props: RendererProps) => {
  const renderer = new WebGPURenderer(props as never);
  await renderer.init();
  return renderer;
};

const BodyAttenuationWebGPUCanvas: React.FC = () => {
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<LayoutMetrics>(() => toMetrics(2.1, 1.1));
  const [previewMetrics, setPreviewMetrics] = useState<LayoutMetrics>(() => toMetrics(2.1, 1.1));
  const [webGpuReady, setWebGpuReady] = useState(true);

  const model = useMemo(() => computeModel(metrics.txDistance, metrics.rxDistance), [metrics.txDistance, metrics.rxDistance]);

  const updateFromScenePoint = useCallback((point: THREE.Vector3) => {
    return toMetrics(point.x, point.y);
  }, []);

  const handlePointerDown = useCallback((point: THREE.Vector3) => {
    const nextMetrics = updateFromScenePoint(point);
    setDragging(true);
    setPreviewMetrics(nextMetrics);
    setMetrics(nextMetrics);
  }, [updateFromScenePoint]);

  const handlePointerMove = useCallback((point: THREE.Vector3) => {
    const nextMetrics = updateFromScenePoint(point);
    setPreviewMetrics(nextMetrics);
    if (dragging) {
      setMetrics(nextMetrics);
    }
  }, [dragging, updateFromScenePoint]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    const release = () => setDragging(false);
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, []);

  return (
    <Frame>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10] }}
        gl={async (props) => {
          try {
            const renderer = await createWebGpuRenderer(props);
            setWebGpuReady(true);
            return renderer;
          } catch {
            setWebGpuReady(false);
            return new THREE.WebGLRenderer(props as unknown as THREE.WebGLRendererParameters);
          }
        }}
      >
        <SceneContents
          dragging={dragging}
          metrics={metrics}
          model={model}
          previewMetrics={previewMetrics}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </Canvas>
      <RendererBadge>{webGpuReady ? "WebGPU" : "WebGL fallback"}</RendererBadge>
    </Frame>
  );
};

const Frame = styled.div`
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 2rem 0;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(12, 14, 18, 0.36);
  background: #a7aac0;
  aspect-ratio: 10 / 6.4;
  position: relative;

  > div {
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
    cursor: grab;
    touch-action: none;
  }

  canvas:active {
    cursor: grabbing;
  }
`;

const RendererBadge = styled.div`
  display: none;
`;

export default BodyAttenuationWebGPUCanvas;
