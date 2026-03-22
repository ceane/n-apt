import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import styled from "styled-components";
import * as THREE from "three";
import { CanvasText } from "./CanvasText";

const BASE_URL = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const BODY_CHARACTER_SRC = `${BASE_URL}/md-preview/body-attenuation-character.png`;
const BACKGROUND_COLOR = "#e3e3e3";

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

const CHARACTER_SIZE = {
  width: 2.7,
  height: 5.1,
};

const FLIP_EFFECT_DURATION_MS = 720;

const peelVertexShader = `
  uniform float uProgress;
  uniform float uDirection;
  uniform float uLift;
  uniform float uCurlStrength;

  varying vec2 vUv;
  varying float vPeel;

  void main() {
    vUv = uv;

    float peelEdge = uDirection > 0.0 ? uv.x : 1.0 - uv.x;
    float edgeWindow = pow(clamp(peelEdge, 0.0, 1.0), 0.72);
    float verticalWindow = pow(sin(uv.y * 3.14159265), 0.8);
    float progressWindow = pow(sin(uProgress * 3.14159265), 0.82);
    float peel = edgeWindow * verticalWindow * progressWindow;
    float hingeBias = smoothstep(0.08, 0.88, peelEdge);

    vec3 transformedPosition = position;
    transformedPosition.z += peel * uLift + hingeBias * uCurlStrength * 0.22;
    transformedPosition.x += uDirection * peel * (0.24 + uCurlStrength * 0.32);
    transformedPosition.y += peel * peel * (0.14 + uCurlStrength * 0.22);

    vPeel = peel;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
  }
`;

const shimmerFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uProgress;
  uniform float uGleamStrength;

  varying vec2 vUv;
  varying float vPeel;

  vec3 rainbowGradient(float t) {
    vec3 pink = vec3(1.0, 0.33, 0.76);
    vec3 violet = vec3(0.72, 0.42, 1.0);
    vec3 cyan = vec3(0.25, 0.9, 1.0);
    vec3 lime = vec3(0.9, 1.0, 0.42);
    vec3 gold = vec3(1.0, 0.82, 0.34);

    if (t < 0.25) {
      return mix(pink, violet, smoothstep(0.0, 0.25, t));
    }

    if (t < 0.5) {
      return mix(violet, cyan, smoothstep(0.25, 0.5, t));
    }

    if (t < 0.75) {
      return mix(cyan, lime, smoothstep(0.5, 0.75, t));
    }

    return mix(lime, gold, smoothstep(0.75, 1.0, t));
  }

  void main() {
    vec4 sampleColor = texture2D(uTexture, vUv);
    if (sampleColor.a < 0.01) {
      discard;
    }

    float sweep = mix(-0.2, 1.2, smoothstep(0.0, 1.0, uProgress));
    float verticalBand = exp(-pow((vUv.y - sweep) * 7.0, 2.0));
    float verticalCore = exp(-pow((vUv.y - sweep) * 14.0, 2.0));
    float diagonalBand = exp(-pow((vUv.x + vUv.y * 0.85 - (uProgress * 1.55 - 0.2)) * 5.8, 2.0));
    float peelMask = smoothstep(0.03, 0.2, vPeel);
    float alphaMask = sampleColor.a * peelMask * uGleamStrength;
    float rainbowCoord = clamp(vUv.x * 0.55 + vUv.y * 1.15 + uProgress * 0.5, 0.0, 1.0);
    vec3 rainbow = rainbowGradient(rainbowCoord);
    float shimmerShape = verticalBand * 0.9 + verticalCore * 0.8 + diagonalBand * 0.75;
    vec3 color = rainbow * shimmerShape + vec3(1.0, 0.98, 0.94) * verticalCore * 0.9;
    float alpha = clamp(shimmerShape * alphaMask * 0.95, 0.0, 0.92);

    gl_FragColor = vec4(color, alpha);
  }
