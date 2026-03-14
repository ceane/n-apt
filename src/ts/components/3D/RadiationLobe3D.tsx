import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html, Sphere } from '@react-three/drei';
import styled from 'styled-components';
import {
  TOWER_CONFIGS,
  TowerType,
  SectorTower,
  DiamondCell,
  PoleMountedSmallCell,
  HexagonalSmallCell,
  SinglePanelSmallCell
} from './CellTowers';

interface RadiationLobe3DProps {
  frequency?: number;      // MHz
  aperture?: number;       // m (D)
  powerDbm?: number;
  apertureWidth?: number;
  apertureHeight?: number;
  height?: number;         // m (h)
  n?: number;             // horizontal beam shaping
  m?: number;             // vertical beam shaping
  showNearFarField?: boolean;
  showGroundInterference?: boolean;
}

const LobeLabel = styled.div`
  background: rgba(0, 0, 0, 0.7);
  color: #ac77ff;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #ac77ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
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
  font-family: 'Inter', sans-serif;
  width: 200px;
`;

const TowerSelect = styled.select`
  background: #111;
  color: #eee;
  border: 1px solid #333;
  padding: 6px;
  border-radius: 4px;
  outline: none;
  font-family: 'Inter', sans-serif;
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
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  width: 84px;
  text-align: right;

  &:focus {
    border-color: #ac77ff;
  }
`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sinc = (value: number) => (Math.abs(value) < 1e-6 ? 1 : Math.sin(value) / value);
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

const TOWER_RADIATION_PRESETS: Record<TowerType, {
  horizontalElements: number;
  verticalElements: number;
  frontExponent: number;
  backFloor: number;
  sideLobeFloor: number;
}> = {
  none: { horizontalElements: 6, verticalElements: 10, frontExponent: 1.5, backFloor: 0.03, sideLobeFloor: 0.02 },
  sector: { horizontalElements: 8, verticalElements: 12, frontExponent: 2.4, backFloor: 0.02, sideLobeFloor: 0.03 },
  diamond: { horizontalElements: 4, verticalElements: 4, frontExponent: 2.1, backFloor: 0.03, sideLobeFloor: 0.025 },
  pole_small: { horizontalElements: 3, verticalElements: 6, frontExponent: 1.2, backFloor: 0.12, sideLobeFloor: 0.04 },
  hexagonal: { horizontalElements: 6, verticalElements: 8, frontExponent: 1.35, backFloor: 0.1, sideLobeFloor: 0.05 },
  single_panel: { horizontalElements: 5, verticalElements: 8, frontExponent: 2, backFloor: 0.025, sideLobeFloor: 0.03 },
};

