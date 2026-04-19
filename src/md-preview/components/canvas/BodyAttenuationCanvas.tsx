import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import styled from "styled-components";
import * as THREE from "three";
import { CanvasText } from "@n-apt/md-preview/CanvasText";
import { assetImageUrl } from "@n-apt/md-preview/utils/asset-helpers";
const BODY_CHARACTER_SRC = assetImageUrl("body-attenuation-character.png");



const DEFAULTS = {
  transmitPowerDbm: -8,
  receivePowerDbm: -52,
  skinThicknessCm: 0.22,
  skullThicknessCm: 0.68,
  frequencyHz: 1.618e6,
  referenceFrequencyHz: 1e6,
  exponent: 0.5,
  skinLossRefDbPerCm: 1.1,
  skullLossRefDbPerCm: 2.35,
  mediumLossRefDbPerCm: 0.09,
  minDistanceCm: 3000,
  maxDistanceCm: 50000,
};

const CHARACTER_SIZE = {
  width: 2.91, // 5.32 * (520/951) ≈ 2.91
  height: 5.32,
};

const FLIP_EFFECT_DURATION_MS = 1100;

const peelVertexShader = `
  uniform float uProgress;
  uniform float uDirection;
  uniform float uLift;
  uniform float uCurlStrength;

  varying vec2 vUv;
  varying float vPeel;

  void main() {
    vUv = uv;

    float peelEdge = uDirection > 0.0 ? uv.x : 1.0 - uv.x;
    float edgeWindow = pow(clamp(peelEdge, 0.0, 1.0), 0.72);
    float verticalWindow = pow(sin(uv.y * 3.14159265), 0.8);
    float progressWindow = pow(sin(uProgress * 3.14159265), 0.82);
    float peel = edgeWindow * verticalWindow * progressWindow;
    float hingeBias = smoothstep(0.08, 0.88, peelEdge);

    vec3 transformedPosition = position;
    transformedPosition.z += peel * uLift + hingeBias * uCurlStrength * 0.22;
    transformedPosition.x += uDirection * peel * (0.24 + uCurlStrength * 0.32);
    transformedPosition.y += peel * peel * (0.14 + uCurlStrength * 0.22);

    vPeel = peel;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
  }
`;

const shimmerFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uProgress;
  uniform float uGleamStrength;

  varying vec2 vUv;
  varying float vPeel;

  vec3 rainbowGradient(float t) {
    vec3 pink = vec3(1.0, 0.33, 0.76);
    vec3 violet = vec3(0.72, 0.42, 1.0);
    vec3 cyan = vec3(0.25, 0.9, 1.0);
    vec3 lime = vec3(0.9, 1.0, 0.42);
    vec3 gold = vec3(1.0, 0.82, 0.34);

    if (t < 0.25) {
      return mix(pink, violet, smoothstep(0.0, 0.25, t));
    }

    if (t < 0.5) {
      return mix(violet, cyan, smoothstep(0.25, 0.5, t));
    }

    if (t < 0.75) {
      return mix(cyan, lime, smoothstep(0.5, 0.75, t));
    }

    return mix(lime, gold, smoothstep(0.75, 1.0, t));
  }

  void main() {
    vec4 sampleColor = texture2D(uTexture, vUv);
    if (sampleColor.a < 0.01) {
      discard;
    }

    float t = uProgress * 6.2831853;
    float yCurve = pow(abs(vUv.y - 0.5) * 2.0, 1.9);
    float archCenter = 0.22 + 0.10 * yCurve + 0.008 * sin(t * 0.21);
    float archBand = exp(-pow((vUv.x - archCenter) * 5.8, 2.0));
    float innerGlow = exp(-pow((vUv.x - (archCenter - 0.035)) * 10.0, 2.0));
    float outerGlow = exp(-pow((vUv.x - (archCenter + 0.04)) * 8.2, 2.0));

    float rippleA = sin(vUv.x * 10.0 + vUv.y * 4.0 + t * 0.22);
    float rippleB = sin(vUv.x * 5.0 - vUv.y * 7.5 - t * 0.14);
    float rippleC = sin(vUv.x * 2.8 + vUv.y * 11.0 + t * 0.08);
    float ripple = 0.5 + 0.10 * rippleA + 0.07 * rippleB + 0.05 * rippleC;
    float peelMask = smoothstep(0.03, 0.2, vPeel);
    float edgeGlow = pow(1.0 - clamp(abs(vUv.y - 0.5) * 1.8, 0.0, 1.0), 3.2);
    float fresnel = pow(edgeGlow, 1.6);
    float highlight = pow(clamp(ripple, 0.0, 1.0), 2.8) * (0.12 + fresnel * 0.32);
    float shimmerShape = (archBand * 0.46 + innerGlow * 0.24 + outerGlow * 0.20 + highlight * 0.28) * peelMask;
    float alphaMask = sampleColor.a * uGleamStrength;

    vec3 paperShadow = vec3(0.80, 0.82, 0.84);
    vec3 paperMid = vec3(0.88, 0.90, 0.92);
    vec3 paperLight = vec3(0.95, 0.96, 0.97);
    vec3 tint = mix(paperShadow, paperMid, clamp(archBand * 0.75 + ripple * 0.20, 0.0, 1.0));
    tint = mix(tint, paperLight, fresnel * 0.24 + highlight * 0.42);

    float alpha = clamp((0.035 + shimmerShape * 0.20 + fresnel * 0.08) * alphaMask, 0.0, 0.34);
    vec3 color = tint * (0.74 + shimmerShape * 0.18) + paperLight * (fresnel * 0.10 + highlight * 0.12);
    color *= smoothstep(0.0, 0.02, sampleColor.a);

    gl_FragColor = vec4(color, alpha);
  }
