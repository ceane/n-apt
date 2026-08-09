import React, { useState, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import { OrbitControls, Text, Line } from "@react-three/drei";
import { levaFrequency } from "@n-apt/ui/levaFrequencyPlugin";
import {
  calculateRoomReach,
  calculateRoomReachJS,
  calculateRoomPowerLimit,
  calculateRoomPowerLimitJS,
} from "@n-apt/app/infrastructure/services/safetyWasm";
import { HackRFOne } from "@n-apt/three-d/SDRs";

export function AnimatedRadioWaves({
  speed = 1.5,
  reach = 5.3,
  displayRings = 3,
}: {
  speed?: number;
  reach?: number;
  displayRings?: number;
}) {
  const wavesRef = React.useRef<any>(null);

  useFrame(({ clock }) => {
    if (!wavesRef.current) return;
    const t = clock.getElapsedTime() * speed;
    wavesRef.current.children.forEach((mesh: any, i: number) => {
      const progress = (t + i / displayRings) % 1; // 0 to 1
      mesh.scale.setScalar(progress * reach + 0.1);
      mesh.material.opacity = (1 - Math.pow(progress, 2)) * 0.4;
    });
  });

  return (
    <group position={[-0.75, 1, 0.5]}>
      <group ref={wavesRef}>
        {Array.from({ length: displayRings }).map((_, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1, 0.05, 16, 64]} />
            <meshBasicMaterial
              color="#ac77ff"
              transparent
              opacity={0}
              depthWrite={false}
              side={2}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function ProjectedLine({ points }: { points: [number, number, number][] }) {
  return (
    <>
      <Line
        points={points}
        color="#dff6ff"
        lineWidth={13}
        transparent
        opacity={0.22}
        depthTest
      />
      <Line
        points={points}
        color="white"
        lineWidth={4}
        transparent
        opacity={0.96}
        depthTest
      />
    </>
  );
}

function RoomDipoleLobe({ reach }: { reach: number }) {
  const geometry = React.useMemo(() => {
    const rows = 20;
    const columns = 40;
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let row = 0; row <= rows; row++) {
      const elevation = (row / rows) * Math.PI - Math.PI / 2;
      const vertical = Math.sin(elevation);
      const horizontal = Math.cos(elevation);
      const intensity = horizontal * horizontal;
      const radius = Math.max(0.02, reach * Math.pow(intensity, 0.55));

      for (let column = 0; column <= columns; column++) {
        const azimuth = (column / columns) * Math.PI * 2;
        const x = radius * horizontal * Math.cos(azimuth);
        const y = radius * vertical;
        const z = radius * horizontal * Math.sin(azimuth);
        const heat = Math.pow(intensity, 0.45);

        vertices.push(x, y, z);
        colors.push(0.45 + heat * 0.35, 0.18 + heat * 0.15, 0.75 + heat * 0.2);
      }
    }

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const current = row * (columns + 1) + column;
        const next = current + columns + 1;
        indices.push(current, current + 1, next);
        indices.push(current + 1, next + 1, next);
      }
    }

    const lobeGeometry = new THREE.BufferGeometry();
    lobeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    lobeGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    lobeGeometry.setIndex(indices);
    lobeGeometry.computeVertexNormals();
    return lobeGeometry;
  }, [reach]);

  React.useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.32}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function DistanceMarker({ reach }: { reach: number }) {
  const tableEdge = 1.0; // Antenna Z=0.5 to the table edge at Z=1.5 in marker direction.
  const tableY = -0.085; // Slightly above the table surface to avoid z-fighting.
  const tableLipBottomY = -0.305; // Bottom of the tabletop edge relative to the transmitter.
  const floorY = -2.185; // Slightly above the room floor relative to the transmitter.
  const projectionGap = 0.025;
  const capDepth = 0.45;
  const floorStart = tableEdge + projectionGap;
  const tableLineEnd = Math.min(reach, Math.max(0, tableEdge - projectionGap));
  const labelMaxX = 4.75;
  const labelFontSize = Math.max(0.22, 0.36 - Math.max(0, reach - 4) * 0.015);
  const useEndLabel = reach < 3;
  const labelRotation = useEndLabel
    ? [0, Math.PI / 2, 0]
    : [-Math.PI / 2, 0, 0];
  const labelX =
    reach > tableEdge
      ? Math.min(floorStart + (reach - floorStart) / 2, labelMaxX)
      : Math.min(reach / 2, labelMaxX);
  const labelY = reach > tableEdge ? floorY + 0.035 : tableY + 0.035;
  const labelClearance = Math.max(1.1, labelFontSize * 3.2);
  const leftFloorEnd = Math.max(floorStart, labelX - labelClearance);
  const rightFloorStart = Math.min(reach, labelX + labelClearance);
  const endLabelY = 0.24;

  return (
    <group position={[-0.75, 0, 0.5]} rotation={[0, -Math.PI / 2, 0]}>
      {tableLineEnd > 0 && (
        <ProjectedLine
          points={[
            [0, tableY, 0],
            [tableLineEnd, tableY, 0],
          ]}
        />
      )}

      {reach > tableEdge && (
        <>
          <ProjectedLine
            points={[
              [tableEdge, tableY, 0],
              [tableEdge, tableLipBottomY, 0],
            ]}
          />
          {leftFloorEnd > floorStart && (
            <ProjectedLine
              points={[
                [floorStart, floorY, 0],
                [leftFloorEnd, floorY, 0],
              ]}
            />
          )}
          {reach > rightFloorStart && (
            <ProjectedLine
              points={[
                [rightFloorStart, floorY, 0],
                [reach, floorY, 0],
              ]}
            />
          )}
          <ProjectedLine
            points={[
              [reach, floorY, -capDepth / 2],
              [reach, floorY, capDepth / 2],
            ]}
          />
        </>
      )}

      {reach <= tableEdge && (
        <ProjectedLine
          points={[
            [reach, tableY, -capDepth / 2],
            [reach, tableY, capDepth / 2],
          ]}
        />
      )}

      {useEndLabel ? (
        <>
          <Text
            position={[reach + 0.22, endLabelY + 0.015, 0]}
            rotation={labelRotation as [number, number, number]}
            fontSize={labelFontSize * 1.08}
            color="#dff6ff"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
            outlineWidth={0.02}
            outlineColor="#f4fcff"
            font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf"
            renderOrder={11}
          >
            {reach.toFixed(1)}m reach
            <meshBasicMaterial
              attach="material"
              color="#dff6ff"
              transparent
              opacity={0.16}
              depthWrite={false}
              depthTest
            />
          </Text>
          <Text
            position={[reach + 0.2, endLabelY, 0]}
            rotation={labelRotation as [number, number, number]}
            fontSize={Math.max(0.18, labelFontSize * 0.86)}
            color="white"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
            outlineWidth={0.01}
            outlineColor="#ffffff"
            font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf"
            renderOrder={12}
          >
            {reach.toFixed(1)}m reach
            <meshBasicMaterial
              attach="material"
              color="white"
              transparent
              opacity={0.82}
              depthWrite={false}
              depthTest
            />
          </Text>
        </>
      ) : (
        <>
          <Text
            position={[labelX, labelY + 0.006, 0]}
            rotation={labelRotation as [number, number, number]}
            fontSize={labelFontSize * 1.03}
            color="#dff6ff"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
            outlineWidth={0.018}
            outlineColor="#f4fcff"
            font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf"
            renderOrder={11}
          >
            {reach.toFixed(1)}m reach
            <meshBasicMaterial
              attach="material"
              color="#dff6ff"
              transparent
              opacity={0.18}
              depthWrite={false}
              depthTest
            />
          </Text>
          <Text
            position={[labelX, labelY - 0.002, 0]}
            rotation={labelRotation as [number, number, number]}
            fontSize={Math.max(0.18, labelFontSize * 0.82)}
            color="white"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
            outlineWidth={0.01}
            outlineColor="#ffffff"
            font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf"
            renderOrder={12}
          >
            {reach.toFixed(1)}m reach
            <meshBasicMaterial
              attach="material"
              color="white"
              transparent
              opacity={0.86}
              depthWrite={false}
              depthTest
            />
          </Text>
        </>
      )}
    </group>
  );
}

export function RoomTxScene() {
  const [
    {
      emissionRealism,
      power,
      frequency: frequencyHz,
      animationSpeed,
      calcEnabled,
      calcDistance,
    },
    setLeva,
  ] = useControls("Room TX Setup", () => ({
    emissionRealism: {
      options: { None: "none", "Dipole Lobe": "dipole_lobe" },
    },
    power: { value: 15, min: -70, max: 60, suffix: "dBm" },
    frequency: levaFrequency(1500000000),
    animationSpeed: { value: 1.5, min: 0.1, max: 5 },
    "Distance + Power Calculator": folder({
      calcEnabled: { value: false, label: "Enable Lock" },
      calcDistance: {
        value: 5.0,
        min: 0.1,
        max: 50,
        step: 0.1,
        label: "Max Distance (m)",
        render: (get) =>
          get("Room TX Setup.Distance + Power Calculator.calcEnabled"),
      },
    }),
  }));

  const parsedFreq = parseFloat(String(frequencyHz));
  const frequencyHzSafe = Number.isFinite(parsedFreq) ? parsedFreq : 1.5e9;

  const parsedPower = parseFloat(String(power));
  let safePower = Number.isFinite(parsedPower) ? parsedPower : -70;

  const wavelength = 299_792_458 / frequencyHzSafe;
  const receiverSensitivityWatts = 4.6e-7;
  const transmitterGain = 1.64; // half-wave dipole, 2.15 dBi
  const receiverGain = 1;

  if (calcEnabled) {
    const requiredPowerDbm = calculateRoomPowerLimitJS(
      frequencyHzSafe,
      calcDistance,
    );
    if (Number.isFinite(requiredPowerDbm)) {
      safePower = requiredPowerDbm;
    }
  }

  useEffect(() => {
    if (calcEnabled) {
      let active = true;
      calculateRoomPowerLimit(frequencyHzSafe, calcDistance).then((val) => {
        if (active && Number.isFinite(val)) {
          // Format to 2 decimals to prevent noisy looping
          setLeva({ power: Number(val.toFixed(2)) });
        }
      });
      return () => {
        active = false;
      };
    }
  }, [calcEnabled, calcDistance, frequencyHzSafe, setLeva]);

  const [reach, setReach] = useState<number>(() => {
    return calculateRoomReachJS(frequencyHzSafe, safePower);
  });

  useEffect(() => {
    let active = true;
    calculateRoomReach(frequencyHzSafe, safePower).then((val) => {
      if (active) {
        setReach(val);
      }
    });
    return () => {
      active = false;
    };
  }, [frequencyHzSafe, safePower]);
  const numRings = Math.max(1, Math.floor(reach / wavelength));
  const displayRings = Math.min(8, numRings);

  const lobeGroupRef = React.useRef<any>(null);
  useFrame(({ clock }) => {
    if (lobeGroupRef.current) {
      const t = clock.getElapsedTime() * animationSpeed;
      const progress = (t * 0.5) % 1;
      lobeGroupRef.current.scale.setScalar(progress * 0.9 + 0.1);

      lobeGroupRef.current.traverse((child: any) => {
        if (child.isMesh && child.material && child.material.transparent) {
          const fade = 1 - Math.pow(progress, 2);
          child.material.opacity = 0.65 * fade;
        }
      });
    }
  });

  return (
    <>
      <ambientLight intensity={0.1} />
      <pointLight
        position={[0, 4, -8]}
        intensity={10}
        color="#ffffff"
        distance={20}
        decay={1.5}
      />
      <directionalLight position={[0, 4, -8]} intensity={2} color="#ffffff" />

      <group position={[0, -2, 0]}>
        {/* Floor */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#2a221b" roughness={0.8} />
        </mesh>

        {/* Back Wall */}
        <mesh position={[0, 5, -10]} receiveShadow>
          <planeGeometry args={[20, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.9} />
        </mesh>

        {/* Side Walls */}
        <mesh
          position={[-10, 5, 0]}
          rotation={[0, Math.PI / 2, 0]}
          receiveShadow
        >
          <planeGeometry args={[20, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.9} />
        </mesh>
        <mesh
          position={[10, 5, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          receiveShadow
        >
          <planeGeometry args={[20, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.9} />
        </mesh>

        {/* Ceiling */}
        <mesh
          position={[0, 10, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          receiveShadow
        >
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
            <HackRFOne />
            <DistanceMarker reach={reach} />
            {emissionRealism === "none" && (
              <AnimatedRadioWaves
                speed={animationSpeed}
                reach={reach}
                displayRings={displayRings}
              />
            )}
            {emissionRealism === "dipole_lobe" && (
              <group position={[-0.75, 1, 0.5]}>
                <group ref={lobeGroupRef}>
                  <RoomDipoleLobe reach={reach} />
                </group>
              </group>
            )}
            {/* Red Knobs/Connectors */}
            <mesh position={[0.8, 0, -0.4]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[0.08, 0.08, 0.1]} />
              <meshStandardMaterial color="#dd0000" />
            </mesh>
            <mesh position={[0.8, 0, 0.4]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[0.08, 0.08, 0.1]} />
              <meshStandardMaterial color="#dd0000" />
            </mesh>
          </group>
        </group>
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        target={[0, 0, -3]}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />
    </>
  );
}
