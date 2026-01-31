import React, { Suspense, useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, TransformControls } from '@react-three/drei';
import { Color, Mesh } from 'three';
import { gsap } from 'gsap';
import Brain from './Brain';

type Area = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
};

const areas: Area[] = [
  { name: "Head", position: [0, 1, 0.2], target: [0, 1, 0], meshName: "head" },
  { name: "Throat", position: [0, 1.2, 0.2], target: [0, 1.2, 0], meshName: "throat" },
  { name: "Mouth", position: [0, 1.4, 0.2], target: [0, 1.4, 0], meshName: "mouth" },
  { name: "Torso", position: [0, 0, 0.2], target: [0, 0, 0], meshName: "torso" },
  { name: "Heart", position: [0, 0.5, 0.2], target: [0, 0.5, 0], meshName: "heart" },
  { name: "Left Arm", position: [-0.5, 0, 0.2], target: [-0.5, 0, 0], meshName: "left_arm" },
  { name: "Right Arm", position: [0.5, 0, 0.2], target: [0.5, 0, 0], meshName: "right_arm" },
  { name: "Left Leg", position: [-0.3, -1, 0.2], target: [-0.3, -1, 0], meshName: "left_leg" },
  { name: "Right Leg", position: [0.3, -1, 0.2], target: [0.3, -1, 0], meshName: "right_leg" },
];

function Model({ selectedArea }: { selectedArea: Area | null }) {
  const { scene } = useGLTF('/src/glb_models/androgynous_body.glb');

  useEffect(() => {
    console.log('Mesh names:');
    scene.traverse((child) => {
      if (child instanceof Mesh) {
        console.log(child.name);
        if (child.name.toLowerCase().includes('head')) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              mat.transparent = true;
              mat.opacity = 0.3;
            });
          } else {
            child.material.transparent = true;
            child.material.opacity = 0.3;
          }
        }
        // Uncomment below for highlighting
        // child.material.emissive = new Color(0, 0, 0);
      }
    });
    // if (selectedArea) {
    //   scene.traverse((child) => {
    //     if (child instanceof Mesh && child.name.includes(selectedArea.meshName)) {
    //       child.material.emissive = new Color(1, 0, 0);
    //     }
    //   });
    // }
  }, [scene, selectedArea]);

  return <primitive object={scene} />;
}

interface HumanModelViewerProps {
  width?: string | number;
  height?: string | number;
}

const HumanModelViewer: React.FC<HumanModelViewerProps> = ({
  width = '100%',
  height = '100%'
}) => {
  const [selectedArea, setSelectedArea] = useState<Area | null>(null);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (selectedArea && controlsRef.current) {
      gsap.to(controlsRef.current.object.position, { x: selectedArea.position[0], y: selectedArea.position[1], z: selectedArea.position[2], duration: 1 });
      gsap.to(controlsRef.current.target, { x: selectedArea.target[0], y: selectedArea.target[1], z: selectedArea.target[2], duration: 1, onUpdate: () => controlsRef.current.update() });
    }
  }, [selectedArea]);

  return (
    <div style={{ position: 'relative', width, height }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: '200px', height: '100%', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px', zIndex: 1 }}>
        <h3>Body Areas</h3>
        {areas.map(area => <button key={area.name} onClick={() => setSelectedArea(area)} style={{ display: 'block', margin: '5px 0', width: '100%' }}>{area.name}</button>)}
      </div>
      <Canvas
        style={{ position: 'absolute', left: '200px', width: `calc(100% - 200px)`, height: '100%' }}
        camera={{ position: [0, 0, 5], fov: 75 }}
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
  );
};

export default HumanModelViewer;