import { useGLTF } from "@react-three/drei";
import { BRAIN_POSITION, BRAIN_SCALE } from "@n-apt/consts";
import { BRAIN_GLB_URL } from "@n-apt/components/3D/modelAssetUrls";

function Brain({
  children,
  position = BRAIN_POSITION,
  scale = BRAIN_SCALE,
  rotation = [0, 0, 0] as const,
}: {
  children?: React.ReactNode;
  position?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
}) {
  const { scene } = useGLTF(BRAIN_GLB_URL);
  return (
    <primitive
      object={scene}
      position={position}
      scale={scale}
      rotation={rotation}
    >
      {children}
    </primitive>
  );
}

export default Brain;
