import { useGLTF } from "@react-three/drei";
import { BRAIN_POSITION, BRAIN_SCALE } from "@n-apt/consts";

function Brain({ children }: { children?: React.ReactNode }) {
  const { scene } = useGLTF("/glb_models/brain.glb");
  return (
    <primitive object={scene} position={BRAIN_POSITION} scale={BRAIN_SCALE}>
      {children}
    </primitive>
  );
}

export default Brain;