export const RadiationLobe3D: React.FC<RadiationLobe3DProps> = ({
  frequency = 1800,
  aperture = 0.65,
  powerDbm = 43,
  apertureWidth,
  apertureHeight,
  height = 5,
  n = 6,
  m = 20,
  showNearFarField = true,
  showGroundInterference = true,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [selectedTower, setSelectedTower] = useState<TowerType>('none');
  const [frequencyMHz, setFrequencyMHz] = useState(frequency);
  const [powerLevelDbm, setPowerLevelDbm] = useState(powerDbm);
  const [apertureWidthM, setApertureWidthM] = useState(apertureWidth ?? aperture);
  const [apertureHeightM, setApertureHeightM] = useState(apertureHeight ?? Math.max(aperture * 2.4, 0.8));

  const towerConfig = TOWER_CONFIGS[selectedTower];
  const towerPreset = TOWER_RADIATION_PRESETS[selectedTower];
  const originHeight = selectedTower === 'none' ? height : towerConfig.antennaOrigin[1];

  useEffect(() => {
    setFrequencyMHz(frequency);
  }, [frequency]);

  useEffect(() => {
    setPowerLevelDbm(powerDbm);
  }, [powerDbm]);

  useEffect(() => {
    setApertureWidthM(apertureWidth ?? aperture);
  }, [apertureWidth, aperture]);

  useEffect(() => {
    setApertureHeightM(apertureHeight ?? Math.max(aperture * 2.4, 0.8));
  }, [apertureHeight, aperture]);

  const c = 3e8;
  const safeFrequencyMHz = clamp(frequencyMHz, 1, 6000);
  const safePowerDbm = clamp(powerLevelDbm, -20, 60);
  const effectiveApertureWidth = Math.max(0.1, apertureWidthM);
  const effectiveApertureHeight = Math.max(0.2, apertureHeightM);
  const wavelength = c / (safeFrequencyMHz * 1e6);
  const powerWatts = dbmToWatts(safePowerDbm);
  const k = (2 * Math.PI) / wavelength;
  const effectiveDiameter = Math.max(effectiveApertureWidth, effectiveApertureHeight);
  const farFieldDistance = (2 * Math.pow(effectiveDiameter, 2)) / wavelength;
  const hpbwHorizontal = clamp((0.886 * wavelength / effectiveApertureWidth) * (180 / Math.PI), 2, 180);
  const hpbwVertical = clamp((0.886 * wavelength / effectiveApertureHeight) * (180 / Math.PI), 2, 180);
  const horizontalSpacing = effectiveApertureWidth / Math.max(1, towerPreset.horizontalElements - 1);
  const verticalSpacing = effectiveApertureHeight / Math.max(1, towerPreset.verticalElements - 1);
  const horizontalTaper = clamp(n / 6, 0.6, 3);
  const verticalTaper = clamp(m / 20, 0.6, 3.5);
  const visualScale = clamp(Math.sqrt(powerWatts) * 1.6 + 3, 3, 12);

  const geometry = useMemo(() => {
    const size = 72;
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const visibilityThreshold = 0.008;

    for (let j = 0; j <= size; j++) {
      const phi = (j / size) * Math.PI - Math.PI / 2;
      for (let i = 0; i <= size; i++) {
        const theta = (i / size) * Math.PI * 2;
        const dirX = Math.cos(phi) * Math.cos(theta);
        const dirY = Math.cos(phi) * Math.sin(theta);
        const dirZ = Math.sin(phi);
        const horizontalAngle = Math.atan2(dirY, dirX);
        const verticalAngle = Math.atan2(dirZ, dirX);
        const apertureFactorH = Math.abs(sinc((k * effectiveApertureWidth * Math.sin(horizontalAngle)) / 2));
        const apertureFactorV = Math.abs(sinc((k * effectiveApertureHeight * Math.sin(verticalAngle)) / 2));
        const arrayFactorH = normalizedArrayFactor(towerPreset.horizontalElements, k * horizontalSpacing * Math.sin(horizontalAngle));
        const arrayFactorV = normalizedArrayFactor(towerPreset.verticalElements, k * verticalSpacing * Math.sin(verticalAngle));
        const apertureEnvelope = Math.pow(apertureFactorH, 0.8 * horizontalTaper) * Math.pow(apertureFactorV, 0.8 * verticalTaper);
        const arrayEnvelope = Math.pow(arrayFactorH, 0.75) * Math.pow(arrayFactorV, 0.75);
        const frontWeight = dirX > 0 ? Math.pow(clamp(dirX, 0, 1), towerPreset.frontExponent) : towerPreset.backFloor;
        let intensity = clamp(apertureEnvelope * arrayEnvelope * frontWeight, 0, 1);

        if (dirX > 0) {
          intensity = Math.max(intensity, towerPreset.sideLobeFloor * arrayEnvelope * Math.pow(Math.max(apertureEnvelope, 0), 0.35));
        } else {
          intensity = Math.max(intensity, towerPreset.backFloor * 0.7);
        }

        if (showGroundInterference) {
          const phase = k * 2 * originHeight * Math.sin(phi);
          const groundFactor = Math.sqrt(2 * (1 + Math.cos(phase)));
          intensity *= (groundFactor / 2);
        }

        const range = Math.sqrt((powerWatts * Math.max(intensity, 1e-5)) / (4 * Math.PI * visibilityThreshold));
        const boundedRange = Math.min(24, range * 1.35);
        const x = boundedRange * Math.cos(phi) * Math.cos(theta);
        const y = boundedRange * Math.cos(phi) * Math.sin(theta);
        const z = boundedRange * Math.sin(phi);
        const heat = clamp((Math.log10(1 + powerWatts * intensity * 16) + 0.15) / 1.6, 0, 1);

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
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
    verticalTaper
  ]);

  const farFieldVisualRadius = clamp(farFieldDistance, 0.25, 25);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
      <directionalLight position={[-10, 5, -10]} intensity={0.5} />
      <pointLight position={[0, originHeight + 5, 0]} intensity={0.8} color="#ac77ff" distance={15} />

      {/* Static HUD Overlay (Gain Scale + Tower Selector) */}
      <Html fullscreen zIndexRange={[100, 0]}>
        <div style={{ position: 'absolute', top: '20px', right: '20px', pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'flex-end' }}>

          {/* Gain Scale HUD */}
          <div style={{ pointerEvents: 'auto', background: 'rgba(0,0,0,0.8)', padding: '12px', borderRadius: '8px', border: '1px solid #444', width: '100px' }}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px', fontWeight: 600, textAlign: 'center' }}>GAIN SCALE</div>
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
              <div style={{ height: '120px', width: '12px', background: 'linear-gradient(to top, #7f00ff, #00ff00, #ff0000)', borderRadius: '2px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '120px', fontSize: '10px', color: '#ccc' }}>
                <span>1.0</span>
                <span>0.5</span>
                <span>0.0</span>
              </div>
            </div>
          </div>

          {/* Tower Selection HUD */}
          <ControlPanel style={{ pointerEvents: 'auto', width: '200px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#aaa', marginBottom: '4px' }}>
              CELL TOWER / SITE
            </div>
            <TowerSelect
              value={selectedTower}
              onChange={(e) => setSelectedTower(e.target.value as TowerType)}
            >
              {Object.values(TOWER_CONFIGS).map(cfg => (
                <option key={cfg.id} value={cfg.id}>{cfg.name}</option>
              ))}
            </TowerSelect>
          </ControlPanel>

          <ControlPanel style={{ pointerEvents: 'auto', width: '220px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center', fontSize: '11px' }}>
              <span style={{ color: '#aaa' }}>Frequency (MHz)</span>
              <NumberInput
                type="number"
                min={1}
                max={6000}
                step={1}
                value={frequencyMHz}
                onChange={(e) => setFrequencyMHz(Number(e.target.value))}
              />
              <span style={{ color: '#aaa' }}>Power (dBm)</span>
              <NumberInput
                type="number"
                min={-20}
                max={60}
                step={1}
                value={powerLevelDbm}
                onChange={(e) => setPowerLevelDbm(Number(e.target.value))}
              />
              <span style={{ color: '#aaa' }}>Aperture W (m)</span>
              <NumberInput
                type="number"
                min={0.1}
                max={5}
                step={0.05}
                value={apertureWidthM}
                onChange={(e) => setApertureWidthM(Number(e.target.value))}
              />
              <span style={{ color: '#aaa' }}>Aperture H (m)</span>
              <NumberInput
                type="number"
                min={0.2}
                max={8}
                step={0.05}
                value={apertureHeightM}
                onChange={(e) => setApertureHeightM(Number(e.target.value))}
              />
            </div>
            <div style={{ fontSize: '10px', color: '#8f8f8f', lineHeight: 1.5 }}>
              <div>λ {wavelength.toFixed(3)} m</div>
              <div>{powerWatts.toFixed(2)} W</div>
              <div>HPBW H {hpbwHorizontal.toFixed(1)}°</div>
              <div>HPBW V {hpbwVertical.toFixed(1)}°</div>
            </div>
          </ControlPanel>
        </div>
      </Html>

      {selectedTower === 'sector' && <SectorTower position={[0, -originHeight, 0]} />}
      {selectedTower === 'diamond' && <DiamondCell position={[0, -originHeight, 0]} />}
      {selectedTower === 'pole_small' && <PoleMountedSmallCell position={[0, -originHeight, 0]} />}
      {selectedTower === 'hexagonal' && <HexagonalSmallCell position={[0, -originHeight, 0]} />}
      {selectedTower === 'single_panel' && <SinglePanelSmallCell position={[0, -originHeight, 0]} />}

      <group position={[0, 0, 0]} rotation={towerConfig.antennaRotation}>
        {/* Antenna Marker */}
        <mesh>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshBasicMaterial color="#ac77ff" />
          <Html position={[0, 0.2, 0]} center>
            <LobeLabel>Antenna (h={originHeight.toFixed(1)}m)</LobeLabel>
          </Html>
        </mesh>

        {/* Radiation Lobe Surface */}
        <mesh geometry={geometry} ref={meshRef}>
          <meshStandardMaterial vertexColors transparent opacity={0.75} side={THREE.DoubleSide} />
        </mesh>

        {/* Near-Field / Far-Field Boundary */}
        {showNearFarField && (
          <Sphere args={[farFieldVisualRadius, 32, 32]}>
            <meshBasicMaterial color="#ffffff" transparent opacity={0.05} wireframe />
            <Html position={[0, farFieldVisualRadius, 0]} center>
              <LobeLabel style={{ borderColor: '#aaa', color: '#aaa' }}>
                Far-Field Boundary ({farFieldDistance.toFixed(3)}m)
              </LobeLabel>
            </Html>
          </Sphere>
        )}

        {/* Lobe Labels */}
        <Html position={[visualScale * 1.1, 0, 0]} center>
          <LobeLabel>Main Lobe (HPBW: H:{hpbwHorizontal.toFixed(1)}° V:{hpbwVertical.toFixed(1)}°)</LobeLabel>
        </Html>

        <Html position={[visualScale * 0.4, visualScale * 0.3, visualScale * 0.4]} center>
          <LobeLabel style={{ opacity: 0.7, fontSize: '8px' }}>Side Lobe</LobeLabel>
        </Html>

        <Html position={[visualScale * 0.4, -visualScale * 0.3, -visualScale * 0.4]} center>
          <LobeLabel style={{ opacity: 0.7, fontSize: '8px' }}>Minor Lobe</LobeLabel>
        </Html>

        {/* Back Lobe detection area */}
        <Html position={[-visualScale * 0.3, 0, 0]} center>
          <LobeLabel style={{ opacity: 0.6 }}>Back Lobe</LobeLabel>
        </Html>

        {/* Ground Plane reference at y=0, relative to the shifted group */}
        <gridHelper args={[60, 60, 0x444444, 0x222222]} position={[0, -originHeight, 0]} />
      </group>
    </>
  );
};
