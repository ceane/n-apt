import React, { Suspense, useState, useCallback, useEffect } from "react";
import styled, { useTheme, keyframes } from "styled-components";
import { Leva } from "leva";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { ChevronLeft, ChevronRight, Box } from "lucide-react";
import Brain from "@n-apt/components/3D/Brain";
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
} from "@n-apt/components/3D";
import {
  BRAIN_GLB_URL,
  HUMAN_MODEL_AFRO_MALE_GLB_URL,
} from "@n-apt/components/3D/modelAssetUrls";
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

// ─── GLB-backed scene components ─────────────────────────────────────────────

const NEUTRAL_GLB_URL = new URL(
  "../../../public/glb_models/human_model_neutral.glb",
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

function AnimatedRadioWaves({ speed = 1.5 }: { speed?: number }) {
  const wavesRef = React.useRef<any>(null);
  useFrame(({ clock }) => {
    if (!wavesRef.current) return;
    const t = clock.getElapsedTime() * speed;
    wavesRef.current.children.forEach((mesh: any, i: number) => {
      const offset = i * (1 / 3);
      const progress = (t + offset) % 1; // 0 to 1
      mesh.scale.setScalar(progress * 6 + 0.1);
      mesh.material.opacity = (1 - progress) * 0.4;
    });
  });

  return (
    <group ref={wavesRef} position={[-0.75, 1, 0.5]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.05, 16, 64]} />
          <meshBasicMaterial color="#ac77ff" transparent opacity={0} depthWrite={false} side={2} />
        </mesh>
      ))}
    </group>
  );
}

function FreeSpaceRadiationScene() {
  return (
    <>
      <group position={[0, -0.5, 0]}>
        <RadiationLobe3D />
      </group>
      <OrbitControls makeDefault enableDamping target={[0, 0, 0]} />
    </>
  );
}

