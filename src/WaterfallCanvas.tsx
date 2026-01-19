import React, { useEffect, useRef } from "react";

const WIDTH = 1024;
const HEIGHT = 512;

export function WaterfallCanvas({ fftFrame }: { fftFrame?: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deviceRef = useRef<GPUDevice>();
  const textureRef = useRef<GPUTexture>();

  useEffect(() => {
    if (!canvasRef.current || !navigator.gpu) return;

    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter!.requestDevice();
      deviceRef.current = device;

      const ctx = canvasRef.current!.getContext("webgpu")!;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format });

      textureRef.current = device.createTexture({
        size: [WIDTH, HEIGHT],
        format: "r32float",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
    })();
  }, []);

  useEffect(() => {
    if (!fftFrame || !deviceRef.current || !textureRef.current) return;

    const device = deviceRef.current;

    // Scroll down
    device.queue.copyTextureToTexture(
      { texture: textureRef.current, origin: [0, 0, 0] },
      { texture: textureRef.current, origin: [0, 1, 0] },
      [WIDTH, HEIGHT - 1]
    );

    // Write new FFT line at top
    device.queue.writeTexture(
      { texture: textureRef.current, origin: [0, 0, 0] },
      fftFrame,
      { bytesPerRow: WIDTH * 4 },
      [WIDTH, 1]
    );

  }, [fftFrame]);

  return <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />;
}