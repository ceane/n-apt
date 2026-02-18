import React, { useRef, useCallback } from "react";
import styled from "styled-components";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Vector3, Vector2, Raycaster } from "three";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import { MODEL_CAMERA_POSITION, MODEL_FOV } from "@n-apt/consts";

function ClickHandler({ onAddHotspot }: { onAddHotspot: (point: Vector3) => void }) {
  const { camera, gl, scene } = useThree();
  const raycaster = useRef(new Raycaster());

  const handleClick = useCallback(
    (event: any) => {
      try {
        const rect = gl.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.current.setFromCamera(new Vector2(x, y), camera);

        const intersects = raycaster.current.intersectObjects(scene.children, true);

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

function Model({ onAddHotspot }: { onAddHotspot: (point: Vector3) => void }) {
  const { scene } = useGLTF("/glb_models/androgynous_body.glb");

  return (
    <>
      <primitive object={scene} />
      <ClickHandler onAddHotspot={onAddHotspot} />
    </>
  );
}

function HotspotMarker({
  hotspot,
  onClick,
  onDelete,
  onRename,
  isSelected,
  isMultiSelected,
}: {
  hotspot: any;
  onClick: () => void;
  onDelete: () => void;
  onRename: (id: string, newName: string) => void;
  isSelected: boolean;
  isMultiSelected: boolean;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(hotspot.name);

  const handleRename = () => {
    if (editName.trim()) {
      onRename(hotspot.id, editName.trim());
    }
    setIsEditing(false);
  };

  const size = hotspot.size === "large" ? 0.08 : 0.02;
  const baseColor = hotspot.size === "large" ? "#00d4ff" : "#ffaa00";
  const color = isMultiSelected ? "#ff6b6b" : isSelected ? "#ffffff" : baseColor;

  return (
    <group position={hotspot.position}>
      <mesh onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      {isSelected && (
        <group position={[0, size + 0.05, 0]}>
          <mesh>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.8} />
          </mesh>
          <mesh
            position={[0, 0.05, 0]}
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.8} />
          </mesh>
        </group>
      )}
      {isEditing && (
        <group position={[0, size + 0.15, 0]}>
          <mesh>
            <planeGeometry args={[0.3, 0.1, 0.01]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRename();
                } else if (e.key === "Escape") {
                  setIsEditing(false);
                  setEditName(hotspot.name);
                }
              }}
              onBlur={handleRename}
              style={{
                position: "absolute",
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: "10px",
                textAlign: "center",
                width: "100%",
                outline: "none",
              }}
              autoFocus
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
`;

interface HotspotEditorSimpleProps {
  width?: string | number;
  height?: string | number;
}

export const HotspotEditorSimple: React.FC<HotspotEditorSimpleProps> = ({
  width = "100%",
  height = "100%",
}) => {
  const {
    hotspots,
    selectedHotspot,
    showGrid,
    handleAddHotspot,
    handleHotspotClick,
    handleDeleteHotspot,
    handleRename,
  } = useHotspotEditor();

  return (
    <CanvasContainer style={{ width, height }}>
      <Canvas
        style={{
          width: "100%",
          height: "100%",
        }}
        camera={{ position: MODEL_CAMERA_POSITION, fov: MODEL_FOV }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />

        {showGrid && <gridHelper args={[10, 10, "#333", "#222"]} position={[0, -1, 0]} />}

        <Model onAddHotspot={handleAddHotspot} />

        {hotspots.map((hotspot) => (
          <HotspotMarker
            key={hotspot.id}
            hotspot={hotspot}
            onClick={() => handleHotspotClick(hotspot.id)}
            onDelete={() => handleDeleteHotspot(hotspot.id)}
            onRename={handleRename}
            isSelected={selectedHotspot === hotspot.id}
            isMultiSelected={false}
          />
        ))}

        <OrbitControls />
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          background: "rgba(0, 0, 0, 0.8)",
          color: "#fff",
          padding: "10px",
          borderRadius: "4px",
          fontSize: "14px",
        }}
      >
        Click on the model to add hotspots
      </div>
    </CanvasContainer>
  );
};
