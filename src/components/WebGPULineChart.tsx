import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { COLORS } from "@n-apt/consts";

const CanvasContainer = styled.div`
  position: relative;
  width: 100%;
  height: 400px;
  background-color: ${COLORS.surface};
  border-radius: 8px;
  border: 1px solid ${COLORS.border};
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
  color: ${COLORS.textSecondary};
  font-size: 14px;
  padding: 20px;
`;

interface WebGPULineChartProps {
  data: Array<{ t: number; freq: number; x: number }>;
  width?: number;
  height?: number;
}

export const WebGPULineChart: React.FC<WebGPULineChartProps> = ({
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
    if (linePipelineRef.current && gridPipelineRef.current && axisPipelineRef.current) return;

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

    const vertexShader = device.createShaderModule({ code: vertexShaderCode });
    const fragmentShader = device.createShaderModule({ code: fragmentShaderCode });

    const vertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
      },
    ];

    linePipelineRef.current = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: vertexShader, entryPoint: "main", buffers: vertexBuffers },
      fragment: {
        module: fragmentShader,
        entryPoint: "main",
        targets: [{ format }],
      },
      primitive: { topology: "line-strip" },
    });

    gridPipelineRef.current = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: vertexShader, entryPoint: "main", buffers: vertexBuffers },
      fragment: {
        module: fragmentShader,
        entryPoint: "main",
        targets: [{ format }],
      },
      primitive: { topology: "line-list" },
    });

    axisPipelineRef.current = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: vertexShader, entryPoint: "main", buffers: vertexBuffers },
      fragment: {
        module: fragmentShader,
        entryPoint: "main",
        targets: [{ format }],
      },
      primitive: { topology: "line-list" },
    });

    // Line uniform buffer
    const [lr, lg, lb] = hexToRgb(COLORS.primary);
    const lineUniformData = new Float32Array([lr, lg, lb, 1]);
    lineUniformBufferRef.current = device.createBuffer({
      size: lineUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(lineUniformBufferRef.current, 0, lineUniformData);

    // Grid uniform buffer
    const [gr, gg, gb] = hexToRgb(COLORS.border);
    const gridUniformData = new Float32Array([gr, gg, gb, 1]);
    gridUniformBufferRef.current = device.createBuffer({
      size: gridUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gridUniformBufferRef.current, 0, gridUniformData);

    // Axis uniform buffer
    const [ar, ag, ab] = hexToRgb(COLORS.textDisabled);
    const axisUniformData = new Float32Array([ar, ag, ab, 1]);
    axisUniformBufferRef.current = device.createBuffer({
      size: axisUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(axisUniformBufferRef.current, 0, axisUniformData);

    // Create bind groups
    lineBindGroupRef.current = device.createBindGroup({
      layout: linePipelineRef.current.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: lineUniformBufferRef.current } }],
    });

    gridBindGroupRef.current = device.createBindGroup({
      layout: gridPipelineRef.current.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: gridUniformBufferRef.current } }],
    });

    axisBindGroupRef.current = device.createBindGroup({
      layout: axisPipelineRef.current.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: axisUniformBufferRef.current } }],
    });
  };

  const draw = (chartData: Array<{ t: number; freq: number; x: number }>) => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const format = formatRef.current;
    const canvas = canvasRef.current;
    const linePipeline = linePipelineRef.current;
    const gridPipeline = gridPipelineRef.current;
    const axisPipeline = axisPipelineRef.current;
    const lineBindGroup = lineBindGroupRef.current;
    const gridBindGroup = gridBindGroupRef.current;
    const axisBindGroup = axisBindGroupRef.current;

    if (
      !device ||
      !context ||
      !format ||
      !canvas ||
      !linePipeline ||
      !gridPipeline ||
      !axisPipeline ||
      !lineBindGroup ||
      !gridBindGroup ||
      !axisBindGroup
    ) {
      return;
    }

    setCanvasSize(canvas);
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const padding = 40;
    const chartWidth = canvasWidth - 2 * padding;
    const chartHeight = canvasHeight - 2 * padding;

    const xMin = Math.min(...chartData.map((d) => d.freq));
    const xMax = Math.max(...chartData.map((d) => d.freq));
    const yMin = 0;
    const yMax = Math.max(...chartData.map((d) => d.x), 0.000001) * 1.1;

    // Generate line vertices
    const vertices: number[] = [];
    for (let i = 0; i < chartData.length; i++) {
      const point = chartData[i];
      const x = padding + ((point.freq - xMin) / (xMax - xMin || 1)) * chartWidth;
      const y = canvasHeight - padding - ((point.x - yMin) / (yMax - yMin || 1)) * chartHeight;

      const ndcX = (x / canvasWidth) * 2 - 1;
      const ndcY = -((y / canvasHeight) * 2 - 1);
      vertices.push(ndcX, ndcY);
    }

    // Generate grid vertices
    const gridVertices: number[] = [];
    const gridLines = 10;
    for (let i = 0; i <= gridLines; i++) {
      const x = padding + (i / gridLines) * chartWidth;
      const ndcX = (x / canvasWidth) * 2 - 1;
      const ndcY1 = -((padding / canvasHeight) * 2 - 1);
      const ndcY2 = -(((canvasHeight - padding) / canvasHeight) * 2 - 1);
      gridVertices.push(ndcX, ndcY1, ndcX, ndcY2);
    }
    for (let i = 0; i <= gridLines; i++) {
      const y = padding + (i / gridLines) * chartHeight;
      const ndcY = -((y / canvasHeight) * 2 - 1);
      const ndcX1 = (padding / canvasWidth) * 2 - 1;
      const ndcX2 = ((canvasWidth - padding) / canvasWidth) * 2 - 1;
      gridVertices.push(ndcX1, ndcY, ndcX2, ndcY);
    }

    // Generate axis vertices
    const axisVertices = generateAxisVertices(chartData, canvasWidth, canvasHeight);

    const lineData = new Float32Array(vertices);
    const gridData = new Float32Array(gridVertices);
    const axisData = new Float32Array(axisVertices);

    // Clean up old buffers
    lastBuffersRef.current?.lineVertexBuffer.destroy();
    lastBuffersRef.current?.gridVertexBuffer.destroy();
    lastBuffersRef.current?.axisVertexBuffer.destroy();

    // Create new buffers
    const lineVertexBuffer = device.createBuffer({
      size: lineData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(lineVertexBuffer, 0, lineData);

    const gridVertexBuffer = device.createBuffer({
      size: gridData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gridVertexBuffer, 0, gridData);

    const axisVertexBuffer = device.createBuffer({
      size: axisData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(axisVertexBuffer, 0, axisData);

    lastBuffersRef.current = { lineVertexBuffer, gridVertexBuffer, axisVertexBuffer };

    // Render
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.102, g: 0.102, b: 0.102, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    // Draw grid
    renderPass.setPipeline(gridPipeline);
    renderPass.setBindGroup(0, gridBindGroup);
    renderPass.setVertexBuffer(0, gridVertexBuffer);
    renderPass.draw(gridData.length / 2);

    // Draw axes
    renderPass.setPipeline(axisPipeline);
    renderPass.setBindGroup(0, axisBindGroup);
    renderPass.setVertexBuffer(0, axisVertexBuffer);
    renderPass.draw(axisData.length / 2);

    // Draw line
    renderPass.setPipeline(linePipeline);
    renderPass.setBindGroup(0, lineBindGroup);
    renderPass.setVertexBuffer(0, lineVertexBuffer);
    renderPass.draw(lineData.length / 2);

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setIsSupported(null);
      setError(null);

      const canvas = canvasRef.current;
      if (!canvas) return;

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
        if (cancelled) return;

        const context = canvas.getContext("webgpu");
        if (!context) {
          setIsSupported(false);
          setError("Failed to get WebGPU context");
          return;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();

        deviceRef.current = device;
        contextRef.current = context;
        formatRef.current = format;

        setCanvasSize(canvas);
        context.configure({ device, format, alphaMode: "premultiplied" });

        ensurePipelines(device, format);

        if (cancelled) return;
        setIsSupported(true);
        draw(data);
      } catch (e) {
        if (cancelled) return;
        setIsSupported(false);
        setError(e instanceof Error ? e.message : "WebGPU initialization failed");
      }
    };

    init();

    return () => {
      cancelled = true;
      lastBuffersRef.current?.lineVertexBuffer.destroy();
      lastBuffersRef.current?.gridVertexBuffer.destroy();
      lastBuffersRef.current?.axisVertexBuffer.destroy();
      lastBuffersRef.current = null;
    };
  }, [width, height]);

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
      {isSupported === null && <FallbackMessage>Initializing WebGPU...</FallbackMessage>}
      {isSupported === false && (
        <FallbackMessage>
          <div>WebGPU not available</div>
          <div
            style={{
              fontSize: "12px",
              marginTop: "10px",
              color: COLORS.textMuted,
            }}
          >
            {error}
          </div>
        </FallbackMessage>
      )}
    </CanvasContainer>
  );
};
