import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float, Stars } from '@react-three/drei';
import * as THREE from 'three';

const coronaVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const coronaFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;

  //
  // Description : Array and textureless GLSL 2D/3D/4D simplex 
  //               noise functions.
  //      Author : Ian McEwan, Ashima Arts.
  //  Maintainer : stegu
  //     Lastmod : 20110822 (ijm)
  //     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
  //               Distributed under the MIT License. See LICENSE file.
  //               https://github.com/ashima/webgl-noise
  //               https://github.com/stegu/webgl-noise
  // 

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) { 
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 =   v - i + dot(i, C.xxx) ;

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    vec2 center = vec2(0.5);
    vec2 pos = vUv - center;
    float dist = length(pos);
    float angle = atan(pos.y, pos.x);

    // Corona parameters
    float moonRadius = 0.2;
    
    // Layered noise for realistic wisps
    float n1 = snoise(vec3(pos * 3.0, uTime * 0.05));
    float n2 = snoise(vec3(pos * 8.0, uTime * 0.15));
    float n3 = snoise(vec3(pos * 20.0, uTime * 0.4));
    
    // Base glow falloff (inverse square-ish)
    float baseGlow = pow(moonRadius / dist, 3.0) * 0.2;
    
    // Asymmetric plumes (longer on vertical axis as seen in many photos)
    float plumeAsymmetry = abs(sin(angle)) * 0.5 + 0.5;
    
    // Large scale structures (plumes)
    float plumeFreq = 8.0;
    float plumeNoise = snoise(vec3(angle * 2.0, uTime * 0.05, 0.0));
    float plumes = pow(max(0.0, sin(angle * 3.0 + plumeNoise)), 4.0) * 0.5;
    plumes += pow(max(0.0, sin(angle * 7.0 - plumeNoise * 2.0)), 6.0) * 0.3;
    plumes *= exp(-dist * 1.5) * plumeAsymmetry;

    // Fine streamers
    float streamers = pow(max(0.0, snoise(vec3(angle * 15.0, dist * 2.0, uTime * 0.2))), 3.0) * 0.8;
    streamers *= smoothstep(moonRadius, moonRadius + 0.1, dist) * exp(-dist * 2.5);

    // Dynamic outbursts (flashes)
    float burstNoise = snoise(vec3(angle * 5.0, uTime * 1.2, 0.0));
    float bursts = pow(max(0.0, burstNoise), 15.0) * 6.0;
    bursts *= smoothstep(moonRadius, moonRadius + 0.15, dist) * exp(-dist * 4.0);

    // The "Ring of Light" - very bright inner edge
    float innerEdge = smoothstep(moonRadius + 0.005, moonRadius, dist) * smoothstep(moonRadius - 0.005, moonRadius, dist) * 15.0;
    // Outer glow of the ring
    float innerGlow = exp(-(dist - moonRadius) * 40.0) * 2.0;

    // Combine everything
    float finalStrength = baseGlow + (plumes * 1.5) + (streamers * 1.0) + (bursts * 3.0) + innerGlow;
    
    // Overall fade
    finalStrength *= smoothstep(0.8, 0.2, dist);

    // Color mixing
    vec3 baseCol = uColor;
    vec3 hotCol = vec3(1.0, 1.0, 1.0); // Pure white for brightest parts
    
    vec3 finalColor = baseCol * finalStrength;
    finalColor = mix(finalColor, hotCol, pow(innerGlow * 0.5, 2.0));
    finalColor += hotCol * innerEdge;
    finalColor += hotCol * bursts * finalStrength;

    // Prominences (red solar flares at edge)
    float promNoise = snoise(vec3(angle * 10.0, uTime * 0.05, 0.0));
    float prominence = pow(max(0.0, promNoise), 40.0) * 20.0;
    prominence *= (1.0 - smoothstep(moonRadius + 0.015, moonRadius, dist)) * smoothstep(moonRadius - 0.005, moonRadius, dist);
    finalColor += vec3(1.0, 0.2, 0.1) * prominence;

    // Hard cutoff for the moon
    float mask = smoothstep(moonRadius - 0.002, moonRadius, dist);
    finalColor *= mask;
    float alpha = clamp(finalStrength * mask, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export function Corona() {
  const mesh = useRef<THREE.Mesh>(null!);
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0.85, 0.92, 1.0) } // Crisp silvery blue-white
  }), []);

  useFrame((state) => {
    if (mesh.current) {
      const { clock } = state;
      (mesh.current.material as THREE.ShaderMaterial).uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  return (
    <mesh ref={mesh} scale={[18, 18, 1]}>
      <planeGeometry args={[1, 1, 64, 64]} />
      <shaderMaterial
        vertexShader={coronaVertexShader}
        fragmentShader={coronaFragmentShader}
        uniforms={uniforms}
        transparent={true}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

export function Moon() {
  return (
    <mesh position={[0, 0, 0.01]}>
      <circleGeometry args={[2.98, 64]} />
      <meshBasicMaterial color="#020202" />
    </mesh>
  );
}

export const Background = () => {
    return (
        <group>
            <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
            <mesh position={[0, 0, -20]}>
                <sphereGeometry args={[70, 32, 32]} />
                <meshBasicMaterial color="#020202" side={THREE.BackSide} />
            </mesh>
        </group>
    )
}

export function CoronaScene() {
  return (
    <>
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.5} />

      <Float speed={0.8} rotationIntensity={0.2} floatIntensity={0.2}>
        <group>
          <Corona />
          <Moon />
        </group>
      </Float>

      <Background />
    </>
  );
}

export default function App() {
  return (
    <div className="w-full h-screen bg-black overflow-hidden flex flex-col relative">
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 10], fov: 60 }}>
          <CoronaScene />
          
          <OrbitControls 
            enablePan={false} 
            enableZoom={true} 
            minDistance={5} 
            maxDistance={30}
            rotateSpeed={0.5}
          />
        </Canvas>
      </div>
    </div>
  );
}
