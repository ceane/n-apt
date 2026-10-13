import React from "react";
import { useFrame } from "@react-three/fiber";
import { CubicBezierCurve3, Shape, Vector3 } from "three";
import type { Group } from "three";

export const TRANSMITTER_MODEL_NAMES = [
  "HackRF One",
  "RTL-SDR",
  "SDRplay",
] as const;

type TransmitterProps = {
  position?: [number, number, number];
  scale?: number;
};

type RTLSdrProps = TransmitterProps & {
  withAntenna?: boolean;
};

/** Reusable HackRF One transmitter model. Keep scene effects outside this component. */
export function HackRFOne({
  position = [0, 0, 0],
  scale = 1,
}: TransmitterProps) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, -0.14, 0]} castShadow>
        {/* The cased unit is about 124 x 80 x 18 mm. */}
        <boxGeometry args={[1.24, 0.18, 0.8]} />
        <meshStandardMaterial color="#111111" roughness={0.5} />
      </mesh>
      {/* Three SMA ports share the antenna end of the enclosure. */}
      {[-0.25, 0, 0.25].map((z) => (
        <React.Fragment key={z}>
          <mesh position={[-0.63, -0.14, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.065, 0.065, 0.12, 16]} />
            <meshStandardMaterial
              color="#c0c0c0"
              metalness={0.85}
              roughness={0.25}
            />
          </mesh>
          <mesh position={[-0.697, -0.14, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.034, 0.034, 0.02, 12]} />
            <meshStandardMaterial color="#242424" metalness={0.25} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Right-angle adapter and single upright telescoping antenna on ANT SMA. */}
      <mesh position={[-0.73, -0.14, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.075, 0.075, 0.12, 16]} />
        <meshStandardMaterial
          color="#c0c0c0"
          metalness={0.85}
          roughness={0.25}
        />
      </mesh>
      <mesh position={[-0.85, -0.14, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.14, 16]} />
        <meshStandardMaterial color="#171717" roughness={0.65} />
      </mesh>
      <mesh position={[-0.85, 0.535, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.045, 1.35, 12]} />
        <meshStandardMaterial color="#151515" roughness={0.88} />
      </mesh>
      <mesh position={[-0.85, 1.21, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.032, 0.04, 12]} />
        <meshStandardMaterial color="#101010" roughness={0.88} />
      </mesh>
      {/* Micro-USB shell sits flush with the opposite end of the case. */}
      <mesh position={[0.66, -0.14, 0]}>
        <boxGeometry args={[0.12, 0.1, 0.22]} />
        <meshStandardMaterial
          color="#c0c0c0"
          metalness={0.8}
          roughness={0.25}
        />
      </mesh>
      <mesh position={[0.724, -0.14, 0]}>
        <boxGeometry args={[0.012, 0.045, 0.13]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
    </group>
  );
}

export function SpinningHackRFOne({
  speed = 0.8,
  ...props
}: TransmitterProps & { speed?: number }) {
  const ref = React.useRef<Group>(null);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });

  return (
    <group ref={ref}>
      <HackRFOne {...props} />
    </group>
  );
}

function TelescopingAntenna({
  position,
  tilt = 0,
  thicknessScale = 0.5,
}: {
  position: [number, number, number];
  tilt?: number;
  thicknessScale?: number;
}) {
  return (
    <group position={position}>
      <group rotation={[0, 0, tilt]}>
        <mesh position={[0, 0.24, 0]} castShadow>
          <cylinderGeometry
            args={[0.065 * thicknessScale, 0.08 * thicknessScale, 0.48, 12]}
          />
          <meshStandardMaterial
            color="#bfc4c7"
            metalness={0.9}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 0.62, 0]} castShadow>
          <cylinderGeometry
            args={[0.045 * thicknessScale, 0.055 * thicknessScale, 0.3, 12]}
          />
          <meshStandardMaterial
            color="#e1e4e5"
            metalness={0.92}
            roughness={0.2}
          />
        </mesh>
        <mesh position={[0, 0.91, 0]} castShadow>
          <cylinderGeometry
            args={[0.025 * thicknessScale, 0.035 * thicknessScale, 0.28, 12]}
          />
          <meshStandardMaterial
            color="#aeb4b8"
            metalness={0.9}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 1.07, 0]} castShadow>
          <cylinderGeometry
            args={[0.055 * thicknessScale, 0.055 * thicknessScale, 0.06, 12]}
          />
          <meshStandardMaterial
            color="#d8dcde"
            metalness={0.9}
            roughness={0.2}
          />
        </mesh>
      </group>
    </group>
  );
}

