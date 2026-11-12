import React, { Suspense, useRef, useCallback, useEffect, useMemo } from "react";
import styled from "styled-components";
import { Canvas, useThree } from "@react-three/fiber";
import { Clone, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { CatmullRomCurve3, SphereGeometry, TubeGeometry, Vector3 } from "three";
import { HorizonFocusGlobe } from "@n-apt/three-d/HorizonFocusGlobe";
import { HUMAN_MODEL_AFRO_MALE_GLB_URL } from "@n-apt/three-d";
import { useHotspotEditor } from "@n-apt/three-d/hooks/useHotspotEditor";
import { useModel3D, type Area } from "@n-apt/three-d/hooks/useModel3D";
import { attachModelWheelRotation } from "@n-apt/three-d/modelWheelRotation";
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
import { useTheme } from "styled-components";

function worldToModelLocal(
  position: [number, number, number],
): [number, number, number] {
  return [
    position[0] - MODEL_ROOT_POSITION[0],
    position[1] - MODEL_ROOT_POSITION[1],
    position[2] - MODEL_ROOT_POSITION[2],
  ];
}

const DEFAULT_MODEL_CAMERA_POSITION: [number, number, number] = [
  MODEL_CAMERA_POSITION[0],
  MODEL_CAMERA_POSITION[1],
  MODEL_CAMERA_POSITION[2],
];
const DEFAULT_MODEL_CAMERA_TARGET: [number, number, number] = [
  MODEL_CAMERA_TARGET[0],
  MODEL_CAMERA_TARGET[1],
  MODEL_CAMERA_TARGET[2],
];

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

function ModelScrollRotation({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  const { controlsRef } = useModel3D();

  useEffect(() => {
    if (!enabled) return;
    return attachModelWheelRotation(gl.domElement, () => controlsRef.current);
  }, [controlsRef, enabled, gl.domElement]);

  return null;
}

function createOrganicGeometry() {
  const geometry = new SphereGeometry(1, 40, 28);
  const positions = geometry.attributes.position;
  const vertex = new Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    vertex.fromBufferAttribute(positions, i).normalize();
    const wobble = 1 + 0.075 * Math.sin(vertex.x * 7 + vertex.y * 3) * Math.cos(vertex.z * 5 - vertex.y * 4);
    positions.setXYZ(i, vertex.x * wobble, vertex.y * wobble, vertex.z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function regionScale(name: string): [number, number, number] {
  const lower = name.toLowerCase();
  if (/face|head|ear|eye|mouth|jaw|brow|eyelid/.test(lower)) return [0.052, 0.07, 0.014];
  if (/arm|forearm|biceps|triceps|hand|finger|wrist|palm/.test(lower)) return [0.05, 0.10, 0.014];
  if (/leg|thigh|calf|knee|foot|ankle|toe|glute|buttock/.test(lower)) return [0.055, 0.11, 0.016];
  if (/torso|chest|back|abdomen|stomach|heart|diaphragm/.test(lower)) return [0.085, 0.095, 0.017];
  if (/throat|larynx|tongue|vocal/.test(lower)) return [0.035, 0.05, 0.012];
  return [0.05, 0.07, 0.014];
}

function RegionHighlight({ area, onSelect }: { area: Area; onSelect?: (area: Area) => void }) {
  const geometry = useMemo(createOrganicGeometry, []);
  const center = worldToModelLocal(area.markerPosition ?? area.target);
  const scale = regionScale(area.name);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group position={center} scale={scale} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(area); } : undefined}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#3bdcff" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh geometry={geometry} scale={1.2}>
        <meshBasicMaterial color="#22cfff" transparent opacity={0.09} depthWrite={false} side={2} toneMapped={false} />
      </mesh>
    </group>
  );
}

function NerveHighlight({ area, onSelect }: { area: Area; onSelect?: (area: Area) => void }) {
  const center = worldToModelLocal(area.markerPosition ?? area.target);
  const paths = useMemo(() => {
    const lowerLimb = /sciatic|femoral|tibial|fibular|sural|saphenous|sacral|lumbar|leg|foot/i.test(area.name);
    const upperLimb = /brachial|radial|ulnar|median|musculocutaneous|hand|arm/i.test(area.name);
    const length = lowerLimb ? 0.42 : upperLimb ? 0.34 : 0.24;
    const branch = lowerLimb ? 0.11 : upperLimb ? 0.09 : 0.075;
    const yDir = lowerLimb ? -1 : 1;
    const definitions: [number, number, number][][] = [
      [[0, length * yDir, 0], [0.015, length * 0.48 * yDir, 0.005], [0, 0, 0.012], [-0.012, -length * 0.48 * yDir, 0.006], [0, -length * yDir, 0]],
      [[0, 0, 0.012], [branch, length * 0.15 * yDir, 0.01], [branch * 1.45, length * 0.34 * yDir, 0.006]],
      [[0, -length * 0.12 * yDir, 0.014], [-branch, -length * 0.26 * yDir, 0.009], [-branch * 1.35, -length * 0.43 * yDir, 0.004]],
    ];
    return definitions.map((points, index) => new TubeGeometry(
      new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z))),
      24,
      index === 0 ? 0.009 : 0.005,
      8,
      false,
    ));
  }, [area.name]);
  useEffect(() => () => paths.forEach((path) => path.dispose()), [paths]);
  return (
    <group position={[center[0], center[1], center[2] + 0.018]} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(area); } : undefined}>
      {paths.map((geometry, index) => <mesh key={index} geometry={geometry}>
        <meshBasicMaterial color="#43e5ff" transparent opacity={index === 0 ? 0.94 : 0.76} toneMapped={false} />
      </mesh>)}
    </group>
  );
}

