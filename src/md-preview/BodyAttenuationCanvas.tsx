import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import styled, { css } from "styled-components";
import * as THREE from "three";

const BODY_CHARACTER_SRC = "/md-preview/body-attenuation-character.png";

const DEFAULTS = {
  transmitPowerDbm: 24,
  receivePowerDbm: -48,
  skinThicknessCm: 0.22,
  skullThicknessCm: 0.68,
  frequencyHz: 13.56e6,
  referenceFrequencyHz: 1e6,
  exponent: 0.5,
  skinLossRefDbPerCm: 1.1,
  skullLossRefDbPerCm: 2.35,
  mediumLossRefDbPerCm: 0.09,
  minDistanceCm: 2,
  maxDistanceCm: 36,
  sidePaddingPx: 28,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatDbm = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)} dBm`;

const formatDistance = (value: number) => `${value.toFixed(1)} cm`;

const formatFrequency = (value: number) => {
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)} MHz`;
  }

  if (value >= 1e3) {
    return `${(value / 1e3).toFixed(2)} kHz`;
  }

  return `${value.toFixed(0)} Hz`;
};

const computeModel = (distanceCm: number) => {
  const frequencyRatio = Math.pow(DEFAULTS.frequencyHz / DEFAULTS.referenceFrequencyHz, DEFAULTS.exponent);
  const lossSkin = DEFAULTS.skinThicknessCm * DEFAULTS.skinLossRefDbPerCm * frequencyRatio;
  const lossSkull = DEFAULTS.skullThicknessCm * DEFAULTS.skullLossRefDbPerCm * frequencyRatio;
  const lossEntry = lossSkin + lossSkull;
  const lossExit = lossSkin + lossSkull;
  const lossMedium = distanceCm * DEFAULTS.mediumLossRefDbPerCm * frequencyRatio;
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

const BodyScene: React.FC<{ cursorX: number; intensity: number }> = ({ cursorX, intensity }) => {
  const pulseRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const beamGlowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const beamSide = cursorX < 0 ? -1 : 1;

    if (pulseRef.current) {
      pulseRef.current.rotation.y = t * 0.45;
      pulseRef.current.position.x = cursorX;
      pulseRef.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.04);
    }

    if (beamRef.current) {
      const length = Math.max(0.48, Math.abs(cursorX) - 0.34);
      beamRef.current.scale.x = length;
      beamRef.current.position.x = cursorX / 2;
      beamRef.current.rotation.z = beamSide > 0 ? 0 : Math.PI;
    }

    if (beamGlowRef.current) {
      const glowLength = Math.max(0.54, Math.abs(cursorX) - 0.22);
      beamGlowRef.current.scale.x = glowLength;
      beamGlowRef.current.position.x = cursorX / 2;
      beamGlowRef.current.rotation.z = beamSide > 0 ? 0 : Math.PI;
    }
  });

  return (
    <>
      <color attach="background" args={["#060914"]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 3, 4]} intensity={2.4} color="#d8e4ff" />
      <pointLight position={[-3.5, 0.5, 3]} intensity={24 * intensity} color="#5d8dff" />
      <pointLight position={[3.5, 1.2, 3]} intensity={18} color="#89a6ff" />

      <group position={[0, 0, 0]}>
        <mesh>
          <capsuleGeometry args={[0.72, 2.45, 14, 28]} />
          <meshStandardMaterial color="#101b43" metalness={0.25} roughness={0.42} />
        </mesh>

        <mesh scale={[0.92, 0.94, 0.92]}>
          <capsuleGeometry args={[0.62, 2.22, 14, 28]} />
          <meshStandardMaterial color="#3f5ca8" emissive="#1f3170" emissiveIntensity={0.55} transparent opacity={0.68} />
        </mesh>

        <mesh scale={[0.72, 0.76, 0.72]}>
          <capsuleGeometry args={[0.46, 1.86, 14, 28]} />
          <meshStandardMaterial color="#91b4ff" emissive="#6d8dff" emissiveIntensity={0.82} transparent opacity={0.28} />
        </mesh>

        <mesh scale={[1.08, 1.08, 1.08]}>
          <capsuleGeometry args={[0.76, 2.56, 14, 28]} />
          <meshBasicMaterial color="#8ba8ff" transparent opacity={0.08} />
        </mesh>
      </group>

      <mesh ref={beamGlowRef} position={[0, 0, -0.46]}>
        <boxGeometry args={[1, 0.28, 0.28]} />
        <meshBasicMaterial color="#8eaaff" transparent opacity={0.16} />
      </mesh>

      <mesh ref={beamRef} position={[0, 0, -0.35]}>
        <boxGeometry args={[1, 0.11, 0.11]} />
        <meshBasicMaterial color="#d8e4ff" transparent opacity={0.92} />
      </mesh>

      <group ref={pulseRef} position={[cursorX, 0, 0.2]}>
        <mesh>
          <torusGeometry args={[0.42, 0.04, 16, 64]} />
          <meshBasicMaterial color="#cad8ff" transparent opacity={0.95} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.58, 0.03, 16, 64]} />
          <meshBasicMaterial color="#88a7ff" transparent opacity={0.45} />
        </mesh>
      </group>
    </>
  );
};

