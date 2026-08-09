import { useCallback, useRef } from "react";
import { WATERFALL_RETUNE_WGSL } from "@n-apt/consts/shaders/waterfall_retune";

const alignTo = (value: number, alignment: number) =>
  Math.ceil(value / alignment) * alignment;

type RetuneComputeState = {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
  previousBuffer: GPUBuffer;
  currentBuffer: GPUBuffer;
  outputBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
  capacityBytes: number;
};

export interface ComputeWaterfallRetuneRowOptions {
  device: GPUDevice;
  previous: Float32Array;
  current: Float32Array;
  driftBins: number;
  progress: number;
  floorDb?: number;
}

export function useWaterfallRetuneCompute() {
  const stateRef = useRef<RetuneComputeState | null>(null);
  const paramsScratchRef = useRef(new Float32Array(4));

  const destroyState = useCallback((state: RetuneComputeState | null) => {
    state?.previousBuffer.destroy();
    state?.currentBuffer.destroy();
    state?.outputBuffer.destroy();
    state?.paramsBuffer.destroy();
  }, []);

  const ensureState = useCallback(
    (device: GPUDevice, rowLength: number): RetuneComputeState | null => {
      if (rowLength <= 0) return null;

      const capacityBytes = alignTo(rowLength * 4, 256);
      const existing = stateRef.current;
      if (
        existing &&
        existing.device === device &&
        existing.capacityBytes >= capacityBytes
      ) {
        return existing;
      }

      destroyState(existing);

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
        ],
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
          module: device.createShaderModule({ code: WATERFALL_RETUNE_WGSL }),
          entryPoint: "main",
        },
      });
      const createRowBuffer = (usage: GPUBufferUsageFlags) =>
        device.createBuffer({
          size: capacityBytes,
          usage,
        });

      const state: RetuneComputeState = {
        device,
        pipeline,
        bindGroupLayout,
        previousBuffer: createRowBuffer(
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        ),
        currentBuffer: createRowBuffer(
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        ),
        outputBuffer: createRowBuffer(
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        ),
        paramsBuffer: device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        capacityBytes,
      };

      stateRef.current = state;
      return state;
    },
    [destroyState],
  );

  const computeWaterfallRetuneRow = useCallback(
    ({
      device,
      previous,
      current,
      driftBins,
      progress,
      floorDb = -200,
    }: ComputeWaterfallRetuneRowOptions): GPUBuffer | null => {
      if (previous.length !== current.length || current.length === 0) {
        return null;
      }

      try {
        const state = ensureState(device, current.length);
        if (!state) return null;

        device.queue.writeBuffer(
          state.previousBuffer,
          0,
          previous.buffer as ArrayBuffer,
          previous.byteOffset,
          previous.byteLength,
        );
        device.queue.writeBuffer(
          state.currentBuffer,
          0,
          current.buffer as ArrayBuffer,
          current.byteOffset,
          current.byteLength,
        );

        const params = paramsScratchRef.current;
        params[0] = current.length;
        params[1] = driftBins;
        params[2] = progress;
        params[3] = floorDb;
        device.queue.writeBuffer(
          state.paramsBuffer,
          0,
          params.buffer as ArrayBuffer,
          params.byteOffset,
          params.byteLength,
        );

        const bindGroup = device.createBindGroup({
          layout: state.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: state.previousBuffer } },
            { binding: 1, resource: { buffer: state.currentBuffer } },
            { binding: 2, resource: { buffer: state.outputBuffer } },
            { binding: 3, resource: { buffer: state.paramsBuffer } },
          ],
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(current.length / 64));
        pass.end();
        device.queue.submit([encoder.finish()]);

        return state.outputBuffer;
      } catch (error) {
        console.error("Waterfall retune compute failed:", error);
        return null;
      }
    },
    [ensureState],
  );

  const cleanup = useCallback(() => {
    destroyState(stateRef.current);
    stateRef.current = null;
  }, [destroyState]);

  return { computeWaterfallRetuneRow, cleanup };
}
