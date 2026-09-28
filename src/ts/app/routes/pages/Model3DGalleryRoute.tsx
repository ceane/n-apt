import React, { Suspense, useState, useCallback, useEffect, useRef } from "react";
import styled, {
  useTheme,
  keyframes,
  createGlobalStyle,
} from "styled-components";
import { Leva } from "leva";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { ChevronLeft, ChevronRight, Menu, X, Box } from "lucide-react";
import { AppBackButton } from "@n-apt/ui/AppBackButton";
import { FrequencyInput } from "@n-apt/ui/FrequencyInput";
import { formatFrequency, formatLength, formatTime } from "@n-apt/math/unitsOfMeasure";
import Brain from "@n-apt/three-d/Brain";
import {
  LowNoiseAmplifier,
  FrequencySynthesizer,
  BasebandUnit,
  DirectDigitalSynthesizer,
  BandpassFilter,
  HighPassFilter,
  LocalOscillator,
  RFMixer,
  BasebandAmplifier,
  AnalogDigitalConverter,
  DigitalSignalProcessor,
  SectorTower,
  DiamondCell,
  PoleMountedSmallCell,
  HexagonalSmallCell,
  SinglePanelSmallCell,
  RadiationLobe3D,
  PolarRadioWaveWebGPU,
} from "@n-apt/three-d";
import { RoomTxScene } from "@n-apt/three-d/RoomTxScene";
import { VoltageControlledOscillator } from "@n-apt/three-d/VoltageControlledOscillator";
import { HUMAN_MODEL_AFRO_MALE_GLB_URL } from "@n-apt/three-d/modelAssetUrls";
import {
  MODEL_AMBIENT_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_POSITION,
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
  MODEL_FILL_LIGHT_INTENSITY,
  MODEL_FILL_LIGHT_POSITION,
  MODEL_FOV,
  MODEL_KEY_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_POSITION,
  MODEL_ROOT_POSITION,
} from "@n-apt/consts";

// ─── Model definitions ───────────────────────────────────────────────────────

type ModelKey =
  | "afro-male"
  | "neutral"
  | "brain"
  | "room_tx"
  | "free_space_radiation"
  | "polar_radiation"
  | "lna"
  | "synth"
  | "vco"
  | "bbu"
  | "dds"
  | "bpf"
  | "hpf"
  | "lo"
  | "mixer"
  | "bb_amp"
  | "adc"
  | "dsp"
  | "sector"
  | "diamond"
  | "pole_small"
  | "hexagonal"
  | "single_panel";

interface ModelDef {
  key: ModelKey;
  label: string;
  description: string;
  category: string;
}

