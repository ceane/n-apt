import { useGLTF } from "@react-three/drei";
import { BRAIN_POSITION, BRAIN_SCALE } from "@n-apt/consts";
import { BRAIN_GLB_URL } from "@n-apt/components/3D/modelAssetUrls";

function Brain({ children }: { children?: React.ReactNode }) {
  const { scene } = useGLTF(BRAIN_GLB_URL);
  return (
    <primitive object={scene} position={BRAIN_POSITION} scale={BRAIN_SCALE}>
      {children}
    </primitive>
  );
}

export default Brain;
