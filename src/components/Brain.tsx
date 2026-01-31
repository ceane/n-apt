import React from 'react';
import { useGLTF } from '@react-three/drei';

function Brain() {
  const { scene } = useGLTF('/src/glb_models/brain.glb');
  return <primitive object={scene} position={[0.14, 1.09, .25]} scale={[0.45, 0.45, 0.45]} />;
}

export default Brain;