`;

const peelFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uProgress;
  uniform float uGleamStrength;

  varying vec2 vUv;
  varying float vPeel;

  vec3 rainbowGradient(float t) {
    vec3 pink = vec3(1.0, 0.33, 0.76);
    vec3 violet = vec3(0.72, 0.42, 1.0);
    vec3 cyan = vec3(0.25, 0.9, 1.0);
    vec3 lime = vec3(0.9, 1.0, 0.42);
    vec3 gold = vec3(1.0, 0.82, 0.34);

    if (t < 0.25) {
      return mix(pink, violet, smoothstep(0.0, 0.25, t));
    }

    if (t < 0.5) {
      return mix(violet, cyan, smoothstep(0.25, 0.5, t));
    }

    if (t < 0.75) {
      return mix(cyan, lime, smoothstep(0.5, 0.75, t));
    }

    return mix(lime, gold, smoothstep(0.75, 1.0, t));
  }

  void main() {
    vec4 sampleColor = texture2D(uTexture, vUv);
    if (sampleColor.a < 0.01) {
      discard;
    }

    float gleamHead = mix(-0.35, 1.35, smoothstep(0.05, 0.95, uProgress));
    float shimmerHead = mix(-0.2, 1.2, smoothstep(0.0, 1.0, uProgress));
    float gleamBand = exp(-pow((vUv.x - gleamHead) * 11.0, 2.0));
    float gleamTail = exp(-pow((vUv.x - (gleamHead - 0.08)) * 6.0, 2.0));
    float shimmerBand = exp(-pow((vUv.y - shimmerHead) * 8.5, 2.0));
    float shimmerCore = exp(-pow((vUv.y - shimmerHead) * 18.0, 2.0));
    float shimmerTrailingBand = exp(-pow((vUv.y - (shimmerHead - 0.16)) * 5.5, 2.0));
    float peelMask = smoothstep(0.02, 0.18, vPeel);
    float edgeLight = pow(clamp(vPeel, 0.0, 1.0), 1.15) * 0.2;
    vec3 gleam = vec3(1.0, 0.99, 0.92) * (gleamBand + gleamTail * 0.45) * peelMask * uGleamStrength;
    float rainbowCoord = clamp(vUv.x * 0.72 + vUv.y * 0.9 + uProgress * 0.45, 0.0, 1.0);
    vec3 rainbowMix = rainbowGradient(rainbowCoord);
    float shimmerMask = (shimmerBand * 0.95 + shimmerCore * 0.85 + shimmerTrailingBand * 0.55) * peelMask * uGleamStrength;
    vec3 shimmerOverlay = rainbowMix * shimmerMask;
    vec3 shimmerSpecular = vec3(1.0, 0.98, 0.94) * shimmerCore * peelMask * uGleamStrength * 0.8;
    vec3 composited = mix(sampleColor.rgb, sampleColor.rgb + shimmerOverlay, clamp(shimmerMask * 0.9, 0.0, 1.0));
    vec3 finalColor = composited + gleam + shimmerSpecular + vec3(edgeLight);

    gl_FragColor = vec4(finalColor, sampleColor.a);
  }
`;

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

const easeInOutCubic = (value: number) => {
  if (value < 0.5) {
    return 4 * value * value * value;
  }

  return 1 - Math.pow(-2 * value + 2, 3) / 2;
};

const easeOutQuad = (value: number) => 1 - (1 - value) * (1 - value);

type FlipEffectState = {
  active: boolean;
  fromSide: -1 | 1;
  toSide: -1 | 1;
  progress: number;
};