type BodyAttenuationElementProps = React.HTMLAttributes<HTMLElement>;

const BodyAttenuationCanvas: React.FC<BodyAttenuationElementProps> = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [supportsWebGpu, setSupportsWebGpu] = useState(false);
  const [pointerX, setPointerX] = useState<number | null>(null);
  const [cursorVisualX, setCursorVisualX] = useState<number | null>(null);
  const [hasCharacterAsset, setHasCharacterAsset] = useState(true);

  useEffect(() => {
    setSupportsWebGpu(typeof navigator !== "undefined" && "gpu" in navigator);
  }, []);

  const mapClientXToStage = useCallback((clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return null;
    }

    return clamp(clientX - bounds.left, DEFAULTS.sidePaddingPx, bounds.width - DEFAULTS.sidePaddingPx);
  }, []);

  const updatePointer = useCallback((clientX: number) => {
    const mapped = mapClientXToStage(clientX);
    if (mapped === null) {
      return;
    }

    setPointerX(mapped);
    setCursorVisualX(mapped);
  }, [mapClientXToStage]);

  const updateCursorVisual = useCallback((clientX: number) => {
    const mapped = mapClientXToStage(clientX);
    if (mapped === null) {
      return;
    }

    setCursorVisualX(mapped);
  }, [mapClientXToStage]);

  useEffect(() => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const initial = clamp(bounds.width * 0.78, DEFAULTS.sidePaddingPx, bounds.width - DEFAULTS.sidePaddingPx);
    setPointerX(initial);
    setCursorVisualX(initial);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) {
        return;
      }

      updatePointer(event.clientX);
    };

    const handlePointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [updatePointer]);

  useEffect(() => {
    const stage = containerRef.current;
    if (!stage) {
      return;
    }

    const handleStagePointerMove = (event: PointerEvent) => {
      updateCursorVisual(event.clientX);

      if (draggingRef.current) {
        updatePointer(event.clientX);
      }
    };

    const handleStagePointerEnter = (event: PointerEvent) => {
      updateCursorVisual(event.clientX);
    };

    const handleStagePointerLeave = () => {
      if (!draggingRef.current) {
        setCursorVisualX(null);
      }
    };

    stage.addEventListener("pointermove", handleStagePointerMove);
    stage.addEventListener("pointerenter", handleStagePointerEnter);
    stage.addEventListener("pointerleave", handleStagePointerLeave);

    return () => {
      stage.removeEventListener("pointermove", handleStagePointerMove);
      stage.removeEventListener("pointerenter", handleStagePointerEnter);
      stage.removeEventListener("pointerleave", handleStagePointerLeave);
    };
  }, [updateCursorVisual, updatePointer]);

  const stageMetrics = useMemo(() => {
    const bounds = containerRef.current?.getBoundingClientRect();
    const width = bounds?.width ?? 640;
    const usableWidth = Math.max(160, width - DEFAULTS.sidePaddingPx * 2);
    const resolvedPointerX = pointerX ?? width * 0.78;
    const normalized = clamp((resolvedPointerX - width / 2) / (usableWidth / 2), -1, 1);
    const txDistanceCm = DEFAULTS.minDistanceCm + ((resolvedPointerX - DEFAULTS.sidePaddingPx) / usableWidth) * (DEFAULTS.maxDistanceCm - DEFAULTS.minDistanceCm);
    const rxDistanceCm = DEFAULTS.minDistanceCm + ((width - DEFAULTS.sidePaddingPx - resolvedPointerX) / usableWidth) * (DEFAULTS.maxDistanceCm - DEFAULTS.minDistanceCm);

    return {
      width,
      usableWidth,
      resolvedPointerX,
      normalized,
      txDistanceCm: clamp(txDistanceCm, DEFAULTS.minDistanceCm, DEFAULTS.maxDistanceCm),
      rxDistanceCm: clamp(rxDistanceCm, DEFAULTS.minDistanceCm, DEFAULTS.maxDistanceCm),
    };
  }, [pointerX]);

  const totalDistanceCm = stageMetrics.txDistanceCm + stageMetrics.rxDistanceCm;
  const sceneCursorX = stageMetrics.normalized * 2.45;
  const markerSide: -1 | 1 = stageMetrics.normalized < 0 ? -1 : 1;

  const cursorVisualResolvedX = cursorVisualX ?? stageMetrics.resolvedPointerX;
  const cursorVisualNormalized = clamp(
    (cursorVisualResolvedX - stageMetrics.width / 2) / (stageMetrics.usableWidth / 2),
    -1,
    1,
  );
  const cursorVisualSide: -1 | 1 = cursorVisualNormalized < 0 ? -1 : 1;
  const cursorVisualTop = 24 + Math.abs(cursorVisualNormalized) * 8;
  const cursorVisible = cursorVisualX !== null;

  const model = useMemo(() => computeModel(totalDistanceCm), [totalDistanceCm]);
  const targetValue = useMemo(() => model.entry - model.lossMedium / 2, [model.entry, model.lossMedium]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    updatePointer(event.clientX);
  }, [updatePointer]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <Shell>
      <Topline>
        <StatusPill $active={supportsWebGpu}>{supportsWebGpu ? "WEBGPU" : "FALLBACK"}</StatusPill>
        <StatusLabel>BODY ATTENUATION / ENTRY EXIT MODEL</StatusLabel>
      </Topline>

      <CanvasStage
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <Canvas
          camera={{ position: [0, 0, 6.2], fov: 28 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <BodyScene cursorX={sceneCursorX} intensity={0.65 + Math.abs(stageMetrics.normalized) * 0.85} />
        </Canvas>

        <NoiseOverlay aria-hidden="true" />
        <MarkerTrack aria-hidden="true" />
        <PointerGlyph
          $visible={cursorVisible}
          $left={cursorVisualResolvedX}
          $top={cursorVisualTop}
          $side={cursorVisualSide}
        >
          ➤
        </PointerGlyph>
        <AxisGlow $side={markerSide} />

        <CenterTitles>
          <CenterTitleEntry>Entry</CenterTitleEntry>
          <CenterTitleTarget>Target</CenterTitleTarget>
          <CenterTitleExit>Exit</CenterTitleExit>
        </CenterTitles>

        <EndpointInfo $edge="left">
          <EndpointLabel>Endpoint A (Tx)</EndpointLabel>
          <EndpointMeta>{formatDbm(DEFAULTS.transmitPowerDbm)} / {formatDistance(stageMetrics.txDistanceCm)}</EndpointMeta>
        </EndpointInfo>

        <EndpointInfo $edge="right">
          <EndpointLabel>Endpoint B (Rx)</EndpointLabel>
          <EndpointMeta>{formatDbm(DEFAULTS.receivePowerDbm)} / {formatDistance(stageMetrics.rxDistanceCm)}</EndpointMeta>
        </EndpointInfo>

        <CharacterFrame>
          {hasCharacterAsset ? (
            <CharacterImage
              src={BODY_CHARACTER_SRC}
              alt="Body attenuation target"
              onError={() => setHasCharacterAsset(false)}
            />
          ) : (
            <CharacterFallback>
              <CenterBodyAura aria-hidden="true" />
            </CharacterFallback>
          )}
        </CharacterFrame>

        <ReadoutPanel $edge="left">
          <ReadoutValue>{formatDbm(model.entry)}</ReadoutValue>
          <ReadoutMeta>Entry boundary</ReadoutMeta>
          <DistanceRail $edge="left">
            <DistanceLabel>TX DIST</DistanceLabel>
            <DistanceValue>{formatDistance(stageMetrics.txDistanceCm)}</DistanceValue>
          </DistanceRail>
        </ReadoutPanel>

        <TargetReadout>
          <TargetLabel>Target</TargetLabel>
          <TargetValue>{formatDbm(targetValue)}</TargetValue>
        </TargetReadout>

        <ReadoutPanel $edge="right">
          <ReadoutValue>{formatDbm(model.exit)}</ReadoutValue>
          <ReadoutMeta>Exit boundary</ReadoutMeta>
          <DistanceRail $edge="right">
            <DistanceLabel>RX DIST</DistanceLabel>
            <DistanceValue>{formatDistance(stageMetrics.rxDistanceCm)}</DistanceValue>
          </DistanceRail>
        </ReadoutPanel>

        <CursorHint>drag inside the panel to move the target cursor</CursorHint>

        <BottomMetrics>
          <Metric>
            <MetricLabel>tx distance</MetricLabel>
            <MetricValue>{formatDistance(stageMetrics.txDistanceCm)}</MetricValue>
          </Metric>
          <Metric>
            <MetricLabel>rx distance</MetricLabel>
            <MetricValue>{formatDistance(stageMetrics.rxDistanceCm)}</MetricValue>
          </Metric>
          <Metric>
            <MetricLabel>frequency</MetricLabel>
            <MetricValue>{formatFrequency(DEFAULTS.frequencyHz)}</MetricValue>
          </Metric>
          <Metric>
            <MetricLabel>total path loss</MetricLabel>
            <MetricValue>{model.lossMedium.toFixed(2)} dB</MetricValue>
          </Metric>
        </BottomMetrics>

        <ReceiverValue>
          <ReceiverLabel>RX</ReceiverLabel>
          <ReceiverMetric>{formatDbm(model.receive)}</ReceiverMetric>
        </ReceiverValue>
      </CanvasStage>
    </Shell>
  );
};

