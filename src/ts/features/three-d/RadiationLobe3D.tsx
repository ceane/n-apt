import React, { useMemo, useState, useEffect } from "react";
import {
  calculateRadiationLobeReach,
  calculateRadiationLobeReachJS,
} from "@n-apt/app/infrastructure/services/safetyWasm";
import * as THREE from "three";
import { useControls, folder, useCreateStore } from "leva";
import { levaFrequency } from "@n-apt/ui/levaFrequencyPlugin";
import { levaGainScale } from "@n-apt/ui/levaGainScalePlugin";
import { levaPanelSelector } from "@n-apt/ui/levaPanelSelectorPlugin";
import { Html, Sphere } from "@react-three/drei";
import styled from "styled-components";
import {
  TOWER_CONFIGS,
  TowerType,
  resolveTowerType,
  SectorTower,
  DiamondCell,
  PoleMountedSmallCell,
  HexagonalSmallCell,
  SinglePanelSmallCell,
} from "@n-apt/three-d/CellTowers";

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
  useLevaControls?: boolean;
  selectedTowerProp?: string;
  showLabels?: boolean;
  forcedReach?: number;
  resolution?: number;
}

const LobeLabel = styled.div`
  background: rgba(0, 0, 0, 0.7);
  color: #ac77ff;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #ac77ff;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const finiteNumberOr = (value: unknown, fallback: number) => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};
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
  wavelength: number,
  apertureWidth: number,
  apertureHeight: number,
  powerDensityThreshold: number,
) => {
  const peakGain =
    (4 * Math.PI * apertureWidth * apertureHeight) / (wavelength * wavelength);
  return Math.sqrt(
    (powerWatts * peakGain) / (4 * Math.PI * powerDensityThreshold),
  );
};

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
    horizontalElements: 1,
    verticalElements: 1,
    frontExponent: 0,
    backFloor: 1.0,
    sideLobeFloor: 1.0,
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
  useLevaControls = true,
  selectedTowerProp = "sector",
  showLabels = true,
  forcedReach,
  resolution,
}) => {
  const hiddenStore = useCreateStore();
  const storeToUse = useLevaControls ? undefined : hiddenStore;

  const levaValues = useControls(
    "Radiation Lobe Setup",
    {
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
        powerLevelDbm: {
          label: "Power Level",
          value: 43,
          min: -70,
          max: 64,
          step: 1,
          suffix: "dBm",
        },
        apertureWidthM: {
          label: "Aperture Width",
          value: 0.65,
          min: 0.1,
          max: 5.0,
          suffix: "m",
        },
        apertureHeightM: {
          label: "Aperture Height",
          value: 1.56,
          min: 0.1,
          max: 5.0,
          suffix: "m",
        },
      }),
      Visibility: folder({
        showMultipath: { label: "Ray Paths", value: true },
        showScattering: { label: "Scattering", value: true },
        showFarField: { label: "Far Field Mesh", value: true },
        secondaryStrength: {
          label: "Secondary Strength",
          value: 0.32,
          min: 0,
          max: 1,
          step: 0.01,
        },
        showLabels: { label: "Labels", value: true },
      }),
      Reference: folder({
        scale: levaGainScale(),
      }),
    },
    { store: storeToUse },
  );

  const selectedTower = resolveTowerType(
    useLevaControls ? levaValues.selectedTower : selectedTowerProp,
  );
  const frequencyHz = useLevaControls
    ? levaValues.frequencyMHz
    : frequency * 1e6;
  const powerLevelDbm = useLevaControls ? levaValues.powerLevelDbm : powerDbm;
  const apertureWidthM = useLevaControls
    ? levaValues.apertureWidthM
    : apertureWidth || aperture;
  const apertureHeightM = useLevaControls
    ? levaValues.apertureHeightM
    : apertureHeight || aperture;
  const showMultipath = useLevaControls
    ? levaValues.showMultipath
    : showMultipathRays;
  const showScattering = useLevaControls
    ? levaValues.showScattering
    : showScatteringCloud;
  const secondaryStrength = useLevaControls
    ? levaValues.secondaryStrength
    : multipathStrength;
  const showFarField = useLevaControls
    ? levaValues.showFarField
    : showNearFarField;
  const showLabelsActive = useLevaControls ? levaValues.showLabels : showLabels;

  const towerConfig = TOWER_CONFIGS[selectedTower as TowerType];
  const towerPreset = TOWER_RADIATION_PRESETS[selectedTower as TowerType];
  const originHeight =
    selectedTower === "none" ? height : towerConfig.antennaOrigin[1];

  const panelLabels = React.useMemo(() => {
    if (towerConfig.id === "sector") return ["Left", "Center", "Right"];
    if (towerConfig.id === "hexagonal")
      return ["North", "NW", "NE", "South", "SW", "SE"];
    return Array(towerConfig.emitterFaces.length)
      .fill(0)
      .map((_, i) => `Panel ${i + 1}`);
  }, [towerConfig.id, towerConfig.emitterFaces.length]);

  const [{ activePanels }] = useControls(
    "Radiation Lobe Setup",
    () => ({
      "Cell Tower / Site": folder({
        activePanels: {
          ...levaPanelSelector({
            count: towerConfig.emitterFaces.length,
            labels: panelLabels,
            initialValue:
              towerConfig.id === "sector"
                ? [false, true, false]
                : towerConfig.id === "hexagonal"
                  ? [true, false, false, false, false, false]
                  : Array(towerConfig.emitterFaces.length).fill(true),
          }),
          render: () =>
            towerConfig.emitterFaces.length > 1 ||
            towerConfig.id === "hexagonal",
        },
      }),
    }),
    { store: storeToUse },
    [selectedTower, towerConfig.emitterFaces.length],
  );

  const c = 299_792_458;
  const safeFrequencyHz = clamp(
    finiteNumberOr(frequencyHz, 1.8e9),
    1_000,
    100_000_000_000,
  );
  const safeFrequencyMHz = safeFrequencyHz / 1e6;
  const safePowerDbm = clamp(finiteNumberOr(powerLevelDbm, 43), -70, 64);
  const effectiveApertureWidth = Math.max(
    0.1,
    finiteNumberOr(apertureWidthM, aperture),
  );
  const effectiveApertureHeight = Math.max(
    0.2,
    finiteNumberOr(apertureHeightM, aperture),
  );
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
  const [mainLobeGroundReach, setMainLobeGroundReach] = useState<number>(() => {
    return (
      forcedReach ??
      calculateRadiationLobeReachJS(
        safeFrequencyHz,
        safePowerDbm,
        effectiveApertureWidth,
        effectiveApertureHeight,
      )
    );
  });

  useEffect(() => {
    let active = true;
    if (forcedReach !== undefined) {
      setMainLobeGroundReach(forcedReach);
      return;
    }

    calculateRadiationLobeReach(
      safeFrequencyHz,
      safePowerDbm,
      effectiveApertureWidth,
      effectiveApertureHeight,
    ).then((val) => {
      if (active) {
        setMainLobeGroundReach(val);
      }
    });

    return () => {
      active = false;
    };
  }, [
    forcedReach,
    safeFrequencyHz,
    safePowerDbm,
    effectiveApertureWidth,
    effectiveApertureHeight,
  ]);

  const gridSpan = Math.max(
    60,
    Math.ceil((mainLobeGroundReach * 2.8) / 10) * 10,
    Math.ceil((farFieldDistance * 2.2) / 10) * 10,
  );
  const gridDivisions = Math.max(40, Math.ceil(gridSpan / 2));
  const safeSecondaryStrength = clamp(secondaryStrength, 0, 1);
  const geometryResolution = clamp(
    Math.round(finiteNumberOr(resolution, useLevaControls ? 72 : 40)),
    24,
    96,
  );
  const scatteringResolution = clamp(
    Math.round(geometryResolution * 0.45),
    16,
    42,
  );

  const geometry = useMemo(() => {
    const size = geometryResolution;
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
        const verticalAngle = Math.asin(dirZ);
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
        let intensity: number;

        if (selectedTower === "none") {
          intensity = 1 - dirZ * dirZ;
        } else {
          const frontWeight =
            dirX > 0
              ? Math.pow(clamp(dirX, 0, 1), towerPreset.frontExponent)
              : towerPreset.backFloor;
          intensity = clamp(
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
        }

        if (showGroundInterference) {
          const phase = k * 2 * originHeight * Math.sin(phi);
          const groundFactor = Math.sqrt(2 * (1 + Math.cos(phase)));
          intensity *= groundFactor / 2;
        }

        // Apply a gamma curve to map the linear voltage to a more traditional dB-like bulbous shape
        const shapeGamma = 0.45;
        const visualIntensity = Math.pow(intensity, shapeGamma);
        const boundedRange = mainLobeGroundReach * visualIntensity;
        const x = boundedRange * Math.cos(phi) * Math.cos(theta);
        const y = boundedRange * Math.cos(phi) * Math.sin(theta);
        const z = boundedRange * Math.sin(phi);

        // Heatmap colors
        const heat = Math.pow(intensity, 0.5);

        vertices.push(x, z, -y);
        colors.push(0.3 + heat * 0.6, 0.1 + heat * 0.3, 0.6 + heat * 0.4);
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
    geometryResolution,
    horizontalSpacing,
    horizontalTaper,
    k,
    originHeight,
    powerWatts,
    selectedTower,
    showGroundInterference,
    towerPreset.backFloor,
    towerPreset.frontExponent,
    towerPreset.horizontalElements,
    towerPreset.sideLobeFloor,
    towerPreset.verticalElements,
    verticalSpacing,
    verticalTaper,
    mainLobeGroundReach,
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
    const size = scatteringResolution;
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
  }, [
    mainLobeGroundReach,
    safeSecondaryStrength,
    scatteringResolution,
    wavelength,
  ]);

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
        {showLabelsActive && (
          <>
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
          </>
        )}

        {showLabels && (
          <Html position={distanceMarkerPosition} center zIndexRange={[100, 0]}>
            <LobeLabel style={{ borderColor: "#ffd166", color: "#ffd166" }}>
              Ground Reach {mainLobeGroundReach.toFixed(1)}m
            </LobeLabel>
          </Html>
        )}

        {showLabels && (
          <Html
            position={distanceEndLabelPosition}
            center
            zIndexRange={[100, 0]}
          >
            <LobeLabel
              style={{
                borderColor: "#ffd166",
                color: "#ffd166",
                opacity: 0.85,
              }}
            >
              {mainLobeGroundReach.toFixed(1)}m
            </LobeLabel>
          </Html>
        )}
      </group>

      {(() => {
        const firstActiveIndex = towerConfig.emitterFaces.findIndex(
          (_, index) => {
            if (towerConfig.emitterFaces.length === 1) return true;
            if (Array.isArray(activePanels)) return activePanels[index] ?? true;
            return true;
          },
        );

        return towerConfig.emitterFaces.map((facePos, index) => {
          const originY = facePos[1] - originHeight;
          const isPanelActive =
            towerConfig.emitterFaces.length === 1
              ? true
              : Array.isArray(activePanels)
                ? (activePanels[index] ?? true)
                : true;

          if (!isPanelActive) return null;

          let customRotation = towerConfig.antennaRotation;
          if (towerConfig.id === "hexagonal") {
            const hexRotations = [
              0, // North
              Math.PI / 3, // NW
              -Math.PI / 3, // NE
              Math.PI, // South
              (2 * Math.PI) / 3, // SW
              (-2 * Math.PI) / 3, // SE
            ];
            customRotation = [
              towerConfig.antennaRotation[0],
              towerConfig.antennaRotation[1] + hexRotations[index],
              towerConfig.antennaRotation[2],
            ] as [number, number, number];
          }

          return (
            <group
              key={index}
              position={[facePos[0], originY, facePos[2]]}
              rotation={customRotation}
            >
              {/* Antenna Marker */}
              {showLabelsActive && (
                <mesh>
                  <sphereGeometry args={[0.1, 16, 16]} />
                  <meshBasicMaterial color="#ac77ff" />
                  {index === firstActiveIndex && (
                    <Html position={[0, 0.2, 0]} center zIndexRange={[100, 0]}>
                      <LobeLabel>Panel/Antenna</LobeLabel>
                    </Html>
                  )}
                </mesh>
              )}

              {/* Radiation Lobe Surface (Glassy Volume) */}
              <mesh geometry={geometry}>
                <meshStandardMaterial
                  vertexColors
                  transparent
                  opacity={0.58}
                  side={THREE.DoubleSide}
                  roughness={0.35}
                  metalness={0}
                  emissive="#3a1160"
                  emissiveIntensity={0.08}
                  depthWrite={false}
                />
              </mesh>

              {/* Secondary Lobe / Scattering Cloud */}
              {showScattering && (
                <mesh geometry={scatteringGeometry}>
                  <meshBasicMaterial
                    vertexColors
                    transparent
                    opacity={0.15 + safeSecondaryStrength * 0.15}
                    side={THREE.DoubleSide}
                    blending={THREE.AdditiveBlending}
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
              {showNearFarField &&
                showFarField &&
                index === firstActiveIndex && (
                  <Sphere args={[farFieldVisualRadius, 32, 32]} renderOrder={2}>
                    <meshBasicMaterial
                      color="#ac77ff"
                      transparent
                      opacity={0.35}
                      wireframe
                      depthWrite={false}
                      depthTest={false}
                      side={THREE.DoubleSide}
                    />
                    {showLabelsActive && (
                      <Html
                        position={[0, farFieldVisualRadius, 0]}
                        center
                        zIndexRange={[100, 0]}
                      >
                        <LobeLabel
                          style={{ borderColor: "#aaa", color: "#aaa" }}
                        >
                          Far-Field Boundary ({farFieldDistance.toFixed(3)}m)
                        </LobeLabel>
                      </Html>
                    )}
                  </Sphere>
                )}

              {/* Lobe Labels */}
              {showLabelsActive && index === firstActiveIndex && (
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
        });
      })()}
    </>
  );
};