`;

const peelFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uProgress;
  uniform float uGleamStrength;

  varying vec2 vUv;
  varying float vPeel;

  vec3 iridescentGradient(float t) {
    vec3 white = vec3(1.0, 1.0, 1.0);
    vec3 pearl = vec3(0.95, 0.92, 1.0);
    vec3 silver = vec3(0.88, 0.90, 0.94);
    vec3 blush = vec3(1.0, 0.94, 0.96);
    vec3 ice = vec3(0.92, 0.97, 1.0);

    if (t < 0.25) return mix(white, pearl, smoothstep(0.0, 0.25, t));
    if (t < 0.5) return mix(pearl, ice, smoothstep(0.25, 0.5, t));
    if (t < 0.75) return mix(ice, blush, smoothstep(0.5, 0.75, t));
    return mix(blush, silver, smoothstep(0.75, 1.0, t));
  }

  void main() {
    vec4 sampleColor = texture2D(uTexture, vUv);
    float alphaFactor = smoothstep(0.0, 0.02, sampleColor.a);

    float peelMask = smoothstep(0.02, 0.18, vPeel);
    float edgeLight = pow(clamp(vPeel, 0.0, 1.0), 1.15) * 0.2 * alphaFactor;

    // Vertical gleam sweep (top to bottom) during flip
    float shimmerHead = mix(-0.2, 1.2, smoothstep(0.0, 1.0, uProgress));
    float shimmerBand = exp(-pow((vUv.y - shimmerHead) * 8.5, 2.0));
    float shimmerCore = exp(-pow((vUv.y - shimmerHead) * 18.0, 2.0));
    float shimmerTrail = exp(-pow((vUv.y - (shimmerHead - 0.16)) * 5.5, 2.0));

    float shimmerMask = (shimmerBand * 0.9 + shimmerCore * 0.85 + shimmerTrail * 0.5) * peelMask * uGleamStrength * alphaFactor;

    // Iridescent tint
    float iridCoord = clamp(vUv.x * 0.5 + vUv.y * 0.8 + uProgress * 0.3, 0.0, 1.0);
    vec3 iridColor = iridescentGradient(iridCoord);

    vec3 shimmerOverlay = iridColor * shimmerMask;
    vec3 specular = vec3(1.0, 0.99, 0.96) * shimmerCore * peelMask * uGleamStrength * 0.8 * alphaFactor;

    vec3 finalColor = sampleColor.rgb + shimmerOverlay + specular + vec3(edgeLight);

    gl_FragColor = vec4(finalColor, sampleColor.a);
  }
`;

const radioWaveVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const radioWaveFragmentShader = `
  uniform float uTime;
  uniform float uFlipX;
  uniform float uFlipFromSide;
  uniform float uFlipProgress;
  uniform sampler2D uBodyTexture;
  uniform vec4 uBodyRect;
  varying vec2 vUv;

  float sampleBodyOriented(vec2 uv, float side) {
    vec2 bodyUv = (uv - uBodyRect.xy) / uBodyRect.zw;
    if (bodyUv.x < 0.0 || bodyUv.x > 1.0 || bodyUv.y < 0.0 || bodyUv.y > 1.0) return 0.0;
    if (side < 0.0) bodyUv.x = 1.0 - bodyUv.x;
    return texture2D(uBodyTexture, bodyUv).a;
  }

  float sampleBody(vec2 uv) {
    if (uFlipProgress < 0.01) {
      return sampleBodyOriented(uv, uFlipX);
    }
    // Blend between from-side and to-side silhouettes during flip
    float fromAlpha = sampleBodyOriented(uv, uFlipFromSide);
    float toAlpha = sampleBodyOriented(uv, -uFlipFromSide);
    return mix(fromAlpha, toAlpha, uFlipProgress);
  }

  float bodyEdge(vec2 uv, float radius) {
    float center = sampleBody(uv);
    float maxNeighbor = 0.0;
    for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
      for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
        if (dx == 0.0 && dy == 0.0) continue;
        maxNeighbor = max(maxNeighbor, sampleBody(uv + vec2(dx, dy) * radius));
      }
    }
    return maxNeighbor * (1.0 - center);
  }

  void main() {
    float speed = 0.35;
    float progress = mod(uTime * speed, 2.2) - 0.6;

    float bodyAlpha = sampleBody(vUv);
    bool insideBody = bodyAlpha > 0.15;    // Two Radio wave arc ripples (Double Pulse)
    float arcOffset = 0.25 * pow(abs(vUv.y - 0.5) * 2.0, 2.2);
    float dist1 = (vUv.x + arcOffset) - progress;
    float dist2 = (vUv.x + arcOffset) - (progress - 0.12);

    float bodyStrength1 = smoothstep(0.015, 0.0, dist1) * smoothstep(-0.35, 0.0, dist1);
    float bodyStrength2 = smoothstep(0.015, 0.0, dist2) * smoothstep(-0.35, 0.0, dist2);
    float bodyStrength = max(bodyStrength1, bodyStrength2);

    // Background center line that ripples into two diverging/converging sine waves
    float centerY = 0.5;
    // They peak together at vUv.x = 0.48 (body position) with longer wavelengths (approx 1 cycle shown)
    float sineDist1 = sin((vUv.x - 0.48) * 7.5 - uTime * 8.0) * bodyStrength * 0.15;
    float sineDist2 = sin((vUv.x - 0.48) * 5.0 - uTime * 8.0) * bodyStrength * 0.15;
    
    float lineMask1 = smoothstep(0.007, 0.0, abs(vUv.y - centerY - sineDist1));
    float lineMask2 = smoothstep(0.007, 0.0, abs(vUv.y - centerY - sineDist2));
    
    // Brighten the intersection point for constructive interference feel
    float intersection = lineMask1 * lineMask2;
    vec3 lineColor = mix(vec3(0.66, 0.18, 0.9) * 0.48, vec3(1.0, 0.88, 1.0), intersection * 0.82);
    float bgLineAlpha = max(lineMask1, lineMask2) * 0.65;

    // Rippling distortion for volume
    float ripple1 = sin((vUv.x * 7.5) - (uTime * 2.6) + (vUv.y * 2.8));
    float ripple2 = sin((vUv.x * 13.0) + (vUv.y * 4.0) - (uTime * 4.2));
    float ripple3 = sin((vUv.x * 4.0) - (vUv.y * 9.0) + (uTime * 1.5));
    float ripple = ripple1 * 0.42 + ripple2 * 0.33 + ripple3 * 0.25;
    float wave = ripple * 0.5 + 0.5;

    float edge = smoothstep(0.02, 0.0, abs(dist1)) + smoothstep(0.02, 0.0, abs(dist2));
    float edgeFalloff = smoothstep(0.18, -0.06, dist1) + smoothstep(0.18, -0.06, dist2);
    float bodyDepth = smoothstep(0.0, 0.78, bodyStrength);

    float fresnel = pow(1.0 - clamp(abs(vUv.y - 0.5) * 1.9, 0.0, 1.0), 2.4);
    float crest = pow(wave, 4.0) * edge * 0.6;
    float trough = (1.0 - wave) * bodyStrength * 0.08;
    float caustics = smoothstep(0.28, 0.96, wave) * bodyStrength * 0.12;

    float alpha = (bodyStrength * 0.02 + caustics + crest + fresnel * 0.22) * clamp(edgeFalloff, 0.0, 1.0);
    // Incorporate background lines
    alpha = max(alpha, bgLineAlpha);
    
    alpha *= smoothstep(-0.15, 0.15, vUv.x + arcOffset - progress + 0.5);
    alpha *= smoothstep(1.15, 0.85, vUv.x);

    // Suppress wave inside the silhouette
    if (insideBody) {
      alpha = 0.0;
    }

    // Silhouette edge outline glow when wave front is near
    float edgeDetect = bodyEdge(vUv, 0.008);
    float waveFrontX = progress - arcOffset;
    float nearWave = smoothstep(0.4, 0.0, abs(vUv.x - waveFrontX));
    // The outline hits 100% only when the wave is exactly wiping over it
    float outlineAlpha = edgeDetect * nearWave * 0.9;

    // Purple force field palette
    vec3 darkCore = vec3(0.04, 0.02, 0.06);
    vec3 midTone = vec3(0.38, 0.18, 0.6); 
    vec3 brightEdge = vec3(0.85, 0.6, 0.98); 
    vec3 hotWhite = vec3(1.0, 0.92, 1.0); 

    vec3 waveBody = mix(darkCore, midTone, wave * 0.5 + bodyDepth * 0.3);
    vec3 edgeGlow = mix(midTone, brightEdge, fresnel * 0.8 + crest * 1.0);
    vec3 color = mix(waveBody, edgeGlow, clamp(fresnel + crest * 0.9, 0.0, 1.0));
    color += hotWhite * edge * 0.35;
    color += vec3(0.03) * trough;
    color = mix(color, lineColor, bgLineAlpha);

    // Replace outline color with iridescent-to-white sweep
    // Same iridescent soap bubble core palette used in the text
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.33, 0.67);
    float paletteInput = vUv.x * 0.5 - uTime * 0.8;
    vec3 iridescentOutline = a + b * cos(6.28318 * (c * paletteInput + d));
    
    // Core of the contour is pure white, edge bleeds into iridescence
    float coreHighlight = smoothstep(0.2, 0.0, abs(vUv.x - waveFrontX));
    vec3 outlineColor = mix(iridescentOutline, vec3(1.0, 1.0, 1.0), coreHighlight);
    
    // Mathematically correct semi-transparent blending (avoids making low-alpha edges appear black/muddy)
    float finalAlpha = clamp(alpha + outlineAlpha, 0.0, 0.95);
    if (finalAlpha > 0.0) {
      color = mix(color, outlineColor, outlineAlpha / finalAlpha);
    }

    gl_FragColor = vec4(color, finalAlpha);
  }
`;

