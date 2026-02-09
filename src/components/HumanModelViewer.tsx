import React, { Suspense, useRef, useState, useEffect } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, useGLTF, TransformControls } from "@react-three/drei"
import { gsap } from "gsap"
import Brain from "@n-apt/components/Brain"
import {
  MODEL_CAMERA_POSITION,
  MODEL_FOV,
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_COLOR,
  SPHERE_MARKER_BASE_INTENSITY,
  CONTROL_PANEL_WIDTH,
} from "@n-apt/consts"

type Area = {
  name: string
  position: [number, number, number]
  target: [number, number, number]
  meshName: string
}

const areas: Area[] = [
  {
    name: "Head",
    position: [-0.005256929115666855, 1.888884291818077, 0.6546510577135781],
    target: [-0.0001, 1.91, 0.0196510577135781],
    meshName: "o_ADBody",
  },
  {
    name: "Face",
    position: [-0.005256929115666855, 1.888884291818077, 0.6546510577135781],
    target: [-0.005256929115666855, 1.888884291818077, 0.1546510577135781],
    meshName: "o_ADBody",
  },
  {
    name: "Throat",
    position: [0.007886413129995381, 1.7673426681304798, 0.3609346531290654],
    target: [0.007886413129995381, 1.7673426681304798, 0.0609346531290654],
    meshName: "o_ADBody",
  },
  {
    name: "Vocal Cords",
    position: [0.00, 1.79, 0.32],
    target: [0.00, 1.81, 0.06],
    meshName: "o_ADBody",
  },
  {
    name: "Arms (Left)",
    position: [-0.5112283085991381, 1.6509659003411805, 0.49878115381698285],
    target: [-0.5112283085991381, 1.6509659003411805, -0.0012188461830171526],
    meshName: "o_ADBody",
  },
  {
    name: "Arms (Right)",
    position: [0.5112283085991381, 1.6509659003411805, 0.49878115381698285],
    target: [0.5112283085991381, 1.6509659003411805, -0.0012188461830171526],
    meshName: "o_ADBody",
  },
  {
    name: "Hands (Left)",
    position: [-0.8296765632761604, 1.6325936375462096, 0.52485250831670527],
    target: [-0.8296765632761604, 1.6325936375462096, 0.02485250831670527],
    meshName: "o_ADBody",
  },
  {
    name: "Hands (Right)",
    position: [0.8296765632761604, 1.6325936375462096, 0.52485250831670527],
    target: [0.8296765632761604, 1.6325936375462096, 0.02485250831670527],
    meshName: "o_ADBody",
  },
  {
    name: "Legs (Left)",
    position: [-0.10898431768502082, 0.593799380056039, 0.58089139049060412],
    target: [-0.10898431768502082, 0.593799380056039, 0.08089139049060412],
    meshName: "o_ADBody",
  },
  {
    name: "Legs (Right)",
    position: [0.10898431768502082, 0.593799380056039, 0.58089139049060412],
    target: [0.10898431768502082, 0.593799380056039, 0.08089139049060412],
    meshName: "o_ADBody",
  },
  {
    name: "Feet (Left)",
    position: [-0.11249315323047496, 0.050075522352810875, 0.6709768440676025],
    target: [-0.11249315323047496, 0.050075522352810875, 0.1709768440676025],
    meshName: "o_ADBody",
  },
  {
    name: "Feet (Right)",
    position: [0.11249315323047496, 0.050075522352810875, 0.6709768440676025],
    target: [0.11249315323047496, 0.050075522352810875, 0.1709768440676025],
    meshName: "o_ADBody",
  },
  {
    name: "Torso",
    position: [0.0004717362772533665, 1.4813323133415635, 0.6417963311155659],
    target: [0.0004717362772533665, 1.4813323133415635, 0.1417963311155659],
    meshName: "o_ADBody",
  },
  {
    name: "Heart",
    position: [0.11913283600843724, 1.5627545966498622, 0.4164080716320717],
    target: [0.11913283600843724, 1.5627545966498622, 0.1164080716320717],
    meshName: "o_ADBody",
  },
  {
    name: "Stomach",
    position: [-0.00025375320540028945, 1.248053003421258, 0.63601507013990322],
    target: [-0.00025375320540028945, 1.248053003421258, 0.13601507013990322],
    meshName: "o_ADBody",
  },
  {
    name: "Genitals",
    position: [-0.00557629969815341, 1.018571342520556, 0.60842381567021109],
    target: [-0.00557629969815341, 1.018571342520556, 0.10842381567021109],
    meshName: "o_ADBody",
  },
  {
    name: "Buttocks",
    position: [-0.0058183104165016875, 1.047481566553317, -0.61793005855546879],
    target: [-0.0058183104165016875, 1.047481566553317, -0.11793005855546879],
    meshName: "o_ADBody",
  },
  {
    name: "Ears (Left)",
    position: [-0.08594598979516654, 1.8953312879510087, 0.521125019930469335],
    target: [-0.08594598979516654, 1.8953312879510087, 0.021125019930469335],
    meshName: "o_ADBody",
  },
  {
    name: "Ears (Right)",
    position: [0.08594598979516654, 1.8953312879510087, 0.521125019930469335],
    target: [0.08594598979516654, 1.8953312879510087, 0.021125019930469335],
    meshName: "o_ADBody",
  },
]