function AreaMarker({ selectedArea, onSelect }: { selectedArea: Area; onSelect?: (area: Area) => void }) {
  if (selectedArea.highlightType === "nerve") return <NerveHighlight area={selectedArea} onSelect={onSelect} />;
  return <RegionHighlight area={selectedArea} onSelect={onSelect} />;
}

function HotspotMarker({
  hotspot,
  onClick,
  isSelected,
  isMultiSelected,
}: {
  hotspot: any;
  onClick: () => void;
  isSelected: boolean;
  isMultiSelected: boolean;
}) {
  const theme = useTheme() as any;
  const size = hotspot.size === "large" ? 0.08 : 0.02;
  const baseColor = hotspot.size === "large" ? theme.primary : "#ffaa00";
  const color = isMultiSelected
    ? "#ff6b6b"
    : isSelected
      ? "#ffffff"
      : baseColor;

  return (
    <group position={hotspot.position}>
      <mesh onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
        />
      </mesh>
      {isSelected && (
        <group position={[0, size + 0.05, 0]}>
          <mesh>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshStandardMaterial
              color="#ffaa00"
              emissive="#ffaa00"
              emissiveIntensity={0.8}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

function PersonModel({
  selectedArea,
  isEditMode,
  onAddHotspot,
  modelUrl,
  modelOffset,
  showSelectionHalo,
  visibleAreas,
  onAreaSelect,
  children,
}: {
  selectedArea: Area | null;
  isEditMode: boolean;
  onAddHotspot: (point: Vector3) => void;
  modelUrl: string;
  modelOffset: [number, number, number];
  showSelectionHalo: boolean;
  visibleAreas?: Area[];
  onAreaSelect?: (area: Area) => void;
  children?: React.ReactNode;
}) {
  const { scene } = useGLTF(modelUrl);
  const groupRef = useRef<any>(null);

  const onPointerDown = useCallback(
    (e: any) => {
      if (!isEditMode) return;
      e.stopPropagation();
      if (groupRef.current) {
        const localPoint = groupRef.current.worldToLocal(e.point.clone());
        onAddHotspot(localPoint);
      }
    },
    [isEditMode, onAddHotspot],
  );

  return (
    <group ref={groupRef} position={MODEL_ROOT_POSITION}>
      {/* useGLTF caches scenes by URL; Clone gives each canvas its own Object3D tree. */}
      <Clone object={scene} position={modelOffset} onPointerDown={onPointerDown} />
      {showSelectionHalo && selectedArea && <AreaMarker selectedArea={selectedArea} />}
      {!showSelectionHalo && visibleAreas?.map((area) => <AreaMarker key={area.name} selectedArea={area} onSelect={onAreaSelect} />)}
      {children}
    </group>
  );
}

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
`;

const HintOverlay = styled.div`
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 10px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: none;
`;

export const Model3DPerson: React.FC<{
  onAreaSelect?: (area: Area) => void;
  modelUrl?: string;
  modelOffset?: [number, number, number];
  areas?: Area[];
  visibleAreaNames?: string[];
  activeAreaName?: string;
  showSelectionHalo?: boolean;
  showTransformControls?: boolean;
  scrollRotate?: boolean;
  initialCameraPosition?: [number, number, number];
  initialCameraTarget?: [number, number, number];
}> = ({
  onAreaSelect,
  modelUrl = HUMAN_MODEL_AFRO_MALE_GLB_URL,
  modelOffset = [0, 0, 0],
  areas = [],
  visibleAreaNames,
  showSelectionHalo = true,
  showTransformControls = true,
  scrollRotate = false,
  initialCameraPosition = DEFAULT_MODEL_CAMERA_POSITION,
  initialCameraTarget = DEFAULT_MODEL_CAMERA_TARGET,
}) => {
  const { selectedArea, controlsRef } = useModel3D();
  const {
    hotspots,
    selectedHotspot,
    showGrid,
    sidebarTab,
    handleAddHotspot,
    handleHotspotClick,
    multiSelectedHotspots,
  } = useHotspotEditor();
  const isEditMode = sidebarTab === "make-hotspots";
  const visibleAreas = visibleAreaNames ? areas.filter((area) => visibleAreaNames.includes(area.name)) : [];
  const personModel = (
    <PersonModel
      selectedArea={selectedArea}
      isEditMode={isEditMode}
      onAddHotspot={handleAddHotspot}
      modelUrl={modelUrl}
      modelOffset={modelOffset}
      showSelectionHalo={showSelectionHalo}
      visibleAreas={visibleAreas}
      onAreaSelect={onAreaSelect}
    >
      <HorizonFocusGlobe active={isEditMode} />
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          onClick={() => handleHotspotClick(hotspot.id)}
          isSelected={selectedHotspot === hotspot.id}
          isMultiSelected={multiSelectedHotspots.includes(hotspot.id)}
        />
      ))}
    </PersonModel>
  );

  return (
    <CanvasContainer>
      <Canvas
        style={{ width: "100%", height: "100%" }}
        camera={{ position: initialCameraPosition, fov: MODEL_FOV }}
      >
        <RendererSizeSync />
        <Suspense fallback={null}>
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
          <pointLight
            position={[2.8, 2.4, -4.2]}
            intensity={1.4}
            color="#7cc7ff"
          />
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
            intensity={MODEL_FILL_LIGHT_INTENSITY * 1.0}
            color="#ffffff"
          />
          {isEditMode && showGrid && (
            <gridHelper args={[10, 10, "#333", "#222"]} position={[0, 0, 0]} />
          )}
          {showTransformControls ? (
            <TransformControls mode="translate">{personModel}</TransformControls>
          ) : personModel}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            target={initialCameraTarget}
          />
          <ModelScrollRotation enabled={scrollRotate} />
        </Suspense>
      </Canvas>
      {isEditMode && (
        <HintOverlay>Click on the model to add hotspots</HintOverlay>
      )}
    </CanvasContainer>
  );
};
