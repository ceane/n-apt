import React, { Suspense, useRef, useCallback } from "react";
import styled from "styled-components";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, TransformControls } from "@react-three/drei";
import { Vector3, Vector2, Raycaster } from "three";
import Brain from "@n-apt/components/Brain";
import { useModel3D, type Area } from "@n-apt/hooks/useModel3D";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import {
  MODEL_CAMERA_POSITION,
  MODEL_FOV,
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_COLOR,
  SPHERE_MARKER_BASE_INTENSITY,
} from "@n-apt/consts";
import { useTheme } from "styled-components";

function ClickHandler({
  onAddHotspot,
}: {
  onAddHotspot: (point: Vector3) => void;
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useRef(new Raycaster());

  const handleClick = useCallback(
    (event: any) => {
      try {
        const rect = gl.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.current.setFromCamera(new Vector2(x, y), camera);

        const intersects = raycaster.current.intersectObjects(
          scene.children,
          true,
        );

        if (intersects.length > 0) {
          const point = intersects[0].point;
          if (point && typeof point.x === "number") {
            onAddHotspot(new Vector3(point.x, point.y, point.z));
          }
        }
      } catch (error) {
        console.error("Error handling click:", error);
      }
    },
    [camera, gl, scene, onAddHotspot],
  );

  useFrame(() => {
    gl.domElement.addEventListener("click", handleClick);
    return () => {
      gl.domElement.removeEventListener("click", handleClick);
    };
  });

  return null;
}

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
}: {
  selectedArea: Area | null;
  isEditMode: boolean;
  onAddHotspot: (point: Vector3) => void;
}) {
  const { scene } = useGLTF("/glb_models/androgynous_body.glb");

  return (
    <>
      <primitive object={scene} />
      {selectedArea && <AreaMarker selectedArea={selectedArea} />}
      {isEditMode && <ClickHandler onAddHotspot={onAddHotspot} />}
    </>
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
            <gridHelper args={[10, 10, "#333", "#222"]} position={[0, -1, 0]} />
          )}

          <TransformControls mode="translate">
            <Model
              selectedArea={selectedArea}
              isEditMode={isEditMode}
              onAddHotspot={handleAddHotspot}
            />
          </TransformControls>

          <Brain />

          {hotspots.map((hotspot) => (
            <HotspotMarker
              key={hotspot.id}
              hotspot={hotspot}
              onClick={() => handleHotspotClick(hotspot.id)}
              isSelected={selectedHotspot === hotspot.id}
              isMultiSelected={multiSelectedHotspots.includes(hotspot.id)}
            />
          ))}

          <OrbitControls ref={controlsRef} makeDefault enableDamping />
        </Suspense>
      </Canvas>

      {isEditMode && (
        <HintOverlay>Click on the model to add hotspots</HintOverlay>
      )}
    </CanvasContainer>
  );
};