function RoomTxScene() {
  const { emissionRealism, power, frequency, animationSpeed } = useControls("Room TX Setup", {
    emissionRealism: { options: { "None": "none" } },
    power: { value: 43, min: 0, max: 100 },
    frequency: { value: 1500, min: 100, max: 6000 },
    animationSpeed: { value: 1.5, min: 0.1, max: 5 },
  });

  return (
    <>
      <ambientLight intensity={0.1} />
      <pointLight position={[0, 4, -8]} intensity={10} color="#ffffff" distance={20} decay={1.5} />
      <directionalLight position={[0, 4, -8]} intensity={2} color="#ffffff" />
      
      <group position={[0, -2, 0]}>
        {/* Floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#2a221b" roughness={0.8} />
        </mesh>
        
        {/* Back Wall */}
        <mesh position={[0, 5, -10]} receiveShadow>
          <planeGeometry args={[20, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.9} />
        </mesh>

        {/* Side Walls */}
        <mesh position={[-10, 5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[20, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.9} />
        </mesh>
        <mesh position={[10, 5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[20, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.9} />
        </mesh>
        
        {/* Ceiling */}
        <mesh position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#151518" roughness={1} />
        </mesh>

        {/* Window - acts as light source */}
        <mesh position={[0, 5, -9.9]}>
          <planeGeometry args={[6, 6]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>

        {/* Desk */}
        <group position={[0, 2, -3]}>
          {/* Tabletop */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[6, 0.2, 3]} />
            <meshStandardMaterial color="#4a3018" roughness={0.7} />
          </mesh>
          {/* Legs */}
          <mesh position={[-2.8, -1, -1.3]} castShadow>
            <boxGeometry args={[0.2, 2, 0.2]} />
            <meshStandardMaterial color="#3a2010" />
          </mesh>
          <mesh position={[2.8, -1, -1.3]} castShadow>
            <boxGeometry args={[0.2, 2, 0.2]} />
            <meshStandardMaterial color="#3a2010" />
          </mesh>
          <mesh position={[-2.8, -1, 1.3]} castShadow>
            <boxGeometry args={[0.2, 2, 0.2]} />
            <meshStandardMaterial color="#3a2010" />
          </mesh>
          <mesh position={[2.8, -1, 1.3]} castShadow>
            <boxGeometry args={[0.2, 2, 0.2]} />
            <meshStandardMaterial color="#3a2010" />
          </mesh>
          
          {/* Transmitter on Desk */}
          <group position={[0, 0.2, 0]}>
            {/* Box */}
            <mesh position={[0, 0, 0]} castShadow>
              <boxGeometry args={[1, 0.25, 1.5]} />
              <meshStandardMaterial color="#111111" roughness={0.5} />
            </mesh>
            {/* Antenna connector */}
            <mesh position={[-0.6, 0, 0.5]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.2]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.8} />
            </mesh>
            {/* Antenna joint */}
            <mesh position={[-0.75, 0, 0.5]}>
              <sphereGeometry args={[0.06]} />
              <meshStandardMaterial color="#222222" />
            </mesh>
            {/* Antenna */}
            <mesh position={[-0.75, 1, 0.5]}>
              <cylinderGeometry args={[0.03, 0.03, 2]} />
              <meshStandardMaterial color="#222222" />
            </mesh>
            <AnimatedRadioWaves speed={animationSpeed} />
            {/* Red Knobs/Connectors */}
            <mesh position={[0.55, 0, -0.4]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[0.08, 0.08, 0.1]} />
              <meshStandardMaterial color="#dd0000" />
            </mesh>
            <mesh position={[0.55, 0, 0.4]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[0.08, 0.08, 0.1]} />
              <meshStandardMaterial color="#dd0000" />
            </mesh>
          </group>
        </group>
      </group>
      <OrbitControls makeDefault enableDamping target={[0, 0, -3]} maxPolarAngle={Math.PI / 2 - 0.05} />
    </>
  );
}

// ─── Styled components ────────────────────────────────────────────────────────

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
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.background};
  backdrop-filter: blur(12px);
  flex-shrink: 0;
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

const ModelSelector = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  overflow-x: auto;
  max-width: calc(100vw - 200px);

  /* Hide scrollbar for cleaner look but still scrollable */
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
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

const ModelPill = styled.button<{ $isActive: boolean }>`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 16px;
  border-radius: 8px;
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
  const [activeIndex, setActiveIndex] = useState(0);
  const activeModel = MODELS[activeIndex];
  const theme = useTheme();

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
      <Leva
        theme={{
          sizes: {
            rootWidth: "340px",
            controlWidth: "160px",
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
            folderText: theme.textSecondary || "#ccc",
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
              {isBrain ? <BrainLights /> : (!["room_tx", "free_space_radiation"].includes(activeModel.key) && <StandardLights />)}
              {activeModel.key === "afro-male" && <HumanAfroMaleScene />}
              {activeModel.key === "neutral" && <HumanNeutralScene />}
              {activeModel.key === "brain" && <BrainScene />}
              {activeModel.key === "lna" && <LNAScene />}
              {activeModel.key === "synth" && <SynthScene />}
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
              {activeModel.key === "pole_small" && <PoleMountedSmallCellScene />}
              {activeModel.key === "hexagonal" && <HexagonalSmallCellScene />}
              {activeModel.key === "single_panel" && (
                <SinglePanelSmallCellScene />
              )}
              {activeModel.key === "room_tx" && <RoomTxScene />}
              {activeModel.key === "free_space_radiation" && <FreeSpaceRadiationScene />}
            </Suspense>
          </Canvas>
        )}

        <ModelLabel>
          <Box size={13} />
          {activeModel.label} — {activeModel.description}
        </ModelLabel>
      </ViewportArea>

      <PaginationBar>
        <NavButton
          id="model-gallery-prev"
          onClick={prev}
          disabled={activeIndex === 0}
          aria-label="Previous model"
        >
          <ChevronLeft size={18} />
        </NavButton>

        <ModelSelector>
          {Array.from(new Set(MODELS.map((m) => m.category))).map(
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
      </PaginationBar>
    </Wrapper>
  );
};