function WireFedAntenna() {
  const cable = React.useMemo(
    () =>
      new CubicBezierCurve3(
        // Leave the coax, bow below the enclosure, then enter its bottom gland.
        new Vector3(-0.86, 0, 0),
        new Vector3(-1.04, -0.06, 0),
        // Keep the bend below the plate footprint so the cable cannot cross it.
        new Vector3(-1.5, -0.36, 0),
        // Finish inside the gland after it overlaps the enclosure's lower edge.
        new Vector3(-1.72, -0.2, 0),
      ),
    [],
  );

  return (
    <>
      <mesh>
        <tubeGeometry args={[cable, 64, 0.02, 8, false]} />
        <meshStandardMaterial color="#161616" roughness={0.65} />
      </mesh>
      {/* Coax coupling at the RTL-SDR's SMA jack. */}
      <mesh position={[-0.825, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.075, 0.075, 0.1, 24]} />
        <meshStandardMaterial color="#c5c8ca" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* Compact U-like black mounting plate, oriented face-on to the camera. */}
      <mesh position={[-1.72, 0, -0.04]} castShadow>
        <extrudeGeometry
          args={[
            new Shape()
              .moveTo(-0.31, 0.14)
              .lineTo(0.31, 0.14)
              .lineTo(0.31, -0.07)
              .lineTo(0.22, -0.14)
              .lineTo(-0.22, -0.14)
              .lineTo(-0.31, -0.07)
              .closePath(),
            {
              depth: 0.08,
              bevelEnabled: true,
              bevelSegments: 2,
              steps: 1,
              bevelSize: 0.012,
              bevelThickness: 0.01,
            },
          ]}
        />
        <meshStandardMaterial color="#171717" roughness={0.65} />
      </mesh>
      {[-1.91, -1.53].map((x) => (
        <React.Fragment key={x}>
          <mesh position={[x, 0.15, 0.005]} castShadow>
            <cylinderGeometry args={[0.078, 0.078, 0.08, 24]} />
            <meshStandardMaterial
              color="#bfc4c7"
              metalness={0.86}
              roughness={0.32}
            />
          </mesh>
        </React.Fragment>
      ))}
      {/* Center cable grommet overlaps the lower edge so it joins the plate. */}
      <mesh position={[-1.72, -0.17, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.15, 20]} />
        <meshStandardMaterial color="#111111" roughness={0.72} />
      </mesh>
      {/* Seat both angled poles slightly inside their collars to avoid a visual seam. */}
      <TelescopingAntenna position={[-1.91, 0.165, 0.005]} tilt={0.52} />
      <TelescopingAntenna position={[-1.53, 0.165, 0.005]} tilt={-0.52} />
    </>
  );
}

export function RTLSdr({
  position = [0, 0, 0],
  scale = 1,
  withAntenna = false,
}: RTLSdrProps) {
  const pixelSize = 0.025;
  const textMap = [
    "XXX XXX X     XXX XXX XXX",
    "X X  X  X     X   X X X X",
    "XXX  X  X     XXX X X XXX",
    "X X  X  X       X X X X X",
    "X X  X  XXX   XXX XXX X X",
  ];
  const pixels: [number, number][] = [];
  textMap.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "X") {
        pixels.push([x, -y]);
      }
    }
  });

  return (
    <group position={position} scale={scale} userData={{ model: "RTL-SDR" }}>
      {/* Main Body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.2, 0.25, 0.55]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.7} />
      </mesh>

      {/* USB Connector */}
      <mesh position={[0.75, 0, 0]}>
        <boxGeometry args={[0.3, 0.12, 0.3]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* USB Connector Details (holes) */}
      <mesh position={[0.75, 0.061, 0.08]}>
        <boxGeometry args={[0.04, 0.01, 0.04]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh position={[0.75, 0.061, -0.08]}>
        <boxGeometry args={[0.04, 0.01, 0.04]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* SMA Connector (Gold) */}
      <mesh position={[-0.62, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.1, 0.05, 6]} />
        <meshStandardMaterial color="#d4af37" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[-0.7, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.15]} />
        <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.4} />
      </mesh>
      <mesh position={[-0.78, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.02]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* Pixilated Text */}
      <group position={[-0.3, 0.126, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        {pixels.map((p, i) => (
          <mesh key={i} position={[p[0] * pixelSize, p[1] * pixelSize, 0]}>
            <boxGeometry args={[pixelSize * 0.9, pixelSize * 0.9, 0.005]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.1}
            />
          </mesh>
        ))}
      </group>

      {/* Case Ridges */}
      <group position={[0, 0.126, -0.15]}>
        {[-0.2, -0.1, 0, 0.1, 0.2].map((x, i) => (
          <mesh key={i} position={[x, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.02, 0.15, 0.005]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        ))}
      </group>

      {withAntenna && <WireFedAntenna />}
    </group>
  );
}

export function RTLSdrWithAntenna(props: Omit<RTLSdrProps, "withAntenna">) {
  return <RTLSdr {...props} withAntenna />;
}

export function SpinningRTLSdr({
  speed = 0.8,
  ...props
}: RTLSdrProps & { speed?: number }) {
  const ref = React.useRef<Group>(null);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });

  return (
    <group ref={ref}>
      <RTLSdr {...props} />
    </group>
  );
}

export function SpinningRTLSdrWithAntenna(
  props: Omit<RTLSdrProps, "withAntenna"> & { speed?: number },
) {
  return <SpinningRTLSdr {...props} withAntenna />;
}

/** Reserved geometry slot for a future SDRplay model. */
export function SDRplay({ position = [0, 0, 0], scale = 1 }: TransmitterProps) {
  return (
    <group
      position={position}
      scale={scale}
      userData={{ model: "SDRplay", placeholder: true }}
    >
      <mesh>
        <boxGeometry args={[1.3, 0.26, 0.65]} />
        <meshStandardMaterial color="#24303a" wireframe />
      </mesh>
    </group>
  );
}

export type TransmitterModel = (typeof TRANSMITTER_MODEL_NAMES)[number];

export function Transmitters({
  model,
  ...props
}: TransmitterProps & { model: TransmitterModel }) {
  if (model === "RTL-SDR") return <RTLSdr {...props} />;
  if (model === "SDRplay") return <SDRplay {...props} />;
  return <HackRFOne {...props} />;
}

/** SDR capability namespaces: tx is transmit-capable; rx is receive-only. */
export const SDRs = {
  tx: { HackRFOne, SpinningHackRFOne },
  rx: {
    RTLSdr,
    RTLSdrWithAntenna,
    SpinningRTLSdr,
    SpinningRTLSdrWithAntenna,
    SDRplay,
  },
} as const;
