import React, { useMemo } from "react";
import * as THREE from "three";

const CANVAS_FONT_FAMILY = '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

interface CanvasTextProps {
  text: string;
  position?: [number, number, number];
  fontSize?: number;
  color?: string;
  fontWeight?: number | string;
  anchorX?: "left" | "center" | "right";
  anchorY?: "top" | "middle" | "bottom";
  scale?: [number, number, number] | number;
  letterSpacing?: number;
}

export const CanvasText: React.FC<CanvasTextProps> = ({
  text,
  position = [0, 0, 0],
  fontSize = 0.5,
  color = "#000000",
  fontWeight = "normal",
  anchorX = "center",
  anchorY = "middle",
  scale = 1,
  letterSpacing = 0,
}) => {
  const { texture, width, height, padUnitX, padUnitY } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { texture: null, width: 1, height: 1, padUnitX: 0, padUnitY: 0 };

    const baseSize = 160;
    const fontStr = `${fontWeight} ${baseSize}px ${CANVAS_FONT_FAMILY}`;
    ctx.font = fontStr;

    if ('letterSpacing' in canvas.style) {
      canvas.style.letterSpacing = `${letterSpacing}em`;
    }

    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = baseSize * 1.2;

    const padX = baseSize * 0.3;
    const padY = baseSize * 0.3;
    canvas.width = Math.ceil(textWidth + padX * 2);
    canvas.height = Math.ceil(textHeight + padY * 2);

    ctx.font = fontStr;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + baseSize * 0.05);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;

    const widthUnit = (canvas.width / baseSize) * fontSize;
    const heightUnit = (canvas.height / baseSize) * fontSize;
    const pUnitX = (padX / baseSize) * fontSize;
    const pUnitY = (padY / baseSize) * fontSize;

    return { texture: tex, width: widthUnit, height: heightUnit, padUnitX: pUnitX, padUnitY: pUnitY };
  }, [text, fontSize, color, fontWeight, letterSpacing]);

  if (!texture) return null;

  const visibleWidth = width - 2 * padUnitX;
  const visibleHeight = height - 2 * padUnitY;

  const offsetX = anchorX === "left" ? visibleWidth / 2 : anchorX === "right" ? -visibleWidth / 2 : 0;
  const offsetY = anchorY === "top" ? -visibleHeight / 2 : anchorY === "bottom" ? visibleHeight / 2 : 0;

  const scaleX = Array.isArray(scale) ? scale[0] : scale;
  const scaleY = Array.isArray(scale) ? scale[1] : scale;
  const scaleZ = Array.isArray(scale) ? scale[2] : scale;

  return (
    <mesh position={[position[0] + offsetX * scaleX, position[1] + offsetY * scaleY, position[2]]} scale={[scaleX, scaleY, scaleZ]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
};