const MODELS: ModelDef[] = [
  {
    key: "afro-male",
    label: "Human — Afro Male",
    description: "Full anatomical human model",
    category: "Biological",
  },
  {
    key: "neutral",
    label: "Human — Neutral",
    description: "Neutral anatomical reference",
    category: "Biological",
  },
  {
    key: "brain",
    label: "Brain",
    description: "Detailed cerebral structure",
    category: "Biological",
  },
  {
    key: "room_tx",
    label: "Room Tx Scene",
    description: "SDR Transmitter on a desk in a dark room",
    category: "Scenes",
  },
  {
    key: "free_space_radiation",
    label: "Free Space Radiation Lobe",
    description: "Interactive 3D radiation lobe visualization",
    category: "Scenes",
  },
  {
    key: "polar_radiation",
    label: "Polar Radiation Coordinates",
    description: "Interactive polar radiation chart",
    category: "Charts",
  },
  {
    key: "lna",
    label: "Low Noise Amplifier",
    description: "RF Frontend Component (PE15A1012)",
    category: "Components",
  },
  {
    key: "synth",
    label: "Frequency Synthesizer",
    description: "Dual Frequency Source (20MHz - 6400MHz)",
    category: "Components",
  },
  {
    key: "vco",
    label: "Voltage Controlled Oscillator",
    description: "Quartz-referenced VCO with tunable sine output",
    category: "Components",
  },
  {
    key: "bbu",
    label: "Baseband Unit",
    description: "Telecom Rack Equipment (BBU)",
    category: "Components",
  },
  {
    key: "dds",
    label: "Direct Digital Synthesizer",
    description: "DDS-30 32-Bit DDS Core Chip",
    category: "Components",
  },
  {
    key: "bpf",
    label: "Low Pass Filter",
    description: "Inline Filter DC to 300 MHz (PE8724)",
    category: "Components",
  },
  {
    key: "hpf",
    label: "High Pass Filter",
    description: "Inline Coaxial Filter",
    category: "Components",
  },
  {
    key: "lo",
    label: "Local Oscillator",
    description: "FMC154 RF Local Oscillator",
    category: "Components",
  },
  {
    key: "mixer",
    label: "RF Mixer",
    description: "High Frequency Signal Mixer",
    category: "Components",
  },
  {
    key: "bb_amp",
    label: "Baseband Amplifier",
    description: "AD603 Voltage Controlled Amplifier",
    category: "Components",
  },
  {
    key: "adc",
    label: "Analog Digital Converter",
    description: "ADC3310 Evaluation Module",
    category: "Components",
  },
  {
    key: "dsp",
    label: "Digital Signal Processor",
    description: "TMS320 VC5509APGE Chip",
    category: "Components",
  },
  {
    key: "sector",
    label: "Sector Tower",
    description: "Traditional Multi-Sector Cell Site",
    category: "Telecommunications Infrastructure / Cell Sites",
  },
  {
    key: "diamond",
    label: "Diamond Cell",
    description: "Diamond Configured Tower",
    category: "Telecommunications Infrastructure / Cell Sites",
  },
  {
    key: "pole_small",
    label: "Pole-mounted Cell",
    description: "Small Cell on Utility Pole",
    category: "Telecommunications Infrastructure / Cell Sites",
  },
  {
    key: "hexagonal",
    label: "Hexagonal Cell",
    description: "High-capacity Hexagonal Array",
    category: "Telecommunications Infrastructure / Cell Sites",
  },
  {
    key: "single_panel",
    label: "Single Panel",
    description: "Directional Small Cell Panel",
    category: "Telecommunications Infrastructure / Cell Sites",
  },
];

const CATEGORY_ORDER = [
  "Telecommunications Infrastructure / Cell Sites",
  "Components",
  "Scenes",
  "Charts",
  "Biological",
] as const;

const FIRST_MODEL_INDEX = MODELS.findIndex(
  (model) => model.category === CATEGORY_ORDER[0],
);

// ─── GLB-backed scene components ─────────────────────────────────────────────

const NEUTRAL_GLB_URL = new URL(
  "../../../../../public/glb_models/human_model_neutral.glb",
  import.meta.url,
).href;