const PeelCharacter: React.FC<{
  facingSide: -1 | 1;
  flipEffect: FlipEffectState;
  texture: THREE.Texture;
}> = ({ facingSide, flipEffect, texture }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const shimmerMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const baseUniforms = useMemo(() => ({
    uTexture: { value: texture },
    uProgress: { value: 0 },
    uDirection: { value: facingSide },
    uLift: { value: 0 },
    uCurlStrength: { value: 0 },
    uGleamStrength: { value: 0 },
  }), [texture]);

  const shimmerUniforms = useMemo(() => ({
    uTexture: { value: texture },
    uProgress: { value: 0 },
    uDirection: { value: facingSide },
    uLift: { value: 0 },
    uCurlStrength: { value: 0 },
    uGleamStrength: { value: 0 },
  }), [texture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTexture.value = texture;
    }
    if (shimmerMaterialRef.current) {
      shimmerMaterialRef.current.uniforms.uTexture.value = texture;
    }
  }, [texture]);

  useFrame(() => {
    const activeProgress = flipEffect.active ? easeInOutCubic(flipEffect.progress) : 0;
    const lift = Math.sin(activeProgress * Math.PI);
    const curl = Math.sin(activeProgress * Math.PI) * 1.55;
    const gleamStrength = Math.sin(activeProgress * Math.PI) * 1.2;
    const direction = flipEffect.active ? flipEffect.fromSide : facingSide;

    // Update uniform state objects
    baseUniforms.uProgress.value = activeProgress;
    baseUniforms.uDirection.value = direction;
    baseUniforms.uLift.value = 1.8 * lift;
    baseUniforms.uCurlStrength.value = curl;
    baseUniforms.uGleamStrength.value = gleamStrength;

    shimmerUniforms.uProgress.value = activeProgress;
    shimmerUniforms.uDirection.value = direction;
    shimmerUniforms.uLift.value = 1.8 * lift;
    shimmerUniforms.uCurlStrength.value = curl;
    shimmerUniforms.uGleamStrength.value = gleamStrength;

    // Update material instances directly
    if (materialRef.current) {
      materialRef.current.uniforms.uProgress.value = activeProgress;
      materialRef.current.uniforms.uDirection.value = direction;
      materialRef.current.uniforms.uLift.value = 1.8 * lift;
      materialRef.current.uniforms.uCurlStrength.value = curl;
      materialRef.current.uniforms.uGleamStrength.value = gleamStrength;
    }

    if (shimmerMaterialRef.current) {
      shimmerMaterialRef.current.uniforms.uProgress.value = activeProgress;
      shimmerMaterialRef.current.uniforms.uDirection.value = direction;
      shimmerMaterialRef.current.uniforms.uLift.value = 1.8 * lift;
      shimmerMaterialRef.current.uniforms.uCurlStrength.value = curl;
      shimmerMaterialRef.current.uniforms.uGleamStrength.value = gleamStrength;
    }
  });

  const activeProgress = flipEffect.active ? easeInOutCubic(flipEffect.progress) : 0;
  const lift = Math.sin(activeProgress * Math.PI);
  const shadowOpacity = 0.08 + lift * 0.28;
  const shadowScale = 1 + lift * 0.55;
  const restingSide = flipEffect.active ? flipEffect.fromSide : facingSide;
  const yRotation = flipEffect.active ? easeInOutCubic(flipEffect.progress) * Math.PI : 0;
  const settleOffset = flipEffect.active ? easeOutQuad(Math.sin(activeProgress * Math.PI)) * 0.65 : 0;
  const characterScale = 1 + lift * 0.05;

  return (
    <group position={[0, -0.68, 0.15]}>
      <mesh position={[0, -2.59, -0.18]} rotation={[-Math.PI / 2, 0, 0]} scale={[shadowScale, 1 + lift * 0.18, 1]} frustumCulled={false}>
        <planeGeometry args={[CHARACTER_SIZE.width * 1.22, 2.05]} />
        <meshBasicMaterial color="#161922" transparent opacity={shadowOpacity} depthWrite={false} />
      </mesh>

      <group rotation={[0, yRotation, 0]} scale={[restingSide * characterScale, characterScale, 1]} position={[0, lift * 0.22, settleOffset]}>
        <mesh frustumCulled={false}>
          <planeGeometry args={[CHARACTER_SIZE.width, CHARACTER_SIZE.height, 48, 72]} />
          <shaderMaterial
            ref={materialRef}
            uniforms={baseUniforms}
            vertexShader={peelVertexShader}
            fragmentShader={peelFragmentShader}
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[0, 0, 0.05]} renderOrder={999} frustumCulled={false}>
          <planeGeometry args={[CHARACTER_SIZE.width, CHARACTER_SIZE.height, 48, 72]} />
          <shaderMaterial
            ref={shimmerMaterialRef}
            uniforms={shimmerUniforms}
            vertexShader={peelVertexShader}
            fragmentShader={shimmerFragmentShader}
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  );
};

