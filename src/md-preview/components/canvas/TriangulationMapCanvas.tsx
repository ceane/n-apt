import React, { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import CanvasHarness from "@n-apt/md-preview/components/canvas/CanvasHarness";
import { CanvasText } from "@n-apt/md-preview/components/CanvasText";

// Scene bounds for the minimap-style view
const SCENE_BOUNDS = {
  left: -4.2,
  right: 4.2,
  top: 2.4,
  bottom: -2.4,
  width: 8.4,
  height: 4.8,
};

// All possible cell tower endpoints (more than active at once)
const ALL_ENDPOINTS = [
  { x: -3.8, y: 1.8, label: "A", color: "#00e5ff", id: 0 },
  { x: -3.8, y: -1.6, label: "B", color: "#ff00e5", id: 1 },
  { x: 0, y: 2.1, label: "C", color: "#e5ff00", id: 2 },
  { x: 3.8, y: 1.8, label: "D", color: "#00ff88", id: 3 },
  { x: 3.8, y: -1.6, label: "E", color: "#ff8800", id: 4 },
  { x: 0, y: -1.8, label: "F", color: "#8800ff", id: 5 },
  { x: -2.5, y: 0, label: "G", color: "#ff3366", id: 6 },
  { x: 2.5, y: 0, label: "H", color: "#33ff66", id: 7 },
];

// Building blocks for the cityscape background
const BUILDINGS = [
  { x: -1.8, y: -0.8, w: 1.0, h: 0.7 },
  { x: 1.3, y: 0.5, w: 0.8, h: 0.9 },
  { x: -0.8, y: 1.4, w: 0.6, h: 0.5 },
  { x: 2.2, y: -1.2, w: 0.9, h: 0.7 },
  { x: -2.8, y: 0.8, w: 0.5, h: 0.6 },
  { x: 0.4, y: -1.6, w: 0.7, h: 0.5 },
];

// Building block component
const Building: React.FC<{ x: number; y: number; w: number; h: number }> = ({ x, y, w, h }) => {
  return (
    <mesh position={[x, y, 0.1]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial color="#4a5568" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
};

// Moving device dot with barycentric hysteresis
const DeviceDot: React.FC<{
  position: THREE.Vector2;
  velocity: THREE.Vector2;
}> = ({ position, velocity }) => {
  const dotRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Line>(null);
  const trailPoints = useRef<THREE.Vector3[]>([]);

  useFrame(({ clock }) => {
    // Pulse animation
    if (dotRef.current) {
      const pulse = 0.9 + Math.sin(clock.elapsedTime * 4) * 0.12;
      dotRef.current.scale.set(pulse, pulse, 1);
    }

    // Ring ripple
    if (ringRef.current) {
      const t = clock.elapsedTime;
      const scale = 1 + Math.sin(t * 3) * 0.4;
      ringRef.current.scale.set(scale, scale, 1);
      const material = ringRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.25 + Math.sin(t * 3) * 0.15;
    }

    // Update trail
    if (trailRef.current) {
      trailPoints.current.push(new THREE.Vector3(position.x, position.y, 0.25));
      if (trailPoints.current.length > 20) trailPoints.current.shift();

      const geometry = new THREE.BufferGeometry().setFromPoints(trailPoints.current);
      trailRef.current.geometry.dispose();
      trailRef.current.geometry = geometry;
    }
  });

  // Calculate rotation based on velocity
  const rotation = Math.atan2(velocity.y, velocity.x);

  return (
    <group position={[position.x, position.y, 0.5]}>
      {/* Trail */}
      <line ref={trailRef as any}>
        <lineBasicMaterial color="#ef4444" transparent opacity={0.3} depthWrite={false} />
      </line>

      {/* Ripple ring */}
      <mesh ref={ringRef as any} position={[0, 0, -0.1]}>
        <ringGeometry args={[0.2, 0.35, 32]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      {/* Direction indicator */}
      <mesh rotation={[0, 0, rotation]} position={[0.15, 0, 0]}>
        <coneGeometry args={[0.08, 0.2, 3]} />
        <meshBasicMaterial color="#ff6666" depthWrite={false} />
      </mesh>

      {/* Main dot */}
      <mesh ref={dotRef as any}>
        <circleGeometry args={[0.15, 32]} />
        <meshBasicMaterial color="#ef4444" depthWrite={false} />
      </mesh>

      <CanvasText
        position={[0, -0.38, 0]}
        fontSize={0.18}
        color="#ef4444"
        anchorX="center"
        anchorY="middle"
        fontWeight={700}
        text="Target"
      />
    </group>
  );
};

// Cell tower endpoint with activation states
const EndpointMarker: React.FC<{
  x: number;
  y: number;
  label: string;
  color: string;
  isActive: boolean;
  isWarmUp: boolean;
  devicePosition: THREE.Vector2;
}> = ({ x, y, label, color, isActive, isWarmUp, devicePosition }) => {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Line>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.elapsedTime;
      // Glow pulse for active towers
      if (isActive) {
        const pulse = 1 + Math.sin(t * 4) * 0.15;
        groupRef.current.scale.set(pulse, pulse, 1);
      }
    }
  });

  // Calculate beam to device
  const beamGeometry = useMemo(() => {
    const points = [
      new THREE.Vector3(x, y, 0.2),
      new THREE.Vector3(devicePosition.x, devicePosition.y, 0.2),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [x, y, devicePosition.x, devicePosition.y]);

  // Determine visual state
  let opacity = 0.4;
  let radius = 0.12;
  if (isActive) {
    opacity = 1;
    radius = 0.2;
  } else if (isWarmUp) {
    opacity = 0.8;
    radius = 0.16;
  }

  return (
    <group>
      {/* Connection beam to device (only when active) */}
      {isActive && (
        <line ref={beamRef as any}>
          <primitive object={beamGeometry} attach="geometry" />
          <lineBasicMaterial
            color={color}
            transparent
            opacity={0.3}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </line>
      )}

      <group ref={groupRef as any} position={[x, y, 0.3]}>
        {/* Glow ring for active */}
        {isActive && (
          <mesh position={[0, 0, -0.05]}>
            <ringGeometry args={[radius * 1.5, radius * 2, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.2}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}

        {/* Main tower marker */}
        <mesh>
          <octahedronGeometry args={[radius, 0]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={opacity}
            depthWrite={false}
            blending={isActive ? THREE.AdditiveBlending : THREE.NormalBlending}
          />
        </mesh>

        <CanvasText
          position={[0, -0.4, 0]}
          fontSize={0.16}
          color={color}
          anchorX="center"
          anchorY="middle"
          fontWeight={isActive ? 700 : 500}
          text={label}
        />
      </group>
    </group>
  );
};

// Animated triangulation line with hysteresis effect
const TriangulationLine: React.FC<{
  start: THREE.Vector2;
  end: THREE.Vector2;
  color: string;
  isActive: boolean;
}> = ({ start, end, color, isActive }) => {
  const lineRef = useRef<THREE.Line>(null);
  const dashOffset = useRef(0);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const points = [
      new THREE.Vector3(start.x, start.y, 0.15),
      new THREE.Vector3(end.x, end.y, 0.15)
    ];
    geom.setFromPoints(points);
    return geom;
  }, [start, end]);

  useFrame(() => {
    if (lineRef.current && isActive) {
      dashOffset.current -= 0.02;
      const material = lineRef.current.material as THREE.LineDashedMaterial;
      material.dashOffset = dashOffset.current;
    }
  });

  if (!isActive) return null;

  return (
    <line ref={lineRef as any}>
      <primitive object={geometry} attach="geometry" />
      <lineDashedMaterial
        color={color}
        transparent
        opacity={0.5}
        dashSize={0.2}
        gapSize={0.1}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </line>
  );
};

// Device with barycentric random movement and hysteresis
const MovingDevice: React.FC<{
  onPositionChange: (pos: THREE.Vector2, velocity: THREE.Vector2) => void;
}> = ({ onPositionChange }) => {
  const positionRef = useRef(new THREE.Vector2(0, 0));
  const velocityRef = useRef(new THREE.Vector2(0.5, 0.3));
  const targetVelocityRef = useRef(new THREE.Vector2(0.5, 0.3));
  const changeDirTimer = useRef(0);

  useFrame((_state, delta) => {

    // Change direction periodically with some randomness
    changeDirTimer.current += delta;
    if (changeDirTimer.current > 2 + Math.random() * 3) {
      changeDirTimer.current = 0;
      // Random new target velocity
      targetVelocityRef.current.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      );
    }

    // Smoothly interpolate velocity (hysteresis)
    velocityRef.current.lerp(targetVelocityRef.current, 0.03);

    // Apply barycentric drift - slight pull toward center occasionally
    const distFromCenter = positionRef.current.length();
    if (distFromCenter > 3) {
      const toCenter = new THREE.Vector2(0, 0).sub(positionRef.current).normalize().multiplyScalar(0.3);
      velocityRef.current.add(toCenter.multiplyScalar(delta));
    }

    // Update position
    positionRef.current.add(velocityRef.current.clone().multiplyScalar(delta * 1.5));

    // Bounce off bounds
    if (positionRef.current.x < SCENE_BOUNDS.left + 0.5 || positionRef.current.x > SCENE_BOUNDS.right - 0.5) {
      velocityRef.current.x *= -1;
      targetVelocityRef.current.x *= -1;
    }
    if (positionRef.current.y < SCENE_BOUNDS.bottom + 0.5 || positionRef.current.y > SCENE_BOUNDS.top - 0.5) {
      velocityRef.current.y *= -1;
      targetVelocityRef.current.y *= -1;
    }

    // Clamp position
    positionRef.current.x = THREE.MathUtils.clamp(positionRef.current.x, SCENE_BOUNDS.left + 0.5, SCENE_BOUNDS.right - 0.5);
    positionRef.current.y = THREE.MathUtils.clamp(positionRef.current.y, SCENE_BOUNDS.bottom + 0.5, SCENE_BOUNDS.top - 0.5);

    onPositionChange(positionRef.current.clone(), velocityRef.current.clone());
  });

  return (
    <DeviceDot
      position={positionRef.current}
      velocity={velocityRef.current}
    />
  );
};

// Calculate which endpoints should be active based on device position
// Uses barycentric hysteresis - closest N towers activate with smooth transitions
const calculateActiveEndpoints = (
  devicePos: THREE.Vector2,
  endpoints: typeof ALL_ENDPOINTS,
  maxActive: number = 4
): { active: Set<number>; warmUp: Set<number> } => {
  // Calculate distances to all endpoints
  const withDistances = endpoints.map((ep) => ({
    ...ep,
    distance: new THREE.Vector2(ep.x, ep.y).distanceTo(devicePos),
  }));

  // Sort by distance
  withDistances.sort((a, b) => a.distance - b.distance);

  // Active are the closest maxActive
  const active = new Set(withDistances.slice(0, maxActive).map((ep) => ep.id));

  // Warm-up are the next 2 (transitioning to active)
  const warmUp = new Set(withDistances.slice(maxActive, maxActive + 2).map((ep) => ep.id));

  return { active, warmUp };
};

const SceneContents: React.FC = () => {
  const { camera } = useThree();
  const [devicePosition, setDevicePosition] = useState(new THREE.Vector2(0, 0));
  const [_deviceVelocity, setDeviceVelocity] = useState(new THREE.Vector2(0.5, 0.3));
  const [activeEndpoints, setActiveEndpoints] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [warmUpEndpoints, setWarmUpEndpoints] = useState<Set<number>>(new Set([4, 5]));

  // Device position change handler
  const handlePositionChange = (pos: THREE.Vector2, vel: THREE.Vector2) => {
    setDevicePosition(pos);
    setDeviceVelocity(vel);

    // Update active endpoints based on proximity
    const { active, warmUp } = calculateActiveEndpoints(pos, ALL_ENDPOINTS, 4);
    setActiveEndpoints(active);
    setWarmUpEndpoints(warmUp);
  };

  React.useEffect(() => {
    if (camera.type === "OrthographicCamera") {
      const ortho = camera as THREE.OrthographicCamera;
      ortho.zoom = 1;
      ortho.updateProjectionMatrix();
    }
  }, [camera]);

  return (
    <>
      <ambientLight intensity={0.9} />

      {/* Background buildings */}
      {BUILDINGS.map((b, i) => (
        <Building key={i} x={b.x} y={b.y} w={b.w} h={b.h} />
      ))}

      {/* All endpoints with dynamic activation */}
      {ALL_ENDPOINTS.map((ep) => (
        <EndpointMarker
          key={ep.label}
          x={ep.x}
          y={ep.y}
          label={ep.label}
          color={ep.color}
          isActive={activeEndpoints.has(ep.id)}
          isWarmUp={warmUpEndpoints.has(ep.id)}
          devicePosition={devicePosition}
        />
      ))}

      {/* Moving device with trail */}
      <MovingDevice onPositionChange={handlePositionChange} />

      {/* Triangulation lines to active endpoints only */}
      {ALL_ENDPOINTS.filter(ep => activeEndpoints.has(ep.id)).map((ep) => (
        <TriangulationLine
          key={`line-${ep.label}`}
          start={new THREE.Vector2(ep.x, ep.y)}
          end={devicePosition}
          color={ep.color}
          isActive={true}
        />
      ))}

      {/* Header - Top Left */}
      <CanvasText
        position={[-4.0, 2.65, 0.3]}
        fontSize={0.24}
        color="#1a1a22"
        anchorX="left"
        anchorY="middle"
        fontWeight={700}
        text="Triangulation"
      />
      <CanvasText
        position={[-4.0, 2.38, 0.3]}
        fontSize={0.13}
        color="#3a3a42"
        anchorX="left"
        anchorY="middle"
        fontWeight={500}
        text="Barycentric hysteresis / stable tracking"
      />

      {/* Stats - Top Right */}
      <CanvasText
        position={[4.0, 2.65, 0.3]}
        fontSize={0.16}
        color="#3a3a42"
        anchorX="right"
        anchorY="middle"
        fontWeight={600}
        text={`${activeEndpoints.size} active / ${ALL_ENDPOINTS.length} towers`}
      />
      <CanvasText
        position={[4.0, 2.42, 0.3]}
        fontSize={0.12}
        color="#3a3a42"
        anchorX="right"
        anchorY="middle"
        fontWeight={500}
        text="Nearest-neighbor handoff"
      />

      {/* Footer - Bottom Center */}
      <CanvasText
        position={[0, -2.6, 0.3]}
        fontSize={0.13}
        color="#3a3a42"
        anchorX="center"
        anchorY="middle"
        fontWeight={500}
        text="Device position determined by proximity to nearest cell towers"
      />
    </>
  );
};

export function TriangulationMapCanvas() {
  return (
    <CanvasHarness aspectRatio="10 / 6">
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <div style={{ position: "absolute", top: -9999, left: -9999, visibility: "hidden" }}>
          <span>Endpoints</span>
          <span>Cell towers</span>
          <span>Target</span>
          <span>Moving device</span>
          <span>Triangulation</span>
        </div>
        <Canvas
          orthographic
          dpr={[1, 2]}
          camera={{ position: [0, 0, 10], zoom: 70, left: -5, right: 5, top: 3, bottom: -3 }}
          gl={{ antialias: true, alpha: true }}
          style={{ cursor: "default", touchAction: "none" }}
        >
          <React.Suspense fallback={null}>
            <SceneContents />
          </React.Suspense>
        </Canvas>
      </div>
    </CanvasHarness>
  );
}

export default TriangulationMapCanvas;