function RendererSizeSync() {
  const { gl, camera } = useThree();

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;

    const syncSize = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (!width || !height) return;
      gl.setSize(width, height, false);
      if ("aspect" in camera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(parent);
    window.addEventListener("resize", syncSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, [gl, camera]);

  return null;
}

function HumanAfroMaleScene() {
  const { scene } = useGLTF(HUMAN_MODEL_AFRO_MALE_GLB_URL);
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <primitive object={scene} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function HumanNeutralScene() {
  const { scene } = useGLTF(NEUTRAL_GLB_URL);
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <primitive object={scene} position={[0, -1.5, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function BrainScene() {
  return (
    <>
      <Brain
        position={[0.1, -0.6, 0]}
        rotation={[0, 0, 0]}
        scale={[0.34, 0.34, 0.34]}
      />
      <OrbitControls
        makeDefault
        enableDamping={false}
        enablePan={false}
        enableZoom
        minPolarAngle={Math.PI / 2}
        maxPolarAngle={Math.PI / 2}
        minAzimuthAngle={-Math.PI / 7}
        maxAzimuthAngle={Math.PI / 7}
        minDistance={1.1}
        maxDistance={1.65}
        target={[0, 0, 0]}
      />
    </>
  );
}

function LNAScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <LowNoiseAmplifier
          scale={0.35}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function SynthScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <FrequencySynthesizer
          scale={0.35}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function VCOScene({ frequencyHz }: { frequencyHz: number }) {
  return <>
    <VoltageControlledOscillator frequencyHz={frequencyHz} />
    <OrbitControls makeDefault enableDamping target={[0, 0.18, 0]} />
  </>;
}

function BbuScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <BasebandUnit scale={0.2} position={[0, 0, 0]} rotation={[0, 0, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function DDSScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <DirectDigitalSynthesizer
          scale={0.4}
          position={[0, 0, 0]}
          rotation={[-Math.PI / 4, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function BandpassFilterScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <BandpassFilter
          scale={0.45}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function HighPassFilterScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <HighPassFilter scale={0.8} position={[0, 0, 0]} rotation={[0, 0, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function LocalOscillatorScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <LocalOscillator
          scale={0.25}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function RFMixerScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <RFMixer
          scale={0.6}
          position={[0, 0, 0]}
          rotation={[Math.PI / 8, Math.PI / 4, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function BasebandAmplifierScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <BasebandAmplifier
          scale={0.4}
          position={[0, 0, 0]}
          rotation={[-Math.PI / 4, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function AnalogDigitalConverterScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <AnalogDigitalConverter
          scale={0.22}
          position={[0, 0, 0]}
          rotation={[-Math.PI / 4, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function DSPScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <DigitalSignalProcessor
          scale={0.4}
          position={[0, 0, 0]}
          rotation={[-Math.PI / 4, 0, 0]}
        />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function SectorTowerScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <SectorTower scale={0.15} position={[0, -1, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function DiamondCellScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <DiamondCell scale={0.2} position={[0, -1, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function PoleMountedSmallCellScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <PoleMountedSmallCell scale={0.15} position={[0, -1, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function HexagonalSmallCellScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <HexagonalSmallCell scale={0.15} position={[0, -1, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function SinglePanelSmallCellScene() {
  return (
    <>
      <group position={MODEL_ROOT_POSITION}>
        <SinglePanelSmallCell scale={0.2} position={[0, -1, 0]} />
      </group>
      <OrbitControls makeDefault enableDamping target={MODEL_CAMERA_TARGET} />
    </>
  );
}

function FreeSpaceRadiationScene() {
  return (
    <>
      <RadiationLobe3D />
      <OrbitControls makeDefault enableDamping target={[8, 0, 0]} />
    </>
  );
}

// ─── Styled components ────────────────────────────────────────────────────────

const LevaGlobalStyles = createGlobalStyle`
  /* Global styles for Leva, if any are still needed. Empty for now as we use theme object. */
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  background: ${(props) => props.theme.background};
  overflow: hidden;
  position: relative;
`;

const ViewportArea = styled.div`
  flex: 1;
  min-height: 0;
  position: relative;
  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
`;

const VCOLayout = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.8fr);
  gap: 20px;
  padding: 68px 24px 24px;
  pointer-events: none;
  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(180px, 1fr) minmax(160px, 0.72fr);
    gap: 10px;
    padding: 62px 12px 12px;
  }
`;
const VCOPanel = styled.div`
  min-width: 0; min-height: 0; position: relative; overflow: hidden;
  border: 1px solid ${(props) => props.theme.border}; border-radius: 14px;
  background: rgba(8, 15, 19, 0.72); backdrop-filter: blur(10px);
  box-shadow: 0 12px 40px rgba(0,0,0,.25); pointer-events: auto;
`;
const WavePanel = styled(VCOPanel)`
  padding: 18px; color: #d5e7ee; font-family: ${(props) => props.theme.typography.mono};
  display: flex; flex-direction: column; gap: 14px;
`;
const Waveform = styled.svg`
  width: 100%; flex: 1; min-height: 100px; border-radius: 8px;
  border: 1px solid rgba(125,220,238,.18); background-color: rgba(0,9,13,.55);
  background-image: linear-gradient(rgba(44,91,102,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(44,91,102,.16) 1px, transparent 1px);
  background-size: 24px 24px;
`;
const AnimatedSine = styled.path<{ $periodSeconds: number }>`
  stroke-dasharray: 12 8;
  animation: sine-flow ${(props) => Math.max(0.3, Math.min(3, props.$periodSeconds * 2))}s linear infinite;
  @keyframes sine-flow { to { stroke-dashoffset: -40; } }
`;
const WaveStats = styled.div`
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
`;
const WaveStat = styled.div`
  min-width: 0; padding: 9px; border-radius: 8px; background: rgba(255,255,255,.045); overflow: hidden;
  span { display: block; color: #8296a0; font-size: 10px; margin-bottom: 5px; }
  strong { display: block; font-size: clamp(9px, .78vw, 14px); font-weight: 500; color: #e6f9ff; white-space: nowrap; font-variant-numeric: tabular-nums; letter-spacing: -0.035em; }
`;
const FrequencyControl = styled.label`
  display: flex; flex-direction: column; gap: 6px;
  color: #a8f2ff; font-size: 10px; letter-spacing: .06em;
`;

const ModelLabel = styled.div`
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border-radius: 999px;
  background: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  color: ${(props) => props.theme.textSecondary};
  font-size: 12px;
  font-family: ${(props) => props.theme.typography.mono};
  letter-spacing: 0.04em;
  pointer-events: none;
  animation: ${fadeIn} 0.3s ease;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;

const PaginationBar = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-height: 104px;
  padding: 10px 16px 12px;
  border-top: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.background};
  backdrop-filter: blur(12px);
  flex-shrink: 0;
`;

const ComponentTrace = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  overflow-x: auto;
  white-space: nowrap;
  font: 10px ${(props) => props.theme.typography.mono};
  color: ${(props) => props.theme.textMuted};
`;

const TraceNode = styled.button<{ $active?: boolean }>`
  border: 1px solid ${(props) => props.$active ? props.theme.primary : props.theme.border};
  border-radius: 4px;
  background: ${(props) => props.$active ? props.theme.primaryAnchor : props.theme.surface};
  color: ${(props) => props.$active ? props.theme.primary : props.theme.textSecondary};
  padding: 5px 8px;
  font: inherit;
  cursor: pointer;
  &:hover { border-color: ${(props) => props.theme.primary}; color: ${(props) => props.theme.primary}; }
`;

const TraceConnector = styled.span`
  color: ${(props) => props.theme.textMuted};
  opacity: .8;
`;

const ClearTraceButton = styled.button`
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-left: 42px;
  flex-shrink: 0;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  color: ${(props) => props.theme.textMuted};
  background: ${(props) => props.theme.surface};
  cursor: pointer;
  &:hover { color: ${(props) => props.theme.textPrimary}; border-color: ${(props) => props.theme.primary}; }
`;

const ModelDrawer = styled.div`
  position: absolute;
  left: 16px;
  bottom: 120px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100% - 48px));
  max-height: min(60vh, 520px);
  padding: 14px;
  overflow-y: auto;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  background: ${(props) => props.theme.background};
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(16px);

  @supports (anchor-name: --gallery-model-menu) and (position-anchor: --gallery-model-menu) {
    position: fixed;
    position-anchor: --gallery-model-menu;
    left: anchor(left);
    bottom: anchor(top);
    margin-bottom: 10px;
    border-color: ${(props) => props.theme.primary};
  }
`;

const DrawerCategory = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;

  & + & {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid ${(props) => props.theme.border};
  }
`;

const DrawerBackButton = styled(AppBackButton)`
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid ${(props) => props.theme.border};
`;

const PaginationControls = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
`;

const ModelSelector = styled.div`
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  min-width: 0;
  padding: 0 4px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
`;

const NavButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textSecondary};
  cursor: pointer;
  transition: all 0.18s ease;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
    background: ${(props) => props.theme.primaryAnchor};
    box-shadow: 0 0 12px ${(props) => `${props.theme.primary}33`};
  }

  &:active:not(:disabled) {
    transform: scale(0.94);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const DrawerToggle = styled(NavButton)`
  flex-shrink: 0;
  anchor-name: --gallery-model-menu;
`;

const DrawerModelButton = styled.button<{ $isActive: boolean }>`
  display: flex;
  align-items: center;
  width: 100%;
  padding: 5px 0 5px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textSecondary};
  font: inherit;
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover {
    color: ${(props) => props.theme.primary};
  }
`;

const CategoryDivider = styled.div`
  width: 1px;
  height: 24px;
  background: ${(props) => props.theme.border};
  margin: 0 4px;
  flex-shrink: 0;
`;

const CategoryLabel = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 4px;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: ${(props) => props.theme.typography.mono};
`;

const DrawerCategoryLabel = styled(CategoryLabel)`
  margin: 0 0 4px;
`;

const ModelPill = styled.button<{ $isActive: boolean }>`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 5px;
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.primary : props.theme.border)};
  background: ${(props) =>
    props.$isActive ? props.theme.primaryAnchor : props.theme.surface};
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textMuted};
  font-size: 12px;
  font-family: ${(props) => props.theme.typography.mono};
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
  letter-spacing: 0.02em;
  box-shadow: ${(props) =>
    props.$isActive ? `0 0 12px ${props.theme.primary}26` : "none"};
  min-height: 36px;
  flex-shrink: 0;

  &:hover {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
    background: ${(props) => props.theme.primaryAnchor};
  }

  &:active {
    transform: scale(0.96);
  }
`;

const PillDot = styled.div<{ $isActive: boolean }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textMuted};
  transition: background 0.18s ease;
  flex-shrink: 0;
`;

// ─── Standard lighting ────────────────────────────────────────────────────────

function StandardLights() {
  return (
    <>
      <ambientLight intensity={MODEL_AMBIENT_LIGHT_INTENSITY} />
      <directionalLight
        position={MODEL_KEY_LIGHT_POSITION}
        intensity={MODEL_KEY_LIGHT_INTENSITY}
      />
      <pointLight
        position={MODEL_FILL_LIGHT_POSITION}
        intensity={MODEL_FILL_LIGHT_INTENSITY}
        color="#ffffff"
      />
      <pointLight
        position={MODEL_BACK_LIGHT_POSITION}
        intensity={MODEL_BACK_LIGHT_INTENSITY}
        color="#8ddcff"
      />
      <pointLight
        position={[-2.8, 2.4, -4.2]}
        intensity={1.4}
        color="#7cc7ff"
      />
      <pointLight position={[2.8, 2.4, -4.2]} intensity={1.4} color="#7cc7ff" />
      <directionalLight
        position={[
          -MODEL_KEY_LIGHT_POSITION[0],
          MODEL_KEY_LIGHT_POSITION[1],
          -MODEL_KEY_LIGHT_POSITION[2],
        ]}
        intensity={MODEL_KEY_LIGHT_INTENSITY * 0.9}
        color="#ffffff"
      />
      <pointLight
        position={[
          -MODEL_FILL_LIGHT_POSITION[0],
          MODEL_FILL_LIGHT_POSITION[1],
          -MODEL_FILL_LIGHT_POSITION[2],
        ]}
        intensity={MODEL_FILL_LIGHT_INTENSITY}
        color="#ffffff"
      />
    </>
  );
}

function BrainLights() {
  return (
    <>
      <ambientLight intensity={MODEL_AMBIENT_LIGHT_INTENSITY} />
      <directionalLight
        position={MODEL_KEY_LIGHT_POSITION}
        intensity={MODEL_KEY_LIGHT_INTENSITY * 0.9}
      />
      <pointLight
        position={MODEL_FILL_LIGHT_POSITION}
        intensity={MODEL_FILL_LIGHT_INTENSITY}
        color="#ffffff"
      />
      <pointLight
        position={MODEL_BACK_LIGHT_POSITION}
        intensity={MODEL_BACK_LIGHT_INTENSITY}
        color="#8ddcff"
      />
      <pointLight position={[0, 1.5, 4]} intensity={1.7} color="#ff7ef5" />
      <pointLight position={[1.4, 0.8, 3.2]} intensity={1.2} color="#00d4ff" />
    </>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const Model3DGalleryRoute: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(FIRST_MODEL_INDEX);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTraceVisible, setIsTraceVisible] = useState(true);
  const activeModel = MODELS[activeIndex];
  const [vcoFrequencyHz, setVcoFrequencyHz] = useState(100);
  const wavePhaseRef = useRef(0);
  useEffect(() => {
    let frame = 0;
    let start: number | undefined;
    const animate = (now: number) => {
      if (start === undefined) start = now;
      wavePhaseRef.current = ((now - start) / 1000) * Math.max(0.5, Math.min(8, vcoFrequencyHz / 500));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [vcoFrequencyHz]);
  const theme = useTheme() as any;
  const isVCO = activeModel.key === "vco";
  const periodSeconds = 1 / vcoFrequencyHz;
  const wavelengthMeters = 299_792_458 / vcoFrequencyHz;

  const prev = useCallback(() => {
    setActiveIndex((i) => Math.max(0, i - 1));
  }, []);

  const next = useCallback(() => {
    setActiveIndex((i) => Math.min(MODELS.length - 1, i + 1));
  }, []);

  const isBrain = activeModel.key === "brain";
  const cameraPos: [number, number, number] = isBrain
    ? [0, 0, 1.4]
    : activeModel.key === "free_space_radiation"
      ? [15, 10, 15]
      : [...MODEL_CAMERA_POSITION];

  return (
    <Wrapper>
      <LevaGlobalStyles />
      <Leva
        hidden={!isVCO && !["room_tx", "polar_radiation", "free_space_radiation"].includes(activeModel.key)}
        collapsed={false}
        theme={{
          sizes: {
            rootWidth: "380px",
            controlWidth: "200px",
            numberInputMinWidth: "85px",
          },
          colors: {
            elevation1: theme.surface || "rgba(18, 18, 20, 0.8)",
            elevation2: "rgba(255, 255, 255, 0.05)",
            elevation3: "rgba(255, 255, 255, 0.1)",
            accent1: theme.primary || "#ac77ff",
            accent2: theme.primary || "#ac77ff",
            accent3: theme.primaryHover || "#c19cff",
            highlight1: theme.textMuted || "#888",
            highlight2: theme.textSecondary || "#ccc",
            highlight3: theme.textPrimary || "#fff",
            folderTextColor: theme.textSecondary || "#ccc",
            folderWidgetColor: theme.textMuted || "#888",
          },
          radii: {
            xs: "4px",
            sm: "6px",
            lg: "12px",
          },
          space: {
            sm: "8px",
            md: "12px",
            rowGap: "8px",
            colGap: "8px",
          },
          fonts: {
            mono: theme.typography?.mono || "'JetBrains Mono', monospace",
            sans: theme.typography?.sans || "Inter, sans-serif",
          },
        }}
      />
      <ViewportArea>
        {isVCO ? (
          <VCOLayout>
            <VCOPanel>
              <Canvas camera={{ position: [5.2, 4.1, 6.4], fov: 42 }}>
                <RendererSizeSync />
                <StandardLights />
                <VCOScene frequencyHz={vcoFrequencyHz} />
              </Canvas>
            </VCOPanel>
            <WavePanel aria-label="VCO sine wave output">
              <FrequencyControl>
                <span>VCO FREQUENCY · ADJUSTABLE STEP</span>
                <FrequencyInput valueHz={vcoFrequencyHz} onChangeHz={setVcoFrequencyHz} minHz={100} maxHz={5_000_000_000} stepMode="adaptive" />
              </FrequencyControl>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#a8f2ff", fontSize: 12, letterSpacing: ".08em" }}>
                <span>SINE OUTPUT</span><span>LIVE · 1 Vpp</span>
              </div>
              <Waveform viewBox="0 0 420 170" role="img" aria-label={`Sine wave at ${vcoFrequencyHz} hertz`}>
                <line x1="0" y1="85" x2="420" y2="85" stroke="rgba(160,205,214,.35)" />
                <AnimatedSine d={Array.from({ length: 421 }, (_, x) => {
                  const cycles = Math.min(12, Math.max(1, (vcoFrequencyHz / 100) ** 0.22));
                  return `${x === 0 ? "M" : "L"}${x},${85 - 58 * Math.sin((x / 420) * Math.PI * 2 * cycles)}`;
                }).join(" ")} fill="none" stroke="#63edc0" strokeWidth="3" $periodSeconds={periodSeconds} />
              </Waveform>
              <WaveStats>
                <WaveStat><span>FREQUENCY</span><strong>{formatFrequency(vcoFrequencyHz)}</strong></WaveStat>
                <WaveStat><span>PERIOD (T)</span><strong>{formatTime(periodSeconds)}</strong></WaveStat>
                <WaveStat><span>WAVELENGTH (λ)</span><strong>{formatLength(wavelengthMeters)}</strong></WaveStat>
              </WaveStats>
              <div style={{ color: "#8199a2", fontSize: 10 }}>λ = c / f · free-space wavelength</div>
            </WavePanel>
          </VCOLayout>
        ) : (
        <>
        {activeModel.key === "polar_radiation" ? (
          <PolarRadioWaveWebGPU />
        ) : (
          <Canvas
            key={activeModel.key}
            style={{ width: "100%", height: "100%" }}
            camera={{ position: cameraPos, fov: MODEL_FOV }}
          >
            <RendererSizeSync />
            <Suspense fallback={null}>
              {isBrain ? (
                <BrainLights />
              ) : (
                !["room_tx", "free_space_radiation"].includes(
                  activeModel.key,
                ) && <StandardLights />
              )}
              {activeModel.key === "afro-male" && <HumanAfroMaleScene />}
              {activeModel.key === "neutral" && <HumanNeutralScene />}
              {activeModel.key === "brain" && <BrainScene />}
              {activeModel.key === "lna" && <LNAScene />}
              {activeModel.key === "synth" && <SynthScene />}
              {activeModel.key === "vco" && <VCOScene frequencyHz={vcoFrequencyHz} />}
              {activeModel.key === "bbu" && <BbuScene />}
              {activeModel.key === "dds" && <DDSScene />}
              {activeModel.key === "bpf" && <BandpassFilterScene />}
              {activeModel.key === "hpf" && <HighPassFilterScene />}
              {activeModel.key === "lo" && <LocalOscillatorScene />}
              {activeModel.key === "mixer" && <RFMixerScene />}
              {activeModel.key === "bb_amp" && <BasebandAmplifierScene />}
              {activeModel.key === "adc" && <AnalogDigitalConverterScene />}
              {activeModel.key === "dsp" && <DSPScene />}
              {activeModel.key === "sector" && <SectorTowerScene />}
              {activeModel.key === "diamond" && <DiamondCellScene />}
              {activeModel.key === "pole_small" && (
                <PoleMountedSmallCellScene />
              )}
              {activeModel.key === "hexagonal" && <HexagonalSmallCellScene />}
              {activeModel.key === "single_panel" && (
                <SinglePanelSmallCellScene />
              )}
              {activeModel.key === "room_tx" && <RoomTxScene />}
              {activeModel.key === "free_space_radiation" && (
                <FreeSpaceRadiationScene />
              )}
            </Suspense>
          </Canvas>
        )}
        </>
        )}

        <ModelLabel>
          <Box size={13} />
          {activeModel.label} — {activeModel.description}
        </ModelLabel>
      </ViewportArea>

      {isDrawerOpen && (
        <ModelDrawer aria-label="All 3D models">
          {CATEGORY_ORDER.map((category) => (
            <DrawerCategory key={category}>
              <DrawerCategoryLabel>{category}</DrawerCategoryLabel>
              {MODELS.map((model, i) =>
                model.category === category ? (
                  <DrawerModelButton
                    key={model.key}
                    $isActive={i === activeIndex}
                    onClick={() => {
                      setActiveIndex(i);
                      setIsDrawerOpen(false);
                    }}
                  >
                    {model.label}
                  </DrawerModelButton>
                ) : null,
              )}
            </DrawerCategory>
          ))}
          <DrawerBackButton variant="bar" />
        </ModelDrawer>
      )}

      <PaginationBar>
        {isTraceVisible && isVCO ? (
          <ComponentTrace aria-label="VCO component relationship trace">
            <span>COMPONENT TRACE</span>
            <TraceNode onClick={() => setActiveIndex(MODELS.findIndex((model) => model.key === "synth"))}>Frequency Synthesizer</TraceNode>
            <span>(may integrate)</span>
            <TraceConnector>→</TraceConnector>
            <TraceNode $active>VCO</TraceNode>
            <TraceConnector>→</TraceConnector>
            <TraceNode onClick={() => setActiveIndex(MODELS.findIndex((model) => model.key === "lo"))}>Local Oscillator output</TraceNode>
            <ClearTraceButton type="button" aria-label="Clear component trace" title="Clear trace" onClick={() => setIsTraceVisible(false)}><X size={15} /></ClearTraceButton>
          </ComponentTrace>
        ) : isTraceVisible ? (
          <ComponentTrace aria-label="Current component trace">
            <span>{activeModel.category.toUpperCase()}</span><TraceConnector>→</TraceConnector><TraceNode $active>{activeModel.label}</TraceNode>
            <ClearTraceButton type="button" aria-label="Clear component trace" title="Clear trace" onClick={() => setIsTraceVisible(false)}><X size={15} /></ClearTraceButton>
          </ComponentTrace>
        ) : <div aria-hidden="true" style={{ minHeight: 30 }} />}
        <PaginationControls>
        <DrawerToggle
          type="button"
          onClick={() => setIsDrawerOpen((open) => !open)}
          aria-label={isDrawerOpen ? "Close model list" : "Open model list"}
          aria-expanded={isDrawerOpen}
        >
          <Menu size={18} />
        </DrawerToggle>
        <NavButton
          id="model-gallery-prev"
          onClick={prev}
          disabled={activeIndex === 0}
          aria-label="Previous model"
        >
          <ChevronLeft size={18} />
        </NavButton>

        <ModelSelector aria-label="Gallery components and models">
          {CATEGORY_ORDER.map(
            (category, catIdx) => (
              <React.Fragment key={category}>
                {catIdx > 0 && <CategoryDivider />}
                <CategoryLabel>{category}</CategoryLabel>
                {MODELS.map((model, i) => {
                  if (model.category !== category) return null;
                  return (
                    <ModelPill
                      key={model.key}
                      id={`model-gallery-pill-${model.key}`}
                      $isActive={i === activeIndex}
                      onClick={() => setActiveIndex(i)}
                      aria-label={`Select ${model.label}`}
                    >
                      <PillDot $isActive={i === activeIndex} />
                      {model.label}
                    </ModelPill>
                  );
                })}
              </React.Fragment>
            ),
          )}
        </ModelSelector>

        <NavButton
          id="model-gallery-next"
          onClick={next}
          disabled={activeIndex === MODELS.length - 1}
          aria-label="Next model"
        >
          <ChevronRight size={18} />
        </NavButton>
        </PaginationControls>
      </PaginationBar>
    </Wrapper>
  );
};