const RadioWave: React.FC<{ bodyTexture: THREE.Texture; facingSide: number; flipEffect: FlipEffectState }> = ({ bodyTexture, facingSide, flipEffect }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    const charWorldX = 0;
    const charWorldY = -0.55;
    const halfW = CHARACTER_SIZE.width / 2;
    const halfH = CHARACTER_SIZE.height / 2;
    const uvLeft = (charWorldX - halfW + 5) / 10;
    const uvBottom = (charWorldY - halfH + 3.25) / 6.5;
    const uvW = CHARACTER_SIZE.width / 10;
    const uvH = CHARACTER_SIZE.height / 6.5;

    return {
      uTime: { value: 0 },
      uFlipX: { value: 1 },
      uFlipFromSide: { value: 1 },
      uFlipProgress: { value: 0 },
      uBodyTexture: { value: bodyTexture },
      uBodyRect: { value: new THREE.Vector4(uvLeft, uvBottom, uvW, uvH) },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyTexture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uBodyTexture.value = bodyTexture;
    }
  }, [bodyTexture]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uFlipX.value = facingSide;
      materialRef.current.uniforms.uFlipFromSide.value = flipEffect.active ? flipEffect.fromSide : facingSide;
      materialRef.current.uniforms.uFlipProgress.value = flipEffect.active ? flipEffect.progress : 0;
    }
  });

  return (
    <mesh position={[0, 0, -0.5]} frustumCulled={false}>
      <planeGeometry args={[10, 6.5]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={radioWaveVertexShader}
        fragmentShader={radioWaveFragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

const SCENE_BOUNDS = {
  left: -4.35,
  right: 4.35,
  top: 2.72,
  bottom: -2.7,
};

const BODY_BOUNDS = {
  centerX: 0,
  centerY: -0.38,
  radiusX: 1.08,
  radiusY: 2.22,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const formatDbm = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}dBm`;
const formatDistance = (valueCm: number) => `${(valueCm / 100).toFixed(0)}m away`;

const logNormalize = (value: number, maxAbs: number) => {
  const safeMax = Math.max(maxAbs, 0.0001);
  const normalized = clamp(Math.abs(value) / safeMax, 0, 1);
  return Math.log1p(normalized * 8) / Math.log1p(8);
};

const toEndpointADistanceCm = (x: number) => {
  const minDistance = 3000;
  const maxDistance = DEFAULTS.maxDistanceCm;
  const response = logNormalize(x, Math.max(Math.abs(SCENE_BOUNDS.left), Math.abs(SCENE_BOUNDS.right)));
  return clamp(minDistance + response * (maxDistance - minDistance), DEFAULTS.minDistanceCm, DEFAULTS.maxDistanceCm);
};

const toEndpointBDistanceCm = (y: number) => {
  const minDistance = 3000;
  const maxDistance = DEFAULTS.maxDistanceCm;
  const response = logNormalize(y, Math.max(Math.abs(SCENE_BOUNDS.bottom), Math.abs(SCENE_BOUNDS.top)));
  return clamp(minDistance + response * (maxDistance - minDistance), DEFAULTS.minDistanceCm, DEFAULTS.maxDistanceCm);
};

const formatFrequency = (valueHz: number) => {
  if (valueHz >= 1e9) {
    return `${(valueHz / 1e9).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}GHz`;
  }

  if (valueHz >= 1e6) {
    return `${(valueHz / 1e6).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}MHz`;
  }

  if (valueHz >= 1e3) {
    return `${(valueHz / 1e3).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}kHz`;
  }

  return `${valueHz.toFixed(0)}Hz`;
};

const getFrequencyClass = (valueHz: number) => {
  if (valueHz < 3e5) {
    return "LF";
  }

  if (valueHz < 3e6) {
    return "MF";
  }

  if (valueHz < 3e7) {
    return "HF";
  }

  if (valueHz < 3e8) {
    return "VHF";
  }

  if (valueHz < 1e9) {
    return "Low end microwave (pre L band)";
  }

  if (valueHz < 2e9) {
    return "L-band Microwave (1-2GHz)";
  }

  if (valueHz < 4e9) {
    return "S-band Microwave (2-4GHz)";
  }

  if (valueHz < 12e9) {
    return "X-band (8-12GHz)";
  }

  return "Microwave";
};

const getEllipseTopY = (x: number) => {
  const normalizedX = clamp((x - BODY_BOUNDS.centerX) / BODY_BOUNDS.radiusX, -1, 1);
  const normalizedY = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
  return BODY_BOUNDS.centerY + normalizedY * BODY_BOUNDS.radiusY;
};

const constrainMarker = (x: number, y: number) => {
  const clampedX = clamp(x, SCENE_BOUNDS.left, SCENE_BOUNDS.right);
  const floorY = SCENE_BOUNDS.bottom + 0.18;
  const withinBodyX = Math.abs(clampedX - BODY_BOUNDS.centerX) <= BODY_BOUNDS.radiusX;
  const topOfBody = getEllipseTopY(clampedX) + 0.12;
  const clampedY = clamp(
    withinBodyX ? Math.max(y, topOfBody) : y,
    floorY,
    SCENE_BOUNDS.top,
  );

  return new THREE.Vector2(clampedX, clampedY);
};

const computeModel = (endpointADistance: number, endpointBDistance: number) => {
  const frequencyRatio = Math.pow(DEFAULTS.frequencyHz / DEFAULTS.referenceFrequencyHz, DEFAULTS.exponent);
  const distanceLossA = endpointADistance * DEFAULTS.mediumLossRefDbPerCm * 0.015 * frequencyRatio;
  const distanceLossB = endpointBDistance * DEFAULTS.mediumLossRefDbPerCm * 0.015 * frequencyRatio;
  const bodyEntryLoss = (DEFAULTS.skinThicknessCm * DEFAULTS.skinLossRefDbPerCm + DEFAULTS.skullThicknessCm * DEFAULTS.skullLossRefDbPerCm) * 0.18 * frequencyRatio;
  const bodyTraversalLoss = (DEFAULTS.skinThicknessCm * DEFAULTS.skinLossRefDbPerCm + DEFAULTS.skullThicknessCm * DEFAULTS.skullLossRefDbPerCm) * 0.12 * frequencyRatio;
  const entry = -22;
  const endpointA = entry + distanceLossA;
  const exit = entry - bodyTraversalLoss;
  const receive = exit - distanceLossB;

  return {
    endpointA,
    entry,
    exit,
    receive,
    distanceLossA,
    distanceLossB,
    bodyEntryLoss,
    bodyTraversalLoss,
  };
};

type LayoutMetrics = {
  markerX: number;
  markerY: number;
  endpointADistance: number;
  endpointBDistance: number;
  txDistance: number;
  rxDistance: number;
  side: -1 | 1;
};

const toMetrics = (x: number, y: number): LayoutMetrics => {
  const point = constrainMarker(x, y);

  return {
    markerX: point.x,
    markerY: point.y,
    endpointADistance: toEndpointADistanceCm(point.x),
    endpointBDistance: toEndpointBDistanceCm(point.y),
    txDistance: toEndpointADistanceCm(point.x),
    rxDistance: toEndpointBDistanceCm(point.y),
    side: point.x < BODY_BOUNDS.centerX ? -1 : 1,
  };
};

const getArrowRotation = (metrics: LayoutMetrics) => {
  const silhouetteLeft = BODY_BOUNDS.centerX - BODY_BOUNDS.radiusX;
  const silhouetteRight = BODY_BOUNDS.centerX + BODY_BOUNDS.radiusX;
  const normalizedX = clamp((metrics.markerX - silhouetteLeft) / (silhouetteRight - silhouetteLeft), 0, 1);
  const degrees = (1 - normalizedX) * 180;
  return THREE.MathUtils.degToRad(degrees);
};

const easeInOutCubic = (value: number) => {
  if (value < 0.5) {
    return 4 * value * value * value;
  }

  return 1 - Math.pow(-2 * value + 2, 3) / 2;
};

const easeOutQuad = (value: number) => 1 - (1 - value) * (1 - value);

type FlipEffectState = {
  active: boolean;
  fromSide: -1 | 1;
  toSide: -1 | 1;
  progress: number;
};

const PeelCharacter: React.FC<{
  facingSide: -1 | 1;
  flipEffect: FlipEffectState;
  texture: THREE.Texture;
}> = ({ facingSide, flipEffect, texture }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const shimmerMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const baseUniforms = useMemo(() => ({
    uTexture: { value: texture },
    uProgress: { value: 0 },
    uDirection: { value: facingSide },
    uLift: { value: 0 },
    uCurlStrength: { value: 0 },
    uGleamStrength: { value: 0 },
  }), [texture]);

  const shimmerUniforms = useMemo(() => ({
    uTexture: { value: texture },
    uProgress: { value: 0 },
    uDirection: { value: facingSide },
    uLift: { value: 0 },
    uCurlStrength: { value: 0 },
    uGleamStrength: { value: 0 },
  }), [texture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTexture.value = texture;
    }
    if (shimmerMaterialRef.current) {
      shimmerMaterialRef.current.uniforms.uTexture.value = texture;
    }
  }, [texture]);

  useFrame(() => {
    const activeProgress = flipEffect.active ? easeInOutCubic(flipEffect.progress) : 0;
    const lift = Math.sin(activeProgress * Math.PI);
    const curl = Math.sin(activeProgress * Math.PI) * 1.55;
    const gleamStrength = Math.sin(activeProgress * Math.PI) * 1.2;
    const direction = flipEffect.active ? flipEffect.fromSide : facingSide;

    // Update uniform state objects
    baseUniforms.uProgress.value = activeProgress;
    baseUniforms.uDirection.value = direction;
    baseUniforms.uLift.value = 1.8 * lift;
    baseUniforms.uCurlStrength.value = curl;
    baseUniforms.uGleamStrength.value = gleamStrength;

    shimmerUniforms.uProgress.value = activeProgress;
    shimmerUniforms.uDirection.value = direction;
    shimmerUniforms.uLift.value = 1.8 * lift;
    shimmerUniforms.uCurlStrength.value = curl;
    shimmerUniforms.uGleamStrength.value = gleamStrength;

    // Update material instances directly
    if (materialRef.current) {
      materialRef.current.uniforms.uProgress.value = activeProgress;
      materialRef.current.uniforms.uDirection.value = direction;
      materialRef.current.uniforms.uLift.value = 1.8 * lift;
      materialRef.current.uniforms.uCurlStrength.value = curl;
      materialRef.current.uniforms.uGleamStrength.value = gleamStrength;
    }

    if (shimmerMaterialRef.current) {
      shimmerMaterialRef.current.uniforms.uProgress.value = activeProgress;
      shimmerMaterialRef.current.uniforms.uDirection.value = direction;
      shimmerMaterialRef.current.uniforms.uLift.value = 1.8 * lift;
      shimmerMaterialRef.current.uniforms.uCurlStrength.value = curl;
      shimmerMaterialRef.current.uniforms.uGleamStrength.value = gleamStrength;
    }
  });

  const activeProgress = flipEffect.active ? easeInOutCubic(flipEffect.progress) : 0;
  const lift = Math.sin(activeProgress * Math.PI);
  const shadowOpacity = 0.08 + lift * 0.28;
  const shadowScale = 1 + lift * 0.55;
  const restingSide = flipEffect.active ? flipEffect.fromSide : facingSide;
  const yRotation = flipEffect.active ? easeInOutCubic(flipEffect.progress) * Math.PI : 0;
  const settleOffset = flipEffect.active ? easeOutQuad(Math.sin(activeProgress * Math.PI)) * 0.65 : 0;
  const characterScale = 1 + lift * 0.05;

  return (
    <group position={[0, -0.55, 0.15]}>
      <mesh position={[0, -2.72, -0.18]} rotation={[-Math.PI / 2, 0, 0]} scale={[shadowScale, 1 + lift * 0.18, 1]} frustumCulled={false}>
        <planeGeometry args={[CHARACTER_SIZE.width * 1.22, 2.05]} />
        <meshBasicMaterial color="#161922" transparent opacity={shadowOpacity} depthWrite={false} />
      </mesh>

      <group rotation={[0, yRotation, 0]} scale={[restingSide * characterScale, characterScale, 1]} position={[0, lift * 0.22, settleOffset]}>
        <mesh frustumCulled={false}>
          <planeGeometry args={[CHARACTER_SIZE.width, CHARACTER_SIZE.height, 48, 72]} />
          <shaderMaterial
            ref={materialRef}
            uniforms={baseUniforms}
            vertexShader={peelVertexShader}
            fragmentShader={peelFragmentShader}
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[0, 0, 0.01]} renderOrder={999} frustumCulled={false}>
          <planeGeometry args={[CHARACTER_SIZE.width, CHARACTER_SIZE.height, 48, 72]} />
          <shaderMaterial
            ref={shimmerMaterialRef}
            uniforms={shimmerUniforms}
            vertexShader={peelVertexShader}
            fragmentShader={shimmerFragmentShader}
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  );
};



const binaryRowVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const binaryRowFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    if (texColor.a < 0.1) discard;

    float speed = 0.35;
    float cycle = mod(uTime * speed, 2.2);
    // Align wave progression identically to RadioWave
    float progress = cycle - 0.6;
    float normalizedX = vWorldPosition.x / 10.0 + 0.5;
    
    // Wavefront UV is 'progress'. Dist < 0 means wave has passed.
    // Use local vUv.x to give the digit itself a sense of being 'swiped' into existence
    // as the wave front overtakes its horizontal span.
    float dist = normalizedX - progress;
    float localWipeShift = (vUv.x - 0.5) * 0.15; // slightly lead the wipe across the char width
    float revealedThisCycle = smoothstep(0.12, -0.05, dist + localWipeShift);
    
    // Fade to zero gracefully as the cycle approaches its very end (between 2.0 and 2.2)
    float fadeOut = smoothstep(2.2, 1.9, cycle);

    // Sum previous cycle fade with current cycle reveal, clamp to 1.0.
    float totalReveal = clamp(revealedThisCycle * fadeOut, 0.0, 1.0);

    // Purple Iridescent Palette
    vec3 a = vec3(0.5, 0.4, 0.6);
    vec3 b = vec3(0.4, 0.2, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.35, 0.1, 0.5);
    float paletteInput = totalReveal + vWorldPosition.x * 0.15 - uTime * 0.6;
    vec3 iridescent = a + b * cos(6.28318 * (c * paletteInput + d));
    
    // Brightness highlight
    float highlight = smoothstep(0.1, -0.05, dist) * smoothstep(-0.5, -0.05, dist);
    vec3 litColor = mix(iridescent, vec3(1.0, 0.9, 1.0), 0.2 + highlight * 0.6);
    
    // Base color heavily darkened
    vec3 baseColor = vec3(0.08, 0.04, 0.12);
    
    // Completely hide until wiped over!
    float finalAlpha = texColor.a * totalReveal;
    gl_FragColor = vec4(litColor, finalAlpha);
  }
`;

const BinaryRow = ({ x, y, widthWorld }: { x: number; y: number; widthWorld: number }) => {
  const [cycleIndex, setCycleIndex] = useState(0);

  useFrame(({ clock }) => {
    const activeCycle = Math.floor((clock.elapsedTime * 0.35) / 2.2);
    if (activeCycle !== cycleIndex) {
      setCycleIndex(activeCycle);
    }
  });

  const { texture, width, height } = useMemo(() => {
    // Only one zero or one, randomly chosen
    const text = Math.random() > 0.5 ? '1' : '0';

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { texture: null, width: 1, height: 1 };

    // Varies in size too per loop
    const startSize = 90 + Math.random() * 110;
    const endSize = startSize;
    const chars = text.split("");

    // Calculate widths for decreasing font size
    let totalWidth = 0;
    const charMetrics = chars.map((char, index) => {
      // Linear interpolation of font size from big to small
      const size = startSize - ((startSize - endSize) * (index / Math.max(1, chars.length - 1)));
      ctx.font = `normal ${size}px "JetBrains Mono", monospace`;
      const m = ctx.measureText(char);
      const charW = m.width + size * 0.45; // Adds kerning space between characters
      totalWidth += charW;
      return { char, size, charW };
    });

    const textHeight = startSize * 1.3;
    canvas.width = Math.ceil(totalWidth);
    canvas.height = Math.ceil(textHeight);

    // Draw characters aligned to the vertical center (middle)
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";

    let currentX = 0;
    charMetrics.forEach(({ char, size, charW }) => {
      ctx.font = `normal ${size}px "JetBrains Mono", monospace`;
      ctx.fillText(char, currentX, textHeight / 2);
      currentX += charW;
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;

    return { texture: tex, width: widthWorld, height: widthWorld * (canvas.height / canvas.width) };
  }, [cycleIndex, widthWorld]);

  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Provide stable uniforms object to prevent R3F from losing track across re-renders
  const uniforms = useMemo(() => ({
    uTexture: { value: texture },
    uTime: { value: 0 }
  }), []);

  // Hot-swap the underlying texture without re-mounting the material
  useEffect(() => {
    if (materialRef.current && texture) {
      materialRef.current.uniforms.uTexture.value = texture;
      materialRef.current.uniformsNeedUpdate = true;
    }
  }, [texture]);

  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
    }

    // Calculate horizontal 'travel' displacement to stay on the wavefront
    if (meshRef.current) {
      const speed = 0.35;
      const cycle = (clock.elapsedTime * speed % 2.2);
      const progress = cycle - 0.6;

      // We use the start position passed via props
      const startWorldX = x;

      // Correct Wavefront World X (progress is the UV position [0..1 approx])
      const waveWorldX = (progress - 0.5) * 10.0;

      // Update mesh horizontal position: locked slightly behind wavefront to stay in reveal zone
      const currentX = Math.max(startWorldX, waveWorldX - 0.05);
      meshRef.current.position.x = currentX;

      const uvX = currentX / 10.0 + 0.5;
      const arcOffset = 0.25 * Math.pow(Math.abs(y / 6.5) * 2.0, 2.2);

      const waveUvX = uvX + arcOffset;
      const dist1 = waveUvX - progress;
      const dist2 = waveUvX - (progress - 0.12);

      // Body strength (reveal window)
      const bodyS = Math.max(
        Math.max(0, 1.0 - Math.abs(dist1 * 8.0)),
        Math.max(0, 1.0 - Math.abs(dist2 * 8.0))
      );

      // Same sine math as background lines, but with extra amplitude to be at the 'peak'
      const sine1 = Math.sin((uvX - 0.48) * 7.5 - clock.elapsedTime * 8.0);
      const sine2 = Math.sin((uvX - 0.48) * 5.0 - clock.elapsedTime * 8.0);

      // Surf the peaks: use the sum + an offset to stay prominently on top
      const surfHeight = (sine1 + sine2) * 0.75 * bodyS;
      meshRef.current.position.y = y + 0.38 + surfHeight;

      // Properly time the visibility: hide before reset and until wavefront arrives
      // 1.9 is the fadeOut threshold from the shader
      const isLoopClosing = cycle > 1.92 || cycle < 0.1;
      const waveArrival = currentX > startWorldX - 0.02;
      meshRef.current.visible = waveArrival && !isLoopClosing;
    }
  });

  if (!texture) return null;

  return (
    <mesh ref={meshRef} position={[x, y, 0.65]}>
      <planeGeometry args={[width, height]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={binaryRowVertexShader}
        fragmentShader={binaryRowFragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

const BinaryMatrixOverlay = () => {
  const lineInfo = useMemo(() => {
    const centerX = 0;
    const centerY = -0.38;
    const radiusX = 1.08;

    // Move to just outside the body silhouette for the 'exit' effect
    const startX = centerX + radiusX + 0.12;
    const widthWorld = 1.2; // Width of the texture itself

    return {
      y: centerY - 0.25,
      x: startX,
      widthWorld: widthWorld
    };
  }, []);

  if (!lineInfo) return null;

  return (
    <group>
      <BinaryRow x={lineInfo.x} y={lineInfo.y} widthWorld={lineInfo.widthWorld} />
    </group>
  );
};

const SceneContents: React.FC<{
  characterFacingSide: -1 | 1;
  flipEffect: FlipEffectState;
  metrics: LayoutMetrics;
  model: ReturnType<typeof computeModel>;
  previewMetrics: LayoutMetrics;
  onPointerDown: (point: THREE.Vector3) => void;
  onPointerMove: (point: THREE.Vector3) => void;
  onPointerUp: () => void;
}> = ({ characterFacingSide, flipEffect, metrics, model, previewMetrics, onPointerDown, onPointerMove, onPointerUp }) => {
  const texture = useTexture(BODY_CHARACTER_SRC);
  const { size, camera } = useThree();

  useEffect(() => {
    if (camera.type === "OrthographicCamera") {
      const ortho = camera as THREE.OrthographicCamera;
      ortho.zoom = size.width / 10;
      ortho.updateProjectionMatrix();
    }
  }, [size, camera]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }, [texture]);

  const handleDown = useCallback((event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    onPointerDown(event.point);
  }, [onPointerDown]);

  const handleMove = useCallback((event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    onPointerMove(event.point);
  }, [onPointerMove]);

  const handleUp = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    onPointerUp();
  }, [onPointerUp]);

  return (
    <>
      {/* Removed <color attach="background" /> to show CSS grid behind the canvas */}
      <ambientLight intensity={0.9} />
      <directionalLight position={[0, 0, 3]} intensity={1.25} color="#ffffff" />



      <RadioWave bodyTexture={texture} facingSide={characterFacingSide} flipEffect={flipEffect} />

      <mesh
        position={[0, 0, 0.2]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerMissed={handleUp}
      >
        <planeGeometry args={[9.8, 6.2]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>

      <CanvasText position={[-4.2, 2.62, 0.35]} fontSize={0.24} color="#1e1e26" anchorX="left" anchorY="middle" fontWeight={700} text="Endpoint A (Tx)" />
      <CanvasText position={[-4.2, 2.37, 0.35]} fontSize={0.17} color="#3a3a42" anchorX="left" anchorY="middle" fontWeight={500} text={`${formatDbm(model.endpointA)} / ${formatDistance(metrics.txDistance)}`} />

      <CanvasText position={[0, 2.55, 0.35]} fontSize={0.26} color="#1a1a22" anchorX="center" anchorY="middle" fontWeight={700} text="Target" />

      <CanvasText position={[4.2, 2.62, 0.35]} fontSize={0.24} color="#1e1e26" anchorX="right" anchorY="middle" fontWeight={700} text="Endpoint B (Rx)" />
      <CanvasText position={[4.2, 2.37, 0.35]} fontSize={0.17} color="#3a3a42" anchorX="right" anchorY="middle" fontWeight={500} text={formatDistance(metrics.rxDistance)} />

      <PeelCharacter facingSide={characterFacingSide} flipEffect={flipEffect} texture={texture} />

      <BinaryMatrixOverlay />

      <group position={[previewMetrics.markerX, previewMetrics.markerY, 1.2]} rotation={[0, 0, getArrowRotation(previewMetrics)]} renderOrder={1000}>
        <CanvasText position={[0, 0, 0]} fontSize={0.52} color="#3d3d3d" anchorX="center" anchorY="middle" fontWeight={700} text="➤" />
      </group>

      <CanvasText position={[-3.0, 0.55, 0.45]} fontSize={0.42} color="#1a1a22" anchorX="center" anchorY="middle" fontWeight={900} letterSpacing={-0.02} text={formatDbm(model.entry)} />
      <CanvasText position={[-3.0, 0.22, 0.45]} fontSize={0.16} color="#3a3a42" anchorX="right" anchorY="middle" fontWeight={500} text="Entry" />

      <CanvasText position={[3.0, -2.0, 0.45]} fontSize={0.42} color="#1a1a22" anchorX="center" anchorY="middle" fontWeight={900} letterSpacing={-0.02} text={formatDbm(model.receive)} />
      <CanvasText position={[3.0, -2.33, 0.45]} fontSize={0.16} color="#3a3a42" anchorX="left" anchorY="middle" fontWeight={500} text="Power at Rx" />

      <CanvasText position={[-4.2, -2.18, 0.45]} fontSize={0.26} color="#1a1a22" anchorX="left" anchorY="middle" fontWeight={900} letterSpacing={-0.02} text={formatFrequency(DEFAULTS.frequencyHz)} />

      <CanvasText position={[-4.2, -2.45, 0.45]} fontSize={0.15} color="#3a3a42" anchorX="left" anchorY="middle" fontWeight={500} letterSpacing={-0.01} text={`${getFrequencyClass(DEFAULTS.frequencyHz)} frequency`} />
    </>
  );
};

const BodyAttenuationWebGPUCanvas: React.FC = () => {
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<LayoutMetrics>(() => toMetrics(2.1, 1.1));
  const [previewMetrics, setPreviewMetrics] = useState<LayoutMetrics>(() => toMetrics(2.1, 1.1));
  const [characterFacingSide, setCharacterFacingSide] = useState<-1 | 1>(1);
  const [flipEffect, setFlipEffect] = useState<FlipEffectState>({
    active: false,
    fromSide: 1,
    toSide: 1,
    progress: 0,
  });
  const model = useMemo(() => computeModel(metrics.txDistance, metrics.rxDistance), [metrics.txDistance, metrics.rxDistance]);

  const updateFromScenePoint = useCallback((point: THREE.Vector3) => {
    return toMetrics(point.x, point.y);
  }, []);

  const handlePointerDown = useCallback((point: THREE.Vector3) => {
    const nextMetrics = updateFromScenePoint(point);
    setDragging(true);
    setPreviewMetrics(nextMetrics);
    setMetrics(nextMetrics);
  }, [updateFromScenePoint]);

  const handlePointerMove = useCallback((point: THREE.Vector3) => {
    const nextMetrics = updateFromScenePoint(point);
    setPreviewMetrics(nextMetrics);

    if (dragging) {
      if (nextMetrics.side !== characterFacingSide && !flipEffect.active) {
        setFlipEffect({
          active: true,
          fromSide: characterFacingSide,
          toSide: nextMetrics.side,
          progress: 0,
        });
      }
      setMetrics(nextMetrics);
    }
  }, [characterFacingSide, dragging, flipEffect.active, updateFromScenePoint]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    const release = () => setDragging(false);
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, []);

  useEffect(() => {
    if (!flipEffect.active) {
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();
    const targetSide = flipEffect.toSide;

    const tick = (now: number) => {
      const nextProgress = clamp((now - startedAt) / FLIP_EFFECT_DURATION_MS, 0, 1);

      if (nextProgress >= 1) {
        setCharacterFacingSide(targetSide);
        setFlipEffect({
          active: false,
          fromSide: targetSide,
          toSide: targetSide,
          progress: 0,
        });
        return;
      }

      setFlipEffect((current) => (
        current.active
          ? {
            ...current,
            progress: nextProgress,
          }
          : current
      ));

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [flipEffect.active, flipEffect.toSide]);

  return (
    <Frame>
      <div style={{ position: 'absolute', top: -9999, left: -9999, visibility: 'hidden' }}>
        <span>Endpoint A (Tx)</span>
        <span>Endpoint B (Rx)</span>
        <span>+24.0 dBm</span>
        <span>-48.0 dBm</span>
        <span>tx distance</span>
        <span>rx distance</span>
        <span>frequency</span>
        <span>13.56 MHz</span>
        <span>total path loss</span>
        <span>drag inside the panel to move the target cursor</span>
        <img src="data:image/png;base64," alt="Body attenuation visualization" />
      </div>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
      >
        <React.Suspense fallback={null}>
          <SceneContents
            characterFacingSide={characterFacingSide}
            flipEffect={flipEffect}
            metrics={metrics}
            model={model}
            previewMetrics={previewMetrics}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </React.Suspense>
      </Canvas>
      <RendererBadge>WebGL</RendererBadge>
    </Frame>
  );
};

const Frame = styled.div`
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 2rem 0;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(12, 14, 18, 0.36);
  background-color: #E0E0E2;
  background-image:
    linear-gradient(to right, #D7D8DA 2px, transparent 2px),
    linear-gradient(to bottom, #D7D8DA 2px, transparent 2px);
  background-size: 64px 64px;
  background-position: center bottom;
  aspect-ratio: 10 / 6.4;
  position: relative;

  > div {
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
    cursor: none;
    touch-action: none;
  }
`;

const RendererBadge = styled.div`
  display: none;
`;

export { BodyAttenuationWebGPUCanvas as BodyAttenuationCanvas };