const SceneContents: React.FC<{
  characterFacingSide: -1 | 1;
  flipEffect: FlipEffectState;
  metrics: LayoutMetrics;
  model: ReturnType<typeof computeModel>;
  previewMetrics: LayoutMetrics;
  onPointerDown: (point: THREE.Vector3) => void;
  onPointerMove: (point: THREE.Vector3) => void;
  onPointerUp: () => void;
}> = ({ characterFacingSide, flipEffect, metrics, model, previewMetrics, onPointerDown, onPointerMove, onPointerUp }) => {
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
    event.stopPropagation();
    onPointerMove(event.point);
  }, [onPointerMove]);

  const handleUp = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    onPointerUp();
  }, [onPointerUp]);

  return (
    <>
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[0, 0, 3]} intensity={1.25} color="#ffffff" />

      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[10, 6.5]} />
        <meshBasicMaterial color={BACKGROUND_COLOR} />
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

      <PeelCharacter facingSide={characterFacingSide} flipEffect={flipEffect} texture={texture} />

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

const BodyAttenuationWebGPUCanvas: React.FC = () => {
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<LayoutMetrics>(() => toMetrics(2.1, 1.1));
  const [previewMetrics, setPreviewMetrics] = useState<LayoutMetrics>(() => toMetrics(2.1, 1.1));
  const [characterFacingSide, setCharacterFacingSide] = useState<-1 | 1>(1);
  const [flipEffect, setFlipEffect] = useState<FlipEffectState>({
    active: false,
    fromSide: 1,
    toSide: 1,
    progress: 0,
  });
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
      if (nextMetrics.side !== characterFacingSide && !flipEffect.active) {
        setFlipEffect({
          active: true,
          fromSide: characterFacingSide,
          toSide: nextMetrics.side,
          progress: 0,
        });
      }
      setMetrics(nextMetrics);
    }
  }, [characterFacingSide, dragging, flipEffect.active, updateFromScenePoint]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    const release = () => setDragging(false);
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, []);

  useEffect(() => {
    if (!flipEffect.active) {
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();
    const targetSide = flipEffect.toSide;

    const tick = (now: number) => {
      const nextProgress = clamp((now - startedAt) / FLIP_EFFECT_DURATION_MS, 0, 1);

      if (nextProgress >= 1) {
        setCharacterFacingSide(targetSide);
        setFlipEffect({
          active: false,
          fromSide: targetSide,
          toSide: targetSide,
          progress: 0,
        });
        return;
      }

      setFlipEffect((current) => (
        current.active
          ? {
            ...current,
            progress: nextProgress,
          }
          : current
      ));

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [flipEffect.active, flipEffect.toSide]);

  return (
    <Frame>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
      >
        <SceneContents
          characterFacingSide={characterFacingSide}
          flipEffect={flipEffect}
          metrics={metrics}
          model={model}
          previewMetrics={previewMetrics}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </Canvas>
      <RendererBadge>WebGL</RendererBadge>
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
  background: ${BACKGROUND_COLOR};
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
    cursor: none;
    touch-action: none;
  }
`;

const RendererBadge = styled.div`
  display: none;
`;

export default BodyAttenuationWebGPUCanvas;