const Shell = styled.section`
  margin: 2.4rem 0;
  padding: 1rem;
  border-radius: 24px;
  border: 1px solid rgba(171, 191, 255, 0.12);
  background:
    radial-gradient(circle at top, rgba(108, 133, 255, 0.14), transparent 45%),
    linear-gradient(180deg, rgba(8, 12, 34, 0.96), rgba(6, 9, 20, 0.98));
  box-shadow: 0 24px 80px rgba(2, 5, 18, 0.45);
`;

const Topline = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
  flex-wrap: wrap;
`;

const StatusPill = styled.span<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  color: #d8e4ff;
  border: 1px solid rgba(176, 195, 255, 0.18);
  background: rgba(90, 112, 214, 0.18);

  ${({ $active }) =>
    $active &&
    css`
      color: #f2f6ff;
      background: rgba(90, 124, 255, 0.28);
      box-shadow: 0 0 24px rgba(90, 124, 255, 0.22);
    `}
`;

const StatusLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  color: rgba(182, 198, 255, 0.9);
`;

const CanvasStage = styled.div`
  position: relative;
  min-height: 440px;
  border-radius: 26px;
  overflow: hidden;
  background:
    linear-gradient(180deg, #b7b8ca, #b7b8ca);
  border: 1px solid rgba(15, 18, 30, 0.25);
  cursor: none;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(255, 255, 255, 0.08), transparent 24%, transparent 76%, rgba(255, 255, 255, 0.08)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 20%, transparent 80%, rgba(255, 255, 255, 0.05));
    pointer-events: none;
    z-index: 1;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 440px !important;
    opacity: 0.2;
  }
