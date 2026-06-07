import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useControls, folder } from "leva";
import { levaFrequency } from "@n-apt/components/ui/levaFrequencyPlugin";
import { levaGainScale } from "@n-apt/components/ui/levaGainScalePlugin";
import { Html, Sphere } from "@react-three/drei";
import styled from "styled-components";
import {
  TOWER_CONFIGS,
  TowerType,
  SectorTower,
  DiamondCell,
  PoleMountedSmallCell,
  HexagonalSmallCell,
  SinglePanelSmallCell,
} from "./CellTowers";

interface RadiationLobe3DProps {
  frequency?: number; // MHz
  aperture?: number; // m (D)
  powerDbm?: number;
  apertureWidth?: number;
  apertureHeight?: number;
  showMultipathRays?: boolean;
  showScatteringCloud?: boolean;
  multipathStrength?: number;
  height?: number; // m (h)
  n?: number; // horizontal beam shaping
  m?: number; // vertical beam shaping
  showNearFarField?: boolean;
  showGroundInterference?: boolean;
}

const LobeLabel = styled.div`
  background: rgba(0, 0, 0, 0.7);
  color: #ac77ff;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #ac77ff;
        theme={{
          sizes: {
            rootWidth: "340px",
            controlWidth: "160px",
          },
          colors: {
            elevation1: theme.colors?.surface || "rgba(18, 18, 20, 0.8)",
            elevation2: "rgba(255, 255, 255, 0.05)",
            elevation3: "rgba(255, 255, 255, 0.1)",
            accent1: theme.colors?.primary || "#ac77ff",
            accent2: theme.colors?.primary || "#ac77ff",
            accent3: theme.colors?.primaryHover || "#c19cff",
            highlight1: theme.colors?.textMuted || "#888",
            highlight2: theme.colors?.textSecondary || "#ccc",
            highlight3: theme.colors?.textPrimary || "#fff",
            folderText: theme.colors?.textSecondary || "#ccc",
            folderWidgetColor: theme.colors?.textMuted || "#888",
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
            mono: (theme.typography?.mono as string) || "'JetBrains Mono', monospace",
            sans: (theme.typography?.sans as string) || "Inter, sans-serif",
          },
        }}t-size: 10px;
  white-space: nowrap;
  pointer-events: none;
`;

const ControlPanel = styled.div`
  background: rgba(10, 10, 12, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: auto;
  color: white;
  font-family: "Inter", sans-serif;
  width: 200px;
`;

const TowerSelect = styled.select`
  background: #111;
  color: #eee;
  border: 1px solid #333;
  padding: 6px;
  border-radius: 4px;
  outline: none;
  font-family: "Inter", sans-serif;
  font-size: 12px;
  cursor: pointer;

  &:focus {
    border-color: #ac77ff;
  }
`;

const NumberInput = styled.input`
  background: #111;
  color: #eee;
  border: 1px solid #333;
  padding: 6px;
  border-radius: 4px;
  outline: none;
  font-family: "Inter", sans-serif;
  font-size: 12px;
  width: 84px;
  text-align: right;

  &:focus {
    border-color: #ac77ff;
  }
`;

const ToggleInput = styled.input`
  accent-color: #ac77ff;
  cursor: pointer;
`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const sinc = (value: number) =>
  Math.abs(value) < 1e-6 ? 1 : Math.sin(value) / value;
const dbmToWatts = (value: number) => Math.pow(10, value / 10) / 1000;
const normalizedArrayFactor = (count: number, phaseDelta: number) => {
  if (count <= 1) {
    return 1;
  }

  const denominator = Math.sin(phaseDelta / 2);
  if (Math.abs(denominator) < 1e-6) {
    return 1;
  }

  return Math.abs(Math.sin((count * phaseDelta) / 2) / (count * denominator));
};

const createMainLobeGroundReach = (
  powerWatts: number,
  visibilityThreshold: number,
) => Math.sqrt(powerWatts / (4 * Math.PI * visibilityThreshold));

