import React, { Suspense, useRef, useCallback } from "react";
import styled from "styled-components";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, TransformControls } from "@react-three/drei";
import { Vector3 } from "three";
import Brain from "@n-apt/components/Brain";
import { HorizonFocusGlobe } from "./HorizonFocusGlobe";
import { useModel3D, type Area } from "@n-apt/hooks/useModel3D";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import {
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
  MODEL_FOV,
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_COLOR,
  SPHERE_MARKER_BASE_INTENSITY,
} from "@n-apt/consts";
import { useTheme } from "styled-components";

// ClickHandler is no longer needed as we use onPointerDown on the mesh directly


function AreaMarker({ selectedArea }: { selectedArea: Area }) {
  return (
    <group position={selectedArea.target}>
      <mesh>
        <sphereGeometry
          args={[0.1, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
        />
        <meshStandardMaterial
          color={SPHERE_MARKER_COLOR}
          emissive={SPHERE_MARKER_COLOR}
          emissiveIntensity={
            selectedArea.name === "Head" ? 0 : SPHERE_MARKER_BASE_INTENSITY
          }
          transparent
          opacity={selectedArea.name === "Head" ? 0 : 0.4}
        />
      </mesh>
      <mesh>
        <sphereGeometry
          args={[0.15, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
        />
        <meshStandardMaterial
          color={SPHERE_MARKER_COLOR}
          emissive={SPHERE_MARKER_COLOR}
          emissiveIntensity={0.4}
          transparent
          opacity={0.2}
        />
      </mesh>
      <mesh>
        <sphereGeometry
          args={[0.2, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
        />
        <meshStandardMaterial
          color={SPHERE_MARKER_COLOR}
          emissive={SPHERE_MARKER_COLOR}
          emissiveIntensity={0.2}
          transparent
          opacity={0.1}
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
  const { scene } = useGLTF("/glb_models/androgynous_body.glb");
  const groupRef = useRef<any>(null);

  const onPointerDown = useCallback((e: any) => {
    if (!isEditMode) return;
    e.stopPropagation();
    if (groupRef.current) {
      // Find the body mesh to ensure we hit it specifically
      if (e.object.name === "o_ADBody") {
        // Convert world hit point to local point relative to the container group
        const localPoint = groupRef.current.worldToLocal(e.point.clone());
        onAddHotspot(localPoint);
      }
    }
  }, [isEditMode, onAddHotspot]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} onPointerDown={onPointerDown} />
      {selectedArea && <AreaMarker selectedArea={selectedArea} />}
      {children}
    </group>
  );
}

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
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
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />

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
