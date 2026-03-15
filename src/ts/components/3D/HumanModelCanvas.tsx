import React, { Suspense, useRef, useCallback, useEffect } from "react";
import styled from "styled-components";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, TransformControls } from "@react-three/drei";
import { Vector3 } from "three";
import Brain from "./Brain";
import { HorizonFocusGlobe } from "./HorizonFocusGlobe";
import { HUMAN_MODEL_AFRO_MALE_GLB_URL } from "./modelAssetUrls";
import { useModel3D, type Area } from "@n-apt/hooks/useModel3D";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import { PHYSIOLOGY_AREAS } from "@n-apt/components/sidebar/BodyAreasSection";
import {
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
  MODEL_FOV,
  MODEL_ROOT_POSITION,
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_COLOR,
  SPHERE_MARKER_BASE_INTENSITY,
  MODEL_AMBIENT_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_POSITION,
  MODEL_FILL_LIGHT_INTENSITY,
  MODEL_FILL_LIGHT_POSITION,
  MODEL_BACK_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_POSITION,
} from "@n-apt/consts";
import { useTheme } from "styled-components";

// ClickHandler is no longer needed as we use onPointerDown on the mesh directly

function worldToModelLocal(position: [number, number, number]): [number, number, number] {
  return [
    position[0] - MODEL_ROOT_POSITION[0],
    position[1] - MODEL_ROOT_POSITION[1],
    position[2] - MODEL_ROOT_POSITION[2],
  ];
}


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

function PhysiologyOrb({ area, isSelected }: { area: Area; isSelected: boolean }) {
  const markerPosition = worldToModelLocal(area.target);
  const compactRadiusByArea: Record<string, number> = {
    Head: 0.015,
    Face: 0.017,
    "Ears (Left)": 0.014,
    "Ears (Right)": 0.014,
    Throat: 0.003,
  };
  const normalRadius = 0.032;
  const baseRadius = (compactRadiusByArea[area.name] ?? normalRadius) * (isSelected ? 1.2 : 1);
  const baseOpacity = isSelected ? 0.85 : 0.65;

  return (
    <group position={markerPosition}>
      <mesh>
        <sphereGeometry args={[baseRadius, 16, 16]} />
        <meshStandardMaterial
          color="#00d4ff"
          emissive="#00d4ff"
          emissiveIntensity={isSelected ? 1.4 : 1.0}
          transparent
          opacity={baseOpacity}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[baseRadius * 1.8, 16, 16]} />
        <meshStandardMaterial
          color="#00d4ff"
          emissive="#00d4ff"
          emissiveIntensity={0.45}
          transparent
          opacity={isSelected ? 0.16 : 0.1}
        />
      </mesh>
    </group>
  );
}


function AreaMarker({ selectedArea }: { selectedArea: Area }) {
  const markerPosition = worldToModelLocal(selectedArea.target);

  if (selectedArea.name === "Head") {
    return null;
  }

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

function Model({
  selectedArea,
  isEditMode,
  onAddHotspot,
  children,
}: {
  selectedArea: Area | null;
  isEditMode: boolean;
  onAddHotspot: (point: Vector3) => void;
  children?: React.ReactNode;
}) {
  const { scene } = useGLTF(HUMAN_MODEL_AFRO_MALE_GLB_URL);
  const groupRef = useRef<any>(null);

  const onPointerDown = useCallback((e: any) => {
    if (!isEditMode) return;
    e.stopPropagation();
    if (groupRef.current) {
      const localPoint = groupRef.current.worldToLocal(e.point.clone());
      onAddHotspot(localPoint);
    }
  }, [isEditMode, onAddHotspot]);

  return (
    <group ref={groupRef} position={MODEL_ROOT_POSITION}>
      <primitive object={scene} onPointerDown={onPointerDown} />
      {selectedArea && <AreaMarker selectedArea={selectedArea} />}
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

interface HumanModelCanvasProps {
  width?: string | number;
  height?: string | number;
}

export const HumanModelCanvas: React.FC<HumanModelCanvasProps> = ({
  width = "100%",
  height = "100%",
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

  return (
    <CanvasContainer style={{ width, height }}>
      <Canvas
        style={{ width: "100%", height: "100%" }}
        camera={{ position: MODEL_CAMERA_POSITION, fov: MODEL_FOV }}
      >
        <RendererSizeSync />
        <Suspense fallback={null}>
          <ambientLight intensity={MODEL_AMBIENT_LIGHT_INTENSITY} />
          <directionalLight position={MODEL_KEY_LIGHT_POSITION} intensity={MODEL_KEY_LIGHT_INTENSITY} />
          <pointLight position={MODEL_FILL_LIGHT_POSITION} intensity={MODEL_FILL_LIGHT_INTENSITY} color="#ffffff" />
          <pointLight position={MODEL_BACK_LIGHT_POSITION} intensity={MODEL_BACK_LIGHT_INTENSITY} color="#8ddcff" />
          <pointLight position={[-2.8, 2.4, -4.2]} intensity={1.4} color="#7cc7ff" />
          <pointLight position={[2.8, 2.4, -4.2]} intensity={1.4} color="#7cc7ff" />
          {/* Mirror front lighting to the back */}
          <directionalLight position={[-MODEL_KEY_LIGHT_POSITION[0], MODEL_KEY_LIGHT_POSITION[1], -MODEL_KEY_LIGHT_POSITION[2]]} intensity={MODEL_KEY_LIGHT_INTENSITY * 0.9} color="#ffffff" />
          <pointLight position={[-MODEL_FILL_LIGHT_POSITION[0], MODEL_FILL_LIGHT_POSITION[1], -MODEL_FILL_LIGHT_POSITION[2]]} intensity={MODEL_FILL_LIGHT_INTENSITY * 1.0} color="#ffffff" />

          {isEditMode && showGrid && (
            <gridHelper args={[10, 10, "#333", "#222"]} position={[0, 0, 0]} />
          )}

          <TransformControls mode="translate">
            <Model
              selectedArea={selectedArea}
              isEditMode={isEditMode}
              onAddHotspot={handleAddHotspot}
            >
              <Brain />
              <HorizonFocusGlobe active={isEditMode} />

              {!isEditMode && PHYSIOLOGY_AREAS.map((area) => (
                <PhysiologyOrb
                  key={area.name}
                  area={area}
                  isSelected={selectedArea?.name === area.name}
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
            </Model>
          </TransformControls>

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            target={MODEL_CAMERA_TARGET}
          />
        </Suspense>
      </Canvas>

      {isEditMode && (
        <HintOverlay>Click on the model to add hotspots</HintOverlay>
      )}
    </CanvasContainer>
  );
};