const TOWER_RADIATION_PRESETS: Record<
  TowerType,
  {
    horizontalElements: number;
    verticalElements: number;
    frontExponent: number;
    backFloor: number;
    sideLobeFloor: number;
  }
> = {
  none: {
    horizontalElements: 6,
    verticalElements: 10,
    frontExponent: 1.5,
    backFloor: 0.03,
    sideLobeFloor: 0.02,
  },
  sector: {
    horizontalElements: 8,
    verticalElements: 12,
    frontExponent: 2.4,
    backFloor: 0.02,
    sideLobeFloor: 0.03,
  },
  diamond: {
    horizontalElements: 4,
    verticalElements: 4,
    frontExponent: 2.1,
    backFloor: 0.03,
    sideLobeFloor: 0.025,
  },
  pole_small: {
    horizontalElements: 3,
    verticalElements: 6,
    frontExponent: 1.2,
    backFloor: 0.12,
    sideLobeFloor: 0.04,
  },
  hexagonal: {
    horizontalElements: 6,
    verticalElements: 8,
    frontExponent: 1.35,
    backFloor: 0.1,
    sideLobeFloor: 0.05,
  },
  single_panel: {
    horizontalElements: 5,
    verticalElements: 8,
    frontExponent: 2,
    backFloor: 0.025,
    sideLobeFloor: 0.03,
  },
};

