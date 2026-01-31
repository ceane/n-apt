// Brain component migrated from TypeScript to ReScript
// A React Three Fiber component that loads and renders a 3D brain model

// External bindings for @react-three/drei useGLTF hook
// The hook returns an object with a "scene" property
@module("@react-three/drei")
external useGLTF: string => {"scene": 'a} = "useGLTF"

// Primitive component - this is a special R3F component
// We need to use React.createElement with the string "primitive"
@module("react")
external reactCreateElement: (string, {..}) => React.element = "createElement"

@react.component
let make = () => {
  let gltf = useGLTF("/src/glb_models/brain.glb")
  reactCreateElement("primitive", {
    "object": gltf["scene"],
    "position": [0.14, 1.09, 0.25],
    "scale": [0.45, 0.45, 0.45],
  })
}

let default = make