`;

const NoiseOverlay = styled.div`
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(30, 32, 40, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 32, 40, 0.035) 1px, transparent 1px);
  background-size: 42px 42px;
  opacity: 0.22;
  pointer-events: none;
  z-index: 1;
`;

const MarkerTrack = styled.div`
  position: absolute;
  left: 8%;
  right: 8%;
  top: 12.5%;
  height: 1px;
  background: linear-gradient(90deg, rgba(24, 24, 28, 0), rgba(24, 24, 28, 0.16), rgba(24, 24, 28, 0));
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 2;
`;

const PointerGlyph = styled.div<{ $left: number; $top: number; $side: -1 | 1; $visible: boolean }>`
  position: absolute;
  left: ${({ $left }) => `${$left}px`};
  top: ${({ $top }) => `${$top}%`};
  transform: translate(-50%, -50%) ${({ $side }) => ($side > 0 ? "scaleX(1) rotate(-10deg)" : "scaleX(-1) rotate(-10deg)")};
  font-size: 4.75rem;
  line-height: 1;
  color: #9b8856;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.15);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition:
    opacity 120ms ease,
    transform 180ms ease;
  pointer-events: none;
  z-index: 4;
`;

const AxisGlow = styled.div<{ $side: -1 | 1 }>`
  position: absolute;
  top: 22%;
  bottom: 14%;
  width: 34%;
  ${({ $side }) => ($side > 0 ? "right: 12%;" : "left: 12%;")}
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.14), transparent 65%);
  pointer-events: none;
  z-index: 2;
