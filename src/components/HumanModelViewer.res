// HumanModelViewer component migrated from TypeScript to ReScript
// A React Three Fiber component that displays a 3D human model with interactive body area selection

// External bindings for React Three Fiber
module Canvas = {
  @module("@react-three/fiber") @react.component
  external make: (
    ~style: ReactDOM.Style.t=?,
    ~camera: {"position": (float, float, float), "fov": int}=?,
    ~children: React.element,
  ) => React.element = "Canvas"
}

// External bindings for @react-three/drei
module OrbitControls = {
  @module("@react-three/drei") @react.component
  external make: (~ref: ReactDOM.domRef=?) => React.element = "OrbitControls"
}

module TransformControls = {
  @module("@react-three/drei") @react.component
  external make: (~mode: string=?, ~children: React.element) => React.element = "TransformControls"
}

@module("@react-three/drei")
external useGLTF: string => {"scene": 'a} = "useGLTF"

// Three.js bindings
module Three = {
  type mesh
  type material
  type color

  @new @module("three")
  external color: (int, int, int) => color = "Color"

  @module("three")
  external mesh: mesh = "Mesh"
}

// GSAP bindings
module Gsap = {
  type tween

  @module("gsap")
  external to_: ('a, {"x": float, "y": float, "z": float, "duration": float}) => tween = "to"

  @module("gsap")
  external toWithUpdate: (
    'a,
    {"x": float, "y": float, "z": float, "duration": float, "onUpdate": unit => unit},
  ) => tween = "to"
}

// Area type for body regions
type area = {
  name: string,
  position: (float, float, float),
  target: (float, float, float),
  meshName: string,
}

// Define body areas
let areas: array<area> = [
  {name: "Head", position: (0.0, 1.0, 0.2), target: (0.0, 1.0, 0.0), meshName: "head"},
  {name: "Throat", position: (0.0, 1.2, 0.2), target: (0.0, 1.2, 0.0), meshName: "throat"},
  {name: "Mouth", position: (0.0, 1.4, 0.2), target: (0.0, 1.4, 0.0), meshName: "mouth"},
  {name: "Torso", position: (0.0, 0.0, 0.2), target: (0.0, 0.0, 0.0), meshName: "torso"},
  {name: "Heart", position: (0.0, 0.5, 0.2), target: (0.0, 0.5, 0.0), meshName: "heart"},
  {name: "Left Arm", position: (-0.5, 0.0, 0.2), target: (-0.5, 0.0, 0.0), meshName: "left_arm"},
  {name: "Right Arm", position: (0.5, 0.0, 0.2), target: (0.5, 0.0, 0.0), meshName: "right_arm"},
  {name: "Left Leg", position: (-0.3, -1.0, 0.2), target: (-0.3, -1.0, 0.0), meshName: "left_leg"},
  {name: "Right Leg", position: (0.3, -1.0, 0.2), target: (0.3, -1.0, 0.0), meshName: "right_leg"},
]

// Brain component binding
module Brain = {
  @module("./Brain.res.mjs") @react.component
  external make: unit => React.element = "make"
}

// Import createElement from react module for R3F intrinsic elements
@module("react")
external reactCreateElement: (string, {..}) => React.element = "createElement"

// Model component that loads and renders the 3D human model
module Model = {
  @react.component
  let make = (~selectedArea: option<area>) => {
    let gltf = useGLTF("/src/glb_models/androgynous_body.glb")

    React.useEffect2(() => {
      // Log mesh names and set head transparency
      // Note: In ReScript, we'd need more complex bindings to traverse the scene
      // For now, we'll rely on the scene being properly set up
      None
    }, (gltf["scene"], selectedArea))

    reactCreateElement("primitive", {"object": gltf["scene"]})
  }
}

// Three.js JSX elements - these are lowercase intrinsic elements in R3F
// Created using the imported createElement function
module Lights = {
  let ambient = () => reactCreateElement("ambientLight", {"intensity": 0.5})
  let directional = () => reactCreateElement("directionalLight", {"position": [10.0, 10.0, 5.0], "intensity": 1.0})
}

@react.component
let make = (~width: string="100%", ~height: string="100%") => {
  let (selectedArea, setSelectedArea) = React.useState(() => None)
  // Using a generic ref type for OrbitControls which has object, target, and update properties
  let controlsRef: React.ref<Js.Nullable.t<{..}>> = React.useRef(Js.Nullable.null)

  // Animate camera when area is selected
  React.useEffect1(() => {
    switch (selectedArea, Js.Nullable.toOption(controlsRef.current)) {
    | (Some(area), Some(controls)) =>
      let (px, py, pz) = area.position
      let (tx, ty, tz) = area.target

      // Animate camera position
      let _ = Gsap.to_(
        controls["object"]["position"],
        {"x": px, "y": py, "z": pz, "duration": 1.0},
      )

      // Animate camera target with update callback
      let _ = Gsap.toWithUpdate(controls["target"], {
        "x": tx,
        "y": ty,
        "z": tz,
        "duration": 1.0,
        "onUpdate": () => {
          controls["update"](.)
        },
      })
      ()
    | _ => ()
    }
    None
  }, [selectedArea])

  // Styles
  let containerStyle = ReactDOM.Style.make(~position="relative", ~width, ~height, ())

  let sidebarStyle = ReactDOM.Style.make(
    ~position="absolute",
    ~left="0",
    ~top="0",
    ~width="200px",
    ~height="100%",
    ~background="rgba(0,0,0,0.8)",
    ~color="white",
    ~padding="10px",
    ~zIndex="1",
    (),
  )

  let buttonStyle = ReactDOM.Style.make(
    ~display="block",
    ~margin="5px 0",
    ~width="100%",
    ~padding="8px",
    ~backgroundColor="#333",
    ~color="white",
    ~border="1px solid #555",
    ~borderRadius="4px",
    ~cursor="pointer",
    (),
  )

  let canvasStyle = ReactDOM.Style.make(
    ~position="absolute",
    ~left="200px",
    ~width="calc(100% - 200px)",
    ~height="100%",
    (),
  )

  <div style={containerStyle}>
    <div style={sidebarStyle}>
      <h3> {React.string("Body Areas")} </h3>
      {areas
      ->Belt.Array.map(area => {
        <button
          key={area.name}
          onClick={_ => setSelectedArea(_ => Some(area))}
          style={buttonStyle}>
          {React.string(area.name)}
        </button>
      })
      ->React.array}
    </div>
    <Canvas
      style={canvasStyle}
      camera={{"position": (0.0, 0.0, 5.0), "fov": 75}}>
      <React.Suspense fallback={React.null}>
        {Lights.ambient()}
        {Lights.directional()}
        <TransformControls mode="translate">
          <Model selectedArea />
        </TransformControls>
        <Brain />
        <OrbitControls ref={Obj.magic(controlsRef)} />
      </React.Suspense>
    </Canvas>
  </div>
}

let default = make
