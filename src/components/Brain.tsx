import React from 'react';
import { useGLTF } from '@react-three/drei';

function Brain() {
  const { scene } = useGLTF('/src/glb_models/brain.glb');
  return <primitive object={scene} position={[0.144, 1.17, .25]} scale={[0.45, 0.45, 0.45]} />;
}

export default Brain;