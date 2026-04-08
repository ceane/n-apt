import { useRef, useState, useEffect } from "react";
import type { FFTCanvasWaterfallBindings } from "@n-apt/components/FFTCanvas";

export interface CanvasState {
  spectrumGpuCanvasNode: HTMLCanvasElement | null;
  spectrumOverlayCanvasNode: HTMLCanvasElement | null;
  setSpectrumGpuCanvasNode: (node: HTMLCanvasElement | null) => void;
  setSpectrumOverlayCanvasNode: (node: HTMLCanvasElement | null) => void;

  waterfallGpuCanvasNode: HTMLCanvasElement | null;
  waterfallOverlayCanvasNode: HTMLCanvasElement | null;
  setWaterfallGpuCanvasNode: (node: HTMLCanvasElement | null) => void;
  setWaterfallOverlayCanvasNode: (node: HTMLCanvasElement | null) => void;

  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  spectrumOverlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  waterfallGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  waterfallOverlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;

  // Container refs
  spectrumContainerRef: React.RefObject<HTMLDivElement | null>;
}

export const useCanvasState = (
  waterfallCanvasBindings?: FFTCanvasWaterfallBindings
): CanvasState => {
  // GPU canvas state
  const [spectrumGpuCanvasNode, setSpectrumGpuCanvasNode] =
    useState<HTMLCanvasElement | null>(null);
  const [spectrumOverlayCanvasNode, setSpectrumOverlayCanvasNode] =
    useState<HTMLCanvasElement | null>(null);

  const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
    useState<HTMLCanvasElement | null>(null);
  const [waterfallOverlayCanvasNode, setWaterfallOverlayCanvasNode] =
    useState<HTMLCanvasElement | null>(null);

  const effectiveWaterfallGpuCanvasNode = waterfallCanvasBindings?.waterfallGpuCanvasNode ?? waterfallGpuCanvasNode;
  const effectiveWaterfallOverlayCanvasNode = waterfallCanvasBindings?.waterfallOverlayCanvasNode ?? waterfallOverlayCanvasNode;
  const effectiveSetWaterfallGpuCanvasNode = waterfallCanvasBindings?.setWaterfallGpuCanvasNode ?? setWaterfallGpuCanvasNode;
  const effectiveSetWaterfallOverlayCanvasNode = waterfallCanvasBindings?.setWaterfallOverlayCanvasNode ?? setWaterfallOverlayCanvasNode;

  // Maintain refs for internal hook usage that don't need to trigger re-renders
  const spectrumGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumContainerRef = useRef<HTMLDivElement | null>(null);

  // Sync state to refs
  useEffect(() => {
    spectrumGpuCanvasRef.current = spectrumGpuCanvasNode;
  }, [spectrumGpuCanvasNode]);

  useEffect(() => {
    spectrumOverlayCanvasRef.current = spectrumOverlayCanvasNode;
  }, [spectrumOverlayCanvasNode]);

  useEffect(() => {
    waterfallGpuCanvasRef.current = effectiveWaterfallGpuCanvasNode;
  }, [effectiveWaterfallGpuCanvasNode]);

  useEffect(() => {
    waterfallOverlayCanvasRef.current = effectiveWaterfallOverlayCanvasNode;
  }, [effectiveWaterfallOverlayCanvasNode]);

  return {
    spectrumGpuCanvasNode,
    spectrumOverlayCanvasNode,
    setSpectrumGpuCanvasNode,
    setSpectrumOverlayCanvasNode,

    waterfallGpuCanvasNode: effectiveWaterfallGpuCanvasNode,
    waterfallOverlayCanvasNode: effectiveWaterfallOverlayCanvasNode,
    setWaterfallGpuCanvasNode: effectiveSetWaterfallGpuCanvasNode,
    setWaterfallOverlayCanvasNode: effectiveSetWaterfallOverlayCanvasNode,

    spectrumGpuCanvasRef,
    spectrumOverlayCanvasRef,
    waterfallGpuCanvasRef,
    waterfallOverlayCanvasRef,

    spectrumContainerRef,
  };
};
