// Brain component migrated from TypeScript to ReScript
// A React Three Fiber component that loads and renders a 3D brain model

// External bindings for @react-three/drei useGLTF hook
// The hook returns an object with a "scene" property
@module("@react-three/drei")
external useGLTF: string => {"scene": 'a} = "useGLTF"

<<<<<<< /Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/components/Brain.res
// Use React.createElement to create primitive element
// primitive is a JSX intrinsic element in R3F
external createElement: (string, {..}) => React.element = "React.createElement"
=======
// Primitive component - this is a special R3F component
// We need to use React.createElement with the string "primitive"
@module("react")
external reactCreateElement: (string, {..}) => React.element = "createElement"
>>>>>>> /Users/ceanelamerez/.windsurf/worktrees/n-apt/n-apt-f9290f05/src/components/Brain.res

@react.component
let make = () => {
  let gltf = useGLTF("/src/glb_models/brain.glb")
<<<<<<< /Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/components/Brain.res
  createElement("primitive", {
=======
  reactCreateElement("primitive", {
>>>>>>> /Users/ceanelamerez/.windsurf/worktrees/n-apt/n-apt-f9290f05/src/components/Brain.res
    "object": gltf["scene"],
    "position": [0.14, 1.09, 0.25],
    "scale": [0.45, 0.45, 0.45],
  })
}

let default = make
