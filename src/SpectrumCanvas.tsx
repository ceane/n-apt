import React, { useEffect, useRef } from "react";

const WIDTH = 1024;
const HEIGHT = 200;

export function SpectrumCanvas({ fft }: { fft?: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deviceRef = useRef<GPUDevice>();
  const pipelineRef = useRef<GPURenderPipeline>();
  const bufferRef = useRef<GPUBuffer>();

  useEffect(() => {
    if (!canvasRef.current || !navigator.gpu) return;

    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter!.requestDevice();
      deviceRef.current = device;

      const ctx = canvasRef.current!.getContext("webgpu")!;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format });

      const shader = device.createShaderModule({
        code: `
struct VSOut {
  @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@location(0) x: f32, @location(1) y: f32) -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(x, y, 0.0, 1.0);
  return o;
}

@fragment
fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 1.0, 0.0, 1.0);
}`
      });

      pipelineRef.current = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shader,
          entryPoint: "vs",
          buffers: [{
            arrayStride: 8,
            attributes: [
              { shaderLocation: 0, format: "float32", offset: 0 },
              { shaderLocation: 1, format: "float32", offset: 4 },
            ]
          }]
        },
        fragment: {
          module: shader,
          entryPoint: "fs",
          targets: [{ format }]
        },
        primitive: { topology: "line-strip" }
      });
    })();
  }, []);

  useEffect(() => {
    if (!fft || !deviceRef.current || !pipelineRef.current) return;

    const device = deviceRef.current;

    const verts = new Float32Array(fft.length * 2);
    for (let i = 0; i < fft.length; i++) {
      const x = (i / (fft.length - 1)) * 2 - 1;
      const y = (fft[i] + 120) / 120 * 2 - 1; // SDR-style dB scaling
      verts[i * 2] = x;
      verts[i * 2 + 1] = y;
    }

    bufferRef.current = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });

    new Float32Array(bufferRef.current.getMappedRange()).set(verts);
    bufferRef.current.unmap();

    const ctx = canvasRef.current!.getContext("webgpu")!;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });

    pass.setPipeline(pipelineRef.current);
    pass.setVertexBuffer(0, bufferRef.current);
    pass.draw(fft.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }, [fft]);

  return <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />;
}