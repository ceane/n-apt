import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

export function SignalLine({ width = 200, areaPositions = [] }: { width?: number, areaPositions?: number[] }) {
  const points = useMemo(() => {
    const pts = [];
    const numPoints = 4000;
    for (let i = 0; i < numPoints; i++) {
      const t = i / numPoints;
      const x = (t - 0.5) * width;

      // Baseline noise
      let y = Math.random() * 0.08 + 0.02;

      // Synthesize the N-APT signal pattern based on the SVG characteristics
      // 1. Dense minor peaks (high frequency)
      y += Math.pow(Math.sin(t * Math.PI * 800), 10) * 0.15;

      // 2. Medium regular peaks
      y += Math.pow(Math.sin(t * Math.PI * 200), 40) * 0.4;

      // 3. Major regular peaks (the deep spikes in the SVG)
      y += Math.pow(Math.sin(t * Math.PI * 60), 150) * 1.2;

      // Major peaks at area positions (to highlight the sections)
      const addPeak = (px: number, height: number, widthFactor: number) => {
        const dist = Math.abs(x - px);
        if (dist < 3) {
          const envelope = Math.exp(-Math.pow(dist * widthFactor, 2));
          y += envelope * height;
          // Add some high-frequency modulation to the peak
          y += envelope * Math.pow(Math.sin(dist * 50), 2) * height * 0.6;
        }
      };

      // Generate a peak for each area
      areaPositions.forEach((px, index) => {
        // Pseudo-random height and width based on index
        const height = 1.0 + (Math.sin(index * 123.45) * 0.5 + 0.5) * 1.2;
        const widthFactor = 1.5 + (Math.cos(index * 67.89) * 0.5 + 0.5) * 1.5;
        addPeak(px, height, widthFactor);
      });

      pts.push(new THREE.Vector3(x, y, 0));
    }
    return pts;
  }, [width, areaPositions]);

  const fillGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.length * 6);
    for (let i = 0; i < points.length; i++) {
      // Bottom point
      vertices[i * 6] = points[i].x;
      vertices[i * 6 + 1] = -20; // extend way down
      vertices[i * 6 + 2] = 0;
      // Top point
      vertices[i * 6 + 3] = points[i].x;
      vertices[i * 6 + 4] = points[i].y;
      vertices[i * 6 + 5] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const indices = [];
    for (let i = 0; i < points.length - 1; i++) {
      const i2 = i * 2;
      indices.push(i2, i2 + 1, i2 + 2);
      indices.push(i2 + 1, i2 + 3, i2 + 2);
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [points]);

  return (
    <group position={[0, -2, 0]}>
      <Line
        points={points}
        color="#60A5FA"
        lineWidth={1.5}
      />
      <mesh geometry={fillGeometry}>
        <meshBasicMaterial color="#DBEAFE" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function DashedLine({ activeX }: { activeX: number }) {
  const lineRef = useRef<THREE.Group>(null);
  const currentX = useRef(activeX);

  useFrame((_state, delta) => {
    currentX.current = THREE.MathUtils.damp(currentX.current, activeX, 6, delta);
    if (lineRef.current) {
      lineRef.current.position.x = currentX.current;
    }
  });

  const points = [new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, 0, 0)];

  return (
    <group ref={lineRef}>
      <Line
        points={points}
        color="#111827"
        lineWidth={1.5}
        dashed={true}
        dashScale={1}
        dashSize={0.2}
        gapSize={0.2}
      />
    </group>
  );
}

export default function SignalMockupCanvas() {
  return (
    <div className="w-full h-full bg-gray-50 rounded-lg overflow-hidden">
      <div className="w-full h-full">
        {/* This would need to be wrapped in a Canvas component from @react-three/fiber */}
        {/* For now, returning a placeholder that shows the component structure */}
        <div className="p-4 text-center">
          <h3 className="text-lg font-semibold mb-2">Signal Mockup Canvas</h3>
          <p className="text-sm text-gray-600">
            This component requires Three.js Canvas wrapper to render 3D signals.
            It displays N-APT signal patterns with interactive highlighting.
          </p>
          <div className="mt-4 text-xs text-gray-500">
            Features: Dense minor peaks, medium regular peaks, major spikes, and area-based highlighting
          </div>
        </div>
      </div>
    </div>
  );
}
