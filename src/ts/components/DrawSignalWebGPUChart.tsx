import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { FFT_CANVAS_BG } from "@n-apt/consts";

const CanvasContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background-color: ${FFT_CANVAS_BG};
  border-radius: 8px;
  border: 1px solid #333;
  overflow: hidden;
`;

const Canvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
`;

const FallbackMessage = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: #666;
  font-size: 14px;
  padding: 20px;
`;

const ErrorDetail = styled.div`
  font-size: 12px;
  margin-top: 10px;
  color: #666;
`;

interface DrawSignalWebGPUChartProps {
  data: Array<{ t: number; freq: number; x: number }>;
  width?: number;
  height?: number;
}

const DrawSignalWebGPUChart: React.FC<DrawSignalWebGPUChartProps> = ({
  data,
  width = 800,
  height = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const formatRef = useRef<GPUTextureFormat | null>(null);

  const linePipelineRef = useRef<GPURenderPipeline | null>(null);
  const gridPipelineRef = useRef<GPURenderPipeline | null>(null);
  const axisPipelineRef = useRef<GPURenderPipeline | null>(null);

  const lineBindGroupRef = useRef<GPUBindGroup | null>(null);
  const gridBindGroupRef = useRef<GPUBindGroup | null>(null);
  const axisBindGroupRef = useRef<GPUBindGroup | null>(null);

  const lineUniformBufferRef = useRef<GPUBuffer | null>(null);
  const gridUniformBufferRef = useRef<GPUBuffer | null>(null);
  const axisUniformBufferRef = useRef<GPUBuffer | null>(null);

  const lastBuffersRef = useRef<{
    lineVertexBuffer: GPUBuffer;
    gridVertexBuffer: GPUBuffer;
    axisVertexBuffer: GPUBuffer;
  } | null>(null);

  const setCanvasSize = (canvas: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || width;
    const cssHeight = canvas.clientHeight || height;
    const nextWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const nextHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
  };

  const generateAxisVertices = (
    _chartData: Array<{ t: number; freq: number; x: number }>,
    canvasWidth: number,
    canvasHeight: number,
  ): number[] => {
    const vertices: number[] = [];
    const padding = 40;
    const chartWidth = canvasWidth - 2 * padding;
    const chartHeight = canvasHeight - 2 * padding;

    // Convert to NDC coordinates
    const toNDC = (x: number, y: number) => {
      const ndcX = (x / canvasWidth) * 2 - 1;
      const ndcY = -((y / canvasHeight) * 2 - 1);
      return [ndcX, ndcY];
    };

    // X-axis line
    const [x1, y1] = toNDC(padding, canvasHeight - padding);
    const [x2, y2] = toNDC(canvasWidth - padding, canvasHeight - padding);
    vertices.push(x1, y1, x2, y2);

    // Y-axis line
    const [x3, y3] = toNDC(padding, padding);
    const [x4, y4] = toNDC(padding, canvasHeight - padding);
    vertices.push(x3, y3, x4, y4);

    // X-axis ticks
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const x = padding + (i / xTicks) * chartWidth;
      const [tickX1, tickY1] = toNDC(x, canvasHeight - padding);
      const [tickX2, tickY2] = toNDC(x, canvasHeight - padding + 5);
      vertices.push(tickX1, tickY1, tickX2, tickY2);
    }

    // Y-axis ticks
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = padding + (i / yTicks) * chartHeight;
      const [tickX1, tickY1] = toNDC(padding - 5, y);
      const [tickX2, tickY2] = toNDC(padding, y);
      vertices.push(tickX1, tickY1, tickX2, tickY2);
    }

    return vertices;
  };

  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [
          parseInt(result[1], 16) / 255,
          parseInt(result[2], 16) / 255,
          parseInt(result[3], 16) / 255,
        ]
      : [0, 0, 0];
  };

  const ensurePipelines = (device: GPUDevice, format: GPUTextureFormat) => {
    if (
      linePipelineRef.current &&
      gridPipelineRef.current &&
      axisPipelineRef.current
    )
      return;

    // Line pipeline
    const vertexShaderCode = `
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
      }

      struct Uniforms {
        color: vec4<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      @vertex
      fn main(@location(0) position: vec2<f32>) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4<f32>(position, 0.0, 1.0);
        output.color = uniforms.color;
        return output;
      }
    `;

    const fragmentShaderCode = `
      @fragment
      fn main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
        return color;
      }
    `;

    const linePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ code: vertexShaderCode }),
        entryPoint: "main",
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: "float32x2",
              },
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: fragmentShaderCode }),
        entryPoint: "main",
        targets: [
          {
            format,
          },
        ],
      },
      primitive: {
        topology: "line-list",
      },
    });

    linePipelineRef.current = linePipeline;

    // Grid pipeline (same as line but different color)
    gridPipelineRef.current = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ code: vertexShaderCode }),
        entryPoint: "main",
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: "float32x2",
              },
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: fragmentShaderCode }),
        entryPoint: "main",
        targets: [
          {
            format,
          },
        ],
      },
      primitive: {
        topology: "line-list",
      },
    });

    // Axis pipeline (same as line but different color)
    axisPipelineRef.current = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ code: vertexShaderCode }),
        entryPoint: "main",
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: "float32x2",
              },
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: fragmentShaderCode }),
        entryPoint: "main",
        targets: [
          {
            format,
          },
        ],
      },
      primitive: {
        topology: "line-list",
      },
    });

    // Create uniform buffers
    // Line uniform buffer (cyan color like FFT)
    const lineUniformData = new Float32Array([0.0, 0.831, 1.0, 1.0]); // Cyan
    lineUniformBufferRef.current = device.createBuffer({
      size: lineUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(lineUniformBufferRef.current, 0, lineUniformData);

    // Grid uniform buffer (dark grey like FFT)
    const gridUniformData = new Float32Array([0.196, 0.196, 0.196, 1.0]); // Dark grey
    gridUniformBufferRef.current = device.createBuffer({
      size: gridUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gridUniformBufferRef.current, 0, gridUniformData);

    // Axis uniform buffer (medium grey like FFT)
    const axisUniformData = new Float32Array([0.4, 0.4, 0.4, 1.0]); // Medium grey
    axisUniformBufferRef.current = device.createBuffer({
      size: axisUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(axisUniformBufferRef.current, 0, axisUniformData);
  };

  const draw = (chartData: Array<{ t: number; freq: number; x: number }>) => {
    const canvas = canvasRef.current;
    const device = deviceRef.current;
    const context = contextRef.current;
    const format = formatRef.current;
    if (!canvas || !device || !context || !format) return;

    const linePipeline = linePipelineRef.current;
    const gridPipeline = gridPipelineRef.current;
    const axisPipeline = axisPipelineRef.current;
    if (!linePipeline || !gridPipeline || !axisPipeline) return;

    // Create line vertices
    const lineVertices = new Float32Array(chartData.length * 2);
    for (let i = 0; i < chartData.length; i++) {
      const point = chartData[i];
      // Map to canvas coordinates with padding
      const padding = 40;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const chartWidth = canvasWidth - 2 * padding;
      const chartHeight = canvasHeight - 2 * padding;

      // Map frequency (0-3 MHz) to x position
      const x = padding + (point.freq / 3) * chartWidth;

      // Map dB (-80 to 0) to y position (inverted because canvas y increases downward)
      const y = padding + ((point.x + 80) / 80) * chartHeight;

      lineVertices[i * 2] = x;
      lineVertices[i * 2 + 1] = y;
    }

    // Generate axis vertices
    const axisVertices = generateAxisVertices(
      chartData,
      canvas.width,
      canvas.height,
    );

    // Create or update buffers
    let lineVertexBuffer: GPUBuffer;
    let gridVertexBuffer: GPUBuffer;
    let axisVertexBuffer: GPUBuffer;

    if (lastBuffersRef.current) {
      // Reuse existing buffers
      lineVertexBuffer = lastBuffersRef.current.lineVertexBuffer;
      gridVertexBuffer = lastBuffersRef.current.gridVertexBuffer;
      axisVertexBuffer = lastBuffersRef.current.axisVertexBuffer;
    } else {
      // Create new buffers
      lineVertexBuffer = device.createBuffer({
        size: lineVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      gridVertexBuffer = device.createBuffer({
        size: axisVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      axisVertexBuffer = device.createBuffer({
        size: axisVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      lastBuffersRef.current = {
        lineVertexBuffer,
        gridVertexBuffer,
        axisVertexBuffer,
      };
    }

    // Update buffer data
    device.queue.writeBuffer(lineVertexBuffer, 0, lineVertices);
    device.queue.writeBuffer(gridVertexBuffer, 0, axisVertices);
    device.queue.writeBuffer(axisVertexBuffer, 0, axisVertices);

    // Create bind groups
    const lineBindGroup = device.createBindGroup({
      layout: linePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: lineUniformBufferRef.current!,
          },
        },
      ],
    });

    const gridBindGroup = device.createBindGroup({
      layout: gridPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: gridUniformBufferRef.current!,
          },
        },
      ],
    });

    const axisBindGroup = device.createBindGroup({
      layout: axisPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: axisUniformBufferRef.current!,
          },
        },
      ],
    });

    // Render
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.039, g: 0.039, b: 0.039, a: 1.0 }, // Black background like FFT
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    // Draw grid
    renderPass.setPipeline(gridPipeline);
    renderPass.setVertexBuffer(0, gridVertexBuffer);
    renderPass.setBindGroup(0, gridBindGroup);
    renderPass.draw(axisVertices.length / 2);

    // Draw axes
    renderPass.setPipeline(axisPipeline);
    renderPass.setVertexBuffer(0, axisVertexBuffer);
    renderPass.setBindGroup(0, axisBindGroup);
    renderPass.draw(axisVertices.length / 2);

    // Draw line
    renderPass.setPipeline(linePipeline);
    renderPass.setVertexBuffer(0, lineVertexBuffer);
    renderPass.setBindGroup(0, lineBindGroup);
    renderPass.draw(chartData.length);

    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  };

  const init = async () => {
    if (!navigator.gpu) {
      setIsSupported(false);
      setError("WebGPU is not supported in this browser");
      return;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        setIsSupported(false);
        setError("No WebGPU adapter found");
        return;
      }

      const device = await adapter.requestDevice();
      deviceRef.current = device;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext("webgpu");
      if (!context) {
        setIsSupported(false);
        setError("Failed to get WebGPU context");
        return;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format,
        alphaMode: "premultiplied",
      });

      contextRef.current = context;
      formatRef.current = format;

      ensurePipelines(device, format);
      setIsSupported(true);
    } catch (err) {
      setIsSupported(false);
      setError(`WebGPU initialization failed: ${err}`);
    }
  };

  useEffect(() => {
    init();

    return () => {
      // Cleanup
      lastBuffersRef.current?.lineVertexBuffer.destroy();
      lastBuffersRef.current?.gridVertexBuffer.destroy();
      lastBuffersRef.current?.axisVertexBuffer.destroy();
      lastBuffersRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isSupported !== true) return;
    draw(data);
  }, [isSupported, data]);

  useEffect(() => {
    if (isSupported !== true) return;
    const canvas = canvasRef.current;
    const context = contextRef.current;
    const device = deviceRef.current;
    const format = formatRef.current;
    if (!canvas || !context || !device || !format) return;

    const ro = new ResizeObserver(() => {
      setCanvasSize(canvas);
      context.configure({ device, format, alphaMode: "premultiplied" });
      draw(data);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [isSupported, data]);

  return (
    <CanvasContainer>
      <Canvas ref={canvasRef} width={width} height={height} />
      {isSupported === null && (
        <FallbackMessage>Initializing WebGPU...</FallbackMessage>
      )}
      {isSupported === false && (
        <FallbackMessage>
          <div>WebGPU not available</div>
          <ErrorDetail>{error}</ErrorDetail>
        </FallbackMessage>
      )}
    </CanvasContainer>
  );
};

export default DrawSignalWebGPUChart;