export const RadiationLobe3D: React.FC<RadiationLobe3DProps> = ({
  frequency = 1800,
  aperture = 0.65,
  powerDbm = 43,
  apertureWidth,
  apertureHeight,
  showMultipathRays = true,
  showScatteringCloud = true,
  multipathStrength = 0.32,
  height = 5,
  n = 6,
  m = 20,
  showNearFarField = true,
  showGroundInterference = true,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const {
    selectedTower,
    frequencyMHz,
    powerLevelDbm,
    apertureWidthM,
    apertureHeightM,
    showMultipath,
    showScattering,
    secondaryStrength,
    showLabels,
  } = useControls("Radiation Lobe Setup", {
    "Cell Tower / Site": folder({
      selectedTower: {
        label: "Model",
        options: {
          "Sector Tower": "sector",
          "Diamond Cell": "diamond",
          "Pole Mounted": "pole_small",
          "Hexagonal Cell": "hexagonal",
          "Single Panel": "single_panel",
        },
        value: "sector",
      },
    }),
    Parameters: folder({
      frequencyMHz: levaFrequency(1800000000),
      powerLevelDbm: { label: "Power Level", value: 43, min: -70, max: 64, step: 1, suffix: "dBm" },
      apertureWidthM: { label: "Aperture Width", value: 0.65, min: 0.1, max: 5.0, suffix: "m" },
      apertureHeightM: { label: "Aperture Height", value: 1.56, min: 0.1, max: 5.0, suffix: "m" },
    }),
    Effects: folder({
      showLabels: { label: "Show Labels", value: true },
      showMultipath: { label: "Show Multipath", value: showMultipathRays },
      showScattering: { label: "Show Scattering", value: showScatteringCloud },
      secondaryStrength: {
        label: "Secondary Strength",
        value: 0.32,
        min: 0,
        max: 1,
      },
    }),
    Reference: folder({
      scale: levaGainScale(),
    }),
  });

  const towerConfig = TOWER_CONFIGS[selectedTower as TowerType];
  const towerPreset = TOWER_RADIATION_PRESETS[selectedTower as TowerType];
  const originHeight =
    selectedTower === "none" ? height : towerConfig.antennaOrigin[1];

  const c = 3e8;
  const safeFrequencyMHz = clamp((frequencyMHz as any) / 1e6, 0.001, 100000);
  const safePowerDbm = clamp(powerLevelDbm, -70, 64);
  const effectiveApertureWidth = Math.max(0.1, apertureWidthM);
  const effectiveApertureHeight = Math.max(0.2, apertureHeightM);
  const wavelength = c / (safeFrequencyMHz * 1e6);
  const powerWatts = dbmToWatts(safePowerDbm);
  const k = (2 * Math.PI) / wavelength;
  const effectiveDiameter = Math.max(
    effectiveApertureWidth,
    effectiveApertureHeight,
  );
  const farFieldDistance = (2 * Math.pow(effectiveDiameter, 2)) / wavelength;
  const hpbwHorizontal = clamp(
    ((0.886 * wavelength) / effectiveApertureWidth) * (180 / Math.PI),
    2,
    180,
  );
  const hpbwVertical = clamp(
    ((0.886 * wavelength) / effectiveApertureHeight) * (180 / Math.PI),
    2,
    180,
  );
  const horizontalSpacing =
    effectiveApertureWidth / Math.max(1, towerPreset.horizontalElements - 1);
  const verticalSpacing =
    effectiveApertureHeight / Math.max(1, towerPreset.verticalElements - 1);
  const horizontalTaper = clamp(n / 6, 0.6, 3);
  const verticalTaper = clamp(m / 20, 0.6, 3.5);
  const visualScale = clamp(Math.sqrt(powerWatts) * 1.6 + 3, 3, 12);
  const visibilityThreshold = 0.008;
  const mainLobeGroundReach = Math.min(
    24,
    createMainLobeGroundReach(powerWatts, visibilityThreshold) * 1.35,
  );
  const gridSpan = Math.max(
    60,
    Math.ceil((mainLobeGroundReach * 2.8) / 10) * 10,
    Math.ceil((farFieldDistance * 2.2) / 10) * 10,
  );
  const gridDivisions = Math.max(40, Math.ceil(gridSpan / 2));
  const safeSecondaryStrength = clamp(secondaryStrength, 0, 1);

  const geometry = useMemo(() => {
    const size = 72;
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];

    for (let j = 0; j <= size; j++) {
      const phi = (j / size) * Math.PI - Math.PI / 2;
      for (let i = 0; i <= size; i++) {
        const theta = (i / size) * Math.PI * 2;
        const dirX = Math.cos(phi) * Math.cos(theta);
        const dirY = Math.cos(phi) * Math.sin(theta);
        const dirZ = Math.sin(phi);
        const horizontalAngle = Math.atan2(dirY, dirX);
        const verticalAngle = Math.atan2(dirZ, dirX);
        const apertureFactorH = Math.abs(
          sinc((k * effectiveApertureWidth * Math.sin(horizontalAngle)) / 2),
        );
        const apertureFactorV = Math.abs(
          sinc((k * effectiveApertureHeight * Math.sin(verticalAngle)) / 2),
        );
        const arrayFactorH = normalizedArrayFactor(
          towerPreset.horizontalElements,
          k * horizontalSpacing * Math.sin(horizontalAngle),
        );
        const arrayFactorV = normalizedArrayFactor(
          towerPreset.verticalElements,
          k * verticalSpacing * Math.sin(verticalAngle),
        );
        const apertureEnvelope =
          Math.pow(apertureFactorH, 0.8 * horizontalTaper) *
          Math.pow(apertureFactorV, 0.8 * verticalTaper);
        const arrayEnvelope =
          Math.pow(arrayFactorH, 0.75) * Math.pow(arrayFactorV, 0.75);
        const frontWeight =
          dirX > 0
            ? Math.pow(clamp(dirX, 0, 1), towerPreset.frontExponent)
            : towerPreset.backFloor;
        let intensity = clamp(
          apertureEnvelope * arrayEnvelope * frontWeight,
          0,
          1,
        );

        if (dirX > 0) {
          intensity = Math.max(
            intensity,
            towerPreset.sideLobeFloor *
              arrayEnvelope *
              Math.pow(Math.max(apertureEnvelope, 0), 0.35),
          );
        } else {
          intensity = Math.max(intensity, towerPreset.backFloor * 0.7);
        }

        if (showGroundInterference) {
          const phase = k * 2 * originHeight * Math.sin(phi);
          const groundFactor = Math.sqrt(2 * (1 + Math.cos(phase)));
          intensity *= groundFactor / 2;
        }

        const range = Math.sqrt(
          (powerWatts * Math.max(intensity, 1e-5)) /
            (4 * Math.PI * visibilityThreshold),
        );
        const boundedRange = Math.min(24, range * 1.35);
        const x = boundedRange * Math.cos(phi) * Math.cos(theta);
        const y = boundedRange * Math.cos(phi) * Math.sin(theta);
        const z = boundedRange * Math.sin(phi);
        const heat = clamp(
          (Math.log10(1 + powerWatts * intensity * 16) + 0.15) / 1.6,
          0,
          1,
        );

        vertices.push(x, z, -y);
        colors.push(heat, 0.9 - Math.abs(heat - 0.45), 1 - heat * 0.35);
      }
    }

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const row1 = j * (size + 1);
        const row2 = (j + 1) * (size + 1);
        indices.push(row1 + i, row1 + i + 1, row2 + i);
        indices.push(row1 + i + 1, row2 + i + 1, row2 + i);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [
    effectiveApertureHeight,
    effectiveApertureWidth,
    horizontalSpacing,
    horizontalTaper,
    k,
    originHeight,
    powerWatts,
    showGroundInterference,
    towerPreset.backFloor,
    towerPreset.frontExponent,
    towerPreset.horizontalElements,
    towerPreset.sideLobeFloor,
    towerPreset.verticalElements,
    verticalSpacing,
    verticalTaper,
  ]);

  const farFieldVisualRadius = clamp(farFieldDistance, 0.25, 25);
  const distanceLinePoints = useMemo(
    () => [
      new THREE.Vector3(0, -originHeight + 0.03, 0),
      new THREE.Vector3(mainLobeGroundReach, -originHeight + 0.03, 0),
    ],
    [mainLobeGroundReach, originHeight],
  );
  const distanceMarkerPosition: [number, number, number] = [
    mainLobeGroundReach / 2,
    -originHeight + 0.12,
    0,
  ];
  const distanceEndLabelPosition: [number, number, number] = [
    mainLobeGroundReach,
    -originHeight + 0.12,
    0,
  ];
  const multipathRays = useMemo(() => {
    const baseReach = Math.max(mainLobeGroundReach, visualScale * 1.8);
    const reflectedReach = baseReach * (0.45 + safeSecondaryStrength * 0.4);
    const elevatedReach = baseReach * (0.35 + safeSecondaryStrength * 0.35);
    const groundBounceReach = baseReach * (0.55 + safeSecondaryStrength * 0.3);
    return [
      {
        points: [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(
            reflectedReach * 0.4,
            reflectedReach * 0.08,
            reflectedReach * 0.22,
          ),
          new THREE.Vector3(
            reflectedReach,
            reflectedReach * 0.03,
            reflectedReach * 0.42,
          ),
        ],
        color: "#7fd4ff",
      },
      {
        points: [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(
            elevatedReach * 0.45,
            elevatedReach * 0.24,
            -elevatedReach * 0.12,
          ),
          new THREE.Vector3(
            elevatedReach,
            elevatedReach * 0.34,
            -elevatedReach * 0.24,
          ),
        ],
        color: "#8dffcb",
      },
      {
        points: [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(groundBounceReach * 0.42, -originHeight + 0.08, 0),
          new THREE.Vector3(
            groundBounceReach * 0.74,
            -originHeight + 0.7 + wavelength * 0.8,
            0.22 * groundBounceReach,
          ),
        ],
        color: "#ffd6a5",
      },
    ];
  }, [
    mainLobeGroundReach,
    originHeight,
    safeSecondaryStrength,
    visualScale,
    wavelength,
  ]);
  const scatteringGeometry = useMemo(() => {
    const size = 42;
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const spreadScale =
      mainLobeGroundReach * (0.75 + safeSecondaryStrength * 0.45);

    for (let j = 0; j <= size; j++) {
      const phi = (j / size) * Math.PI - Math.PI / 2;
      for (let i = 0; i <= size; i++) {
        const theta = (i / size) * Math.PI * 2;
        const dirX = Math.cos(phi) * Math.cos(theta);
        const dirY = Math.cos(phi) * Math.sin(theta);
        const dirZ = Math.sin(phi);
        const forwardBias = dirX > 0 ? 0.85 : 0.35;
        const azimuthBanding =
          0.55 + 0.45 * Math.sin(theta * 3 + wavelength * 8);
        const elevationBanding =
          0.65 + 0.35 * Math.cos(phi * 4 - wavelength * 5);
        const noise =
          0.82 + 0.18 * Math.sin(theta * 9 + phi * 7 + wavelength * 12);
        const intensity = clamp(
          safeSecondaryStrength *
            0.32 *
            forwardBias *
            azimuthBanding *
            elevationBanding *
            noise,
          0.015,
          0.32,
        );
        const radius =
          spreadScale * intensity * (1.1 + 0.35 * Math.max(dirX, 0));
        const x = radius * dirX;
        const y = radius * dirY;
        const z = radius * dirZ;
        const heat = clamp(intensity / 0.32, 0, 1);
        vertices.push(x, z, -y);
        colors.push(0.45 + heat * 0.2, 0.55 + heat * 0.25, 1);
      }
    }

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const row1 = j * (size + 1);
        const row2 = (j + 1) * (size + 1);
        indices.push(row1 + i, row1 + i + 1, row2 + i);
        indices.push(row1 + i + 1, row2 + i + 1, row2 + i);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [mainLobeGroundReach, safeSecondaryStrength, wavelength]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
      <directionalLight position={[-10, 5, -10]} intensity={0.5} />
      <pointLight
        position={[0, originHeight + 5, 0]}
        intensity={0.8}
        color="#ac77ff"
        distance={15}
      />
      {selectedTower === "sector" && (
        <group position={[0, -originHeight, 0]}>
          <SectorTower />
        </group>
      )}
      {selectedTower === "diamond" && (
        <group position={[0, -originHeight, 0]}>
          <DiamondCell />
        </group>
      )}
      {selectedTower === "pole_small" && (
        <group position={[0, -originHeight, 0]}>
          <PoleMountedSmallCell />
        </group>
      )}
      {selectedTower === "hexagonal" && (
        <group position={[0, -originHeight, 0]}>
          <HexagonalSmallCell />
        </group>
      )}
      {selectedTower === "single_panel" && (
        <group position={[0, -originHeight, 0]}>
          <SinglePanelSmallCell />
        </group>
      )}

      <group position={[0, 0, 0]}>
        {/* Ground Plane reference at y=0, relative to the shifted group */}
        <gridHelper
          args={[gridSpan, gridDivisions, 0x444444, 0x222222]}
          position={[gridSpan / 2 - 2, -originHeight, 0]}
        />

        <line>
          <bufferGeometry setFromPoints={distanceLinePoints} />
          <lineBasicMaterial color="#ffd166" />
        </line>

        <mesh
          position={[mainLobeGroundReach, -originHeight + 0.03, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <coneGeometry args={[0.12, 0.45, 12]} />
          <meshBasicMaterial color="#ffd166" />
        </mesh>

        {showLabels && (
          <Html position={distanceMarkerPosition} center zIndexRange={[100, 0]}>
            <LobeLabel style={{ borderColor: "#ffd166", color: "#ffd166" }}>
              Ground Reach {mainLobeGroundReach.toFixed(1)}m
            </LobeLabel>
          </Html>
        )}

        {showLabels && (
          <Html position={distanceEndLabelPosition} center zIndexRange={[100, 0]}>
            <LobeLabel
              style={{ borderColor: "#ffd166", color: "#ffd166", opacity: 0.85 }}
            >
              {mainLobeGroundReach.toFixed(1)}m
            </LobeLabel>
          </Html>
        )}
      </group>

      {towerConfig.emitterFaces.map((facePos, index) => {
        const originY = facePos[1] - originHeight;
        return (
          <group
            key={index}
            position={[facePos[0], originY, facePos[2]]}
            rotation={towerConfig.antennaRotation}
          >
            {/* Antenna Marker */}
            <mesh>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshBasicMaterial color="#ac77ff" />
              {showLabels && index === 0 && (
                <Html position={[0, 0.2, 0]} center zIndexRange={[100, 0]}>
                  <LobeLabel>Panel/Antenna</LobeLabel>
                </Html>
              )}
            </mesh>

            {/* Radiation Lobe Surface */}
            <mesh geometry={geometry}>
              <meshStandardMaterial
                vertexColors
                transparent
                opacity={0.75}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* Secondary Lobe / Scattering Cloud */}
            {showScattering && (
              <mesh geometry={scatteringGeometry}>
                <meshStandardMaterial
                  vertexColors
                  transparent
                  opacity={0.22 + safeSecondaryStrength * 0.14}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            )}

            {/* Multipath Rays */}
            {showMultipath &&
              multipathRays.map((ray, rayIdx) => (
                <group key={rayIdx}>
                  <line>
                    <bufferGeometry setFromPoints={ray.points} />
                    <lineBasicMaterial
                      color={ray.color}
                      transparent
                      opacity={0.35 + safeSecondaryStrength * 0.28}
                    />
                  </line>
                  <mesh
                    position={
                      ray.points[ray.points.length - 1].toArray() as [
                        number,
                        number,
                        number,
                      ]
                    }
                  >
                    <sphereGeometry args={[0.06 + index * 0.01, 10, 10]} />
                    <meshBasicMaterial
                      color={ray.color}
                      transparent
                      opacity={0.65}
                    />
                  </mesh>
                </group>
              ))}

            {/* Near-Field / Far-Field Boundary */}
            {showNearFarField && showLabels && index === 0 && (
              <Sphere args={[farFieldVisualRadius, 32, 32]}>
                <meshBasicMaterial
                  color="#ffffff"
                  transparent
                  opacity={0.05}
                  wireframe
                />
                <Html
                  position={[0, farFieldVisualRadius, 0]}
                  center
                  zIndexRange={[100, 0]}
                >
                  <LobeLabel style={{ borderColor: "#aaa", color: "#aaa" }}>
                    Far-Field Boundary ({farFieldDistance.toFixed(3)}m)
                  </LobeLabel>
                </Html>
              </Sphere>
            )}

            {/* Lobe Labels */}
            {showLabels && index === 0 && (
              <>
                <Html
                  position={[visualScale * 1.1, 0, 0]}
                  center
                  zIndexRange={[100, 0]}
                >
                  <LobeLabel>
                    Main Lobe (HPBW: H:{hpbwHorizontal.toFixed(1)}° V:
                    {hpbwVertical.toFixed(1)}°)
                  </LobeLabel>
                </Html>

                <Html
                  position={[
                    visualScale * 0.4,
                    visualScale * 0.3,
                    visualScale * 0.4,
                  ]}
                  center
                  zIndexRange={[100, 0]}
                >
                  <LobeLabel style={{ opacity: 0.7, fontSize: "8px" }}>
                    Side Lobe
                  </LobeLabel>
                </Html>

                <Html
                  position={[
                    visualScale * 0.4,
                    -visualScale * 0.3,
                    -visualScale * 0.4,
                  ]}
                  center
                  zIndexRange={[100, 0]}
                >
                  <LobeLabel style={{ opacity: 0.7, fontSize: "8px" }}>
                    Minor Lobe
                  </LobeLabel>
                </Html>

                <Html
                  position={[-visualScale * 0.3, 0, 0]}
                  center
                  zIndexRange={[100, 0]}
                >
                  <LobeLabel style={{ opacity: 0.6 }}>Back Lobe</LobeLabel>
                </Html>
              </>
            )}
          </group>
        );
      })}
    </>
  );
};