function Model({ selectedArea }: { selectedArea: Area | null }) {
  const { scene } = useGLTF("/glb_models/androgynous_body.glb")

  return (
    <>
      <primitive object={scene} />
      {selectedArea && (
        <group position={selectedArea.target}>
          <mesh>
            <sphereGeometry
              args={[0.1, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
            />
            <meshStandardMaterial
              color={SPHERE_MARKER_COLOR}
              emissive={SPHERE_MARKER_COLOR}
              emissiveIntensity={selectedArea.name === "Head" ? 0 : SPHERE_MARKER_BASE_INTENSITY}
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
      )}
    </>
  )
}

interface HumanModelViewerProps {
  width?: string | number
  height?: string | number
}

const HumanModelViewer: React.FC<HumanModelViewerProps> = ({
  width = "100%",
  height = "100%",
}) => {
  const [selectedArea, setSelectedArea] = useState<Area | null>(null)
  const controlsRef = useRef<any>(null)

  const panelStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: CONTROL_PANEL_WIDTH,
    height: "100%",
    color: "white",
    padding: "12px",
    zIndex: 1,
    background: "rgba(10, 10, 12, 0.78)",
    borderRight: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  }

  const listStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    overflowY: "auto",
    paddingRight: "4px",
  }

  const baseButtonStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "10px 10px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    fontSize: "13px",
    lineHeight: 1.1,
    textAlign: "left",
    cursor: "pointer",
    userSelect: "none",
    transition:
      "background 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease",
  }

  const getButtonStyle = (isSelected: boolean): React.CSSProperties => ({
    ...baseButtonStyle,
    background: isSelected ? "rgba(123, 97, 255, 0.22)" : baseButtonStyle.background,
    borderColor: (isSelected
      ? "rgba(123, 97, 255, 0.55)"
      : "rgba(255,255,255,0.10)") as React.CSSProperties["borderColor"],
    boxShadow: isSelected ? "0 0 0 1px rgba(123, 97, 255, 0.25)" : "none",
  })

  useEffect(() => {
    if (selectedArea && controlsRef.current) {
      gsap.to(controlsRef.current.object.position, {
        x: selectedArea.position[0],
        y: selectedArea.position[1],
        z: selectedArea.position[2],
        duration: 1,
      })
      gsap.to(controlsRef.current.target, {
        x: selectedArea.target[0],
        y: selectedArea.target[1],
        z: selectedArea.target[2],
        duration: 1,
        onUpdate: () => controlsRef.current.update(),
      })
    }
  }, [selectedArea])

  return (
    <div style={{ position: "relative", width, height }}>
      <div style={panelStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div
            style={{
              fontSize: "12px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.70)",
            }}
          >
            Body Areas
          </div>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.50)" }}>
            Click an area to focus the camera
          </div>
        </div>

        <div style={listStyle}>
          {areas.map((area) => {
            const isSelected = selectedArea?.name === area.name

            return (
              <button
                key={area.name}
                onClick={() => setSelectedArea(area)}
                aria-pressed={isSelected}
                style={getButtonStyle(isSelected)}
                onMouseDown={(e) => e.currentTarget.style.setProperty("transform", "scale(0.99)")}
                onMouseUp={(e) => e.currentTarget.style.removeProperty("transform")}
                onMouseLeave={(e) => e.currentTarget.style.removeProperty("transform")}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.10)"
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"
                  }
                }}
                onMouseOut={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)"
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"
                  }
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(123, 97, 255, 0.35), 0 0 0 1px rgba(123, 97, 255, 0.35) inset"
                  e.currentTarget.style.outline = "none"
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = isSelected
                    ? "0 0 0 1px rgba(123, 97, 255, 0.25)"
                    : "none"
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    aria-hidden
                    style={{
                      width: "4px",
                      height: "14px",
                      borderRadius: "999px",
                      background: isSelected
                        ? "rgba(123, 97, 255, 0.95)"
                        : "rgba(255,255,255,0.18)",
                    }}
                  />
                  <span>{area.name}</span>
                </span>

                <span
                  aria-hidden
                  style={{
                    fontSize: "14px",
                    color: isSelected ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                    transform: isSelected ? "translateX(0)" : "translateX(-2px)",
                    transition: "transform 120ms ease, color 120ms ease",
                  }}
                >
                  ›
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <Canvas
        style={{
          position: "absolute",
          left: CONTROL_PANEL_WIDTH,
          width: `calc(100% - ${CONTROL_PANEL_WIDTH})`,
          height: "100%",
        }}
        camera={{ position: MODEL_CAMERA_POSITION, fov: MODEL_FOV }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <TransformControls mode="translate">
            <Model selectedArea={selectedArea} />
          </TransformControls>
          <Brain />
          <OrbitControls ref={controlsRef} />
        </Suspense>
      </Canvas>
    </div>
  )
}

export default HumanModelViewer