`;

const CenterTitles = styled.div`
  position: absolute;
  left: 50%;
  top: 2.9rem;
  transform: translateX(-50%);
  display: grid;
  grid-template-columns: auto auto auto;
  gap: 2.2rem;
  align-items: baseline;
  z-index: 4;
  pointer-events: none;
`;

const CenterTitleEntry = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.92rem;
  font-weight: 700;
  color: #11131a;
`;

const CenterTitleTarget = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 1.8rem;
  font-weight: 800;
  color: #11131a;
`;

const CenterTitleExit = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.92rem;
  font-weight: 700;
  color: #11131a;
`;

const EndpointInfo = styled.div<{ $edge: "left" | "right" }>`
  position: absolute;
  top: 2.55rem;
  ${({ $edge }) => ($edge === "left" ? "left: 1.5rem; text-align: left;" : "right: 1.5rem; text-align: right; align-items: flex-end;")}
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  z-index: 4;
  pointer-events: none;
`;

const EndpointLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.82rem;
  font-weight: 700;
  color: #11131a;
`;

const EndpointMeta = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  font-weight: 700;
  color: rgba(17, 19, 26, 0.82);
`;

const CharacterFrame = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(34vw, 290px);
  height: min(85%, 400px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  pointer-events: none;
`;

const CharacterImage = styled.img`
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  opacity: 0.38;
  filter: grayscale(1) contrast(1.05) brightness(0.92);
`;

const CharacterFallback = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`;

const CenterBodyAura = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 160px;
  height: 320px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: radial-gradient(circle at center, rgba(118, 150, 255, 0.18), rgba(118, 150, 255, 0.05) 50%, transparent 72%);
  pointer-events: none;
  z-index: 2;
`;

const ReadoutPanel = styled.div<{ $edge: "left" | "right" }>`
  position: absolute;
  top: 56%;
  ${({ $edge }) => ($edge === "left" ? "left: 6rem; text-align: left;" : "right: 6rem; text-align: right; align-items: flex-end;")}
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: min(24%, 180px);
  pointer-events: none;
  z-index: 4;
`;

const ReadoutValue = styled.span`
  font-family: "Inter", system-ui, sans-serif;
  font-weight: 800;
  font-size: clamp(2.7rem, 5vw, 4.2rem);
  line-height: 0.95;
  color: #0f1016;
`;

const ReadoutMeta = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.76rem;
  color: rgba(17, 19, 26, 0.72);
`;

const TargetReadout = styled.div`
  position: absolute;
  left: 50%;
  top: 13.8%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  z-index: 4;
  pointer-events: none;
`;

const TargetLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  color: rgba(17, 19, 26, 0.72);
`;

const TargetValue = styled.span`
  font-family: "Inter", system-ui, sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  color: #11131a;
`;

const DistanceRail = styled.div<{ $edge: "left" | "right" }>`
  margin-top: 0.8rem;
  display: inline-flex;
  flex-direction: column;
  gap: 0.18rem;
  padding-top: 0.7rem;
  border-top: 1px solid rgba(171, 191, 255, 0.14);
  align-items: ${({ $edge }) => ($edge === "left" ? "flex-start" : "flex-end")};
`;

const DistanceLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  color: rgba(17, 19, 26, 0.64);
`;

const DistanceValue = styled.span`
  font-family: "Inter", system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 600;
  color: #11131a;
`;

const CursorHint = styled.div`
  position: absolute;
  left: 50%;
  top: 1rem;
  transform: translateX(-50%);
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: rgba(17, 19, 26, 0.62);
  background: rgba(255, 255, 255, 0.24);
  border: 1px solid rgba(17, 19, 26, 0.08);
  pointer-events: none;
  z-index: 4;
`;

const BottomMetrics = styled.div`
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  pointer-events: none;
  z-index: 4;

  @media (max-width: 720px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const Metric = styled.div`
  min-width: 0;
  padding: 0.8rem 0.95rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(17, 19, 26, 0.08);
  backdrop-filter: blur(8px);
`;

const MetricLabel = styled.div`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  color: rgba(17, 19, 26, 0.6);
  text-transform: uppercase;
`;

const MetricValue = styled.div`
  margin-top: 0.35rem;
  font-family: "Inter", system-ui, sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #11131a;
`;

const ReceiverValue = styled.div`
  position: absolute;
  left: 50%;
  bottom: 5.85rem;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  pointer-events: none;
  z-index: 4;
`;

const ReceiverLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  color: rgba(17, 19, 26, 0.62);
`;

const ReceiverMetric = styled.span`
  font-family: "Inter", system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 700;
  color: #11131a;
`;

export default BodyAttenuationCanvas;
