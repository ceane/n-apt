import React, { Suspense, useRef, useCallback, useEffect } from "react";
import styled from "styled-components";
import { Canvas, useThree } from "@react-three/fiber";
import { Clone, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Vector3 } from "three";
import { HorizonFocusGlobe } from "@n-apt/three-d/HorizonFocusGlobe";
import { HUMAN_MODEL_AFRO_MALE_GLB_URL } from "@n-apt/three-d";
import { useHotspotEditor } from "@n-apt/three-d/hooks/useHotspotEditor";
import { useModel3D, type Area } from "@n-apt/three-d/hooks/useModel3D";
import { rotationMarkerArrowHead, rotationMarkerOrbits } from "@n-apt/three-d/rotationMarkerGeometry";
import { PHYSIOLOGY_AREAS } from "@n-apt/learn";
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
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_BASE_INTENSITY,
  SPHERE_MARKER_COLOR,
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

function PhysiologyOrb({
  area,
  isActive,
  onSelect,
}: {
  area: Area;
  isActive: boolean;
  onSelect?: (area: Area) => void;
}) {
  const markerPositions = area.markerPositions ?? [area.markerPosition ?? area.target];
  const compactRadiusByArea: Record<string, number> = {
    Head: 0.015,
    Face: 0.017,
    "Ears (Left)": 0.014,
    "Ears (Right)": 0.014,
    Throat: 0.003,
  };
  const normalRadius = 0.032;
  const baseRadius =
    (area.markerRadius ?? compactRadiusByArea[area.name] ?? normalRadius) * (isActive ? 1.55 : 1);
  const color = isActive ? "#2563eb" : "#9ca3af";
  const baseOpacity = isActive ? 0.95 : 0.68;

  if (area.markerStyle === "rotation") {
    const position = area.markerPosition ?? area.target;
    const arrowRadius = area.markerRadius ?? 0.035;
    const [frontOrbit, sideOrbit] = rotationMarkerOrbits(arrowRadius);
    const arrowHead = rotationMarkerArrowHead(frontOrbit.radius, frontOrbit.arc);
    const sideArrowHead = rotationMarkerArrowHead(sideOrbit.radius, sideOrbit.arc);
    const arrowMaterial = {
      color,
      emissive: color,
      emissiveIntensity: isActive ? 1.1 : 0.35,
      transparent: true,
      opacity: isActive ? 0.96 : 0.72,
    } as const;
    return (
      <group
        position={worldToModelLocal(position)}
        onClick={onSelect ? (event) => {
          event.stopPropagation();
          onSelect(area);
        } : undefined}
      >
        <mesh>
          <sphereGeometry args={[arrowRadius * 1.85, 20, 20]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 0.45 : 0.12} transparent opacity={isActive ? 0.13 : 0.07} depthWrite={false} />
        </mesh>
        <group position={frontOrbit.offset} rotation={frontOrbit.rotation} scale={frontOrbit.scale}>
          <mesh>
            <torusGeometry args={[frontOrbit.radius, frontOrbit.tubeRadius, 10, 64, frontOrbit.arc]} />
            <meshStandardMaterial {...arrowMaterial} />
          </mesh>
          <mesh position={arrowHead.position} rotation={[0, 0, arrowHead.rotationZ]}>
            <coneGeometry args={[arrowHead.radius, arrowHead.height, 24]} />
            <meshStandardMaterial {...arrowMaterial} />
          </mesh>
        </group>
        <group position={sideOrbit.offset} rotation={sideOrbit.rotation} scale={sideOrbit.scale}>
          <mesh>
            <torusGeometry args={[sideOrbit.radius, sideOrbit.tubeRadius, 10, 64, sideOrbit.arc]} />
            <meshStandardMaterial {...arrowMaterial} />
          </mesh>
          <mesh position={sideArrowHead.position} rotation={[0, 0, sideArrowHead.rotationZ]}>
            <coneGeometry args={[sideArrowHead.radius, sideArrowHead.height, 24]} />
            <meshStandardMaterial {...arrowMaterial} />
          </mesh>
        </group>
      </group>
    );
  }

  return (
    <>{markerPositions.map((position, index) => <group
      key={index}
      position={worldToModelLocal(position)}
      onClick={onSelect ? (event) => {
        event.stopPropagation();
        onSelect(area);
      } : undefined}
    >
      <mesh>
        <sphereGeometry args={[baseRadius, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 1.5 : 0.35}
          transparent
          opacity={baseOpacity}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[baseRadius * 1.8, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 0.6 : 0.12}
          transparent
          opacity={isActive ? 0.2 : 0.08}
        />
      </mesh>
    </group>)}</>
  );
}

function AreaMarker({ selectedArea }: { selectedArea: Area }) {
  const markerPosition = worldToModelLocal(selectedArea.markerPosition ?? selectedArea.target);

  if (selectedArea.name === "Head" || selectedArea.markerPositions) return null;

  return (
    <group position={markerPosition}>
      <mesh>
        <sphereGeometry
          args={[0.04, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
        />
        <meshStandardMaterial
          color={SPHERE_MARKER_COLOR}
          emissive={SPHERE_MARKER_COLOR}
          emissiveIntensity={SPHERE_MARKER_BASE_INTENSITY}
          transparent
          opacity={0.5}
        />
      </mesh>
      <mesh>
        <sphereGeometry
          args={[0.08, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
        />
        <meshStandardMaterial
          color={SPHERE_MARKER_COLOR}
          emissive={SPHERE_MARKER_COLOR}
          emissiveIntensity={0.3}
          transparent
          opacity={0.12}
        />
      </mesh>
      <mesh>
        <sphereGeometry
          args={[0.12, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
        />
        <meshStandardMaterial
          color={SPHERE_MARKER_COLOR}
          emissive={SPHERE_MARKER_COLOR}
          emissiveIntensity={0.15}
          transparent
          opacity={0.06}
        />
      </mesh>
    </group>
  );
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
  children,
}: {
  selectedArea: Area | null;
  isEditMode: boolean;
  onAddHotspot: (point: Vector3) => void;
  modelUrl: string;
  modelOffset: [number, number, number];
  showSelectionHalo: boolean;
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
  initialCameraPosition?: [number, number, number];
  initialCameraTarget?: [number, number, number];
}> = ({
  onAreaSelect,
  modelUrl = HUMAN_MODEL_AFRO_MALE_GLB_URL,
  modelOffset = [0, 0, 0],
  areas = PHYSIOLOGY_AREAS,
  visibleAreaNames,
  activeAreaName,
  showSelectionHalo = true,
  showTransformControls = true,
  initialCameraPosition = DEFAULT_MODEL_CAMERA_POSITION,
  initialCameraTarget = DEFAULT_MODEL_CAMERA_TARGET,
}) => {
  const { selectedArea, controlsRef, setSelectedArea } = useModel3D();
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
  const handleAreaSelect = useCallback((area: Area) => {
    setSelectedArea(area);
    onAreaSelect?.(area);
  }, [onAreaSelect, setSelectedArea]);
  const visibleAreas = visibleAreaNames
    ? areas.filter((area) => visibleAreaNames.includes(area.name))
    : areas;
  const currentActiveAreaName = activeAreaName ?? selectedArea?.name;
  const personModel = (
    <PersonModel
      selectedArea={selectedArea}
      isEditMode={isEditMode}
      onAddHotspot={handleAddHotspot}
      modelUrl={modelUrl}
      modelOffset={modelOffset}
      showSelectionHalo={showSelectionHalo}
    >
      <HorizonFocusGlobe active={isEditMode} />
      {!isEditMode &&
        visibleAreas.map((area) => (
          <PhysiologyOrb
            key={area.name}
            area={area}
            isActive={currentActiveAreaName === area.name}
            onSelect={handleAreaSelect}
          />
        ))}
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
        </Suspense>
      </Canvas>
      {isEditMode && (
        <HintOverlay>Click on the model to add hotspots</HintOverlay>
      )}
    </CanvasContainer>
  );
};
