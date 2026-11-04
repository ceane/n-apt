import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox"],
  },
});

const SPIKE_COMPUTE_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/spike_compute.wgsl"),
  "utf8",
);

test("spike compute selects stable peaks and avoids recovery duplicates", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async (shaderCode) => {
    if (!navigator.gpu) return { available: false as const };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false as const };

    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const length = 64;
    const maxSpikes = 1024;
    const spikeBytes = maxSpikes * 16;
    const createBuffer = (size: number, usage: number) =>
      device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | usage,
      });
    const waveform = createBuffer(length * 4, 0);
    const paramsBuffer = createBuffer(16, 0);
    const spikes = createBuffer(spikeBytes, GPUBufferUsage.COPY_SRC);
    const spikeCount = createBuffer(4, GPUBufferUsage.COPY_SRC);
    const floorResult = createBuffer(12, 0);
    const sourcePeakIndices = createBuffer(length * 4, 0);
    const readback = device.createBuffer({
      size: 4 + spikeBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const floorData = new ArrayBuffer(12);
    new DataView(floorData).setFloat32(0, -90, true);
    device.queue.writeBuffer(floorResult, 0, new Uint8Array(floorData));
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: waveform } },
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: { buffer: spikes } },
        { binding: 3, resource: { buffer: spikeCount } },
        { binding: 4, resource: { buffer: floorResult } },
        { binding: 5, resource: { buffer: sourcePeakIndices } },
      ],
    });

    const run = async (
      values: number[],
      indices: number[],
      recoveryPass = 0,
      existingIndices: number[] = [],
    ) => {
      const params = new ArrayBuffer(16);
      const paramsView = new DataView(params);
      paramsView.setUint32(0, length, true);
      paramsView.setUint32(4, 1, true);
      paramsView.setFloat32(8, 0, true);
      paramsView.setUint32(12, recoveryPass, true);
      const existing = new Uint32Array(existingIndices.length * 4);
      existingIndices.forEach((index, slot) => (existing[slot * 4] = index));

      device.queue.writeBuffer(waveform, 0, new Float32Array(values));
      device.queue.writeBuffer(paramsBuffer, 0, new Uint8Array(params));
      device.queue.writeBuffer(spikes, 0, new Uint8Array(spikeBytes));
      if (existing.byteLength) device.queue.writeBuffer(spikes, 0, existing);
      device.queue.writeBuffer(
        spikeCount,
        0,
        new Uint32Array([existingIndices.length]),
      );
      device.queue.writeBuffer(sourcePeakIndices, 0, new Uint32Array(indices));

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(spikeCount, 0, readback, 0, 4);
      encoder.copyBufferToBuffer(spikes, 0, readback, 4, spikeBytes);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await readback.mapAsync(GPUMapMode.READ);
      const output = new DataView(readback.getMappedRange().slice(0));
      const count = output.getUint32(0, true);
      const peakIndices = Array.from({ length: count }, (_, slot) =>
        output.getUint32(4 + slot * 16, true),
      );
      readback.unmap();
      return { count, indices: peakIndices };
    };

    const sourceIndices = Array.from({ length }, (_, index) => index * 3);
    const plateau = Array(length).fill(-90);
    plateau[20] = plateau[21] = plateau[22] = -50;
    const plateauResult = await run(plateau, sourceIndices);

    const rightEdge = Array(length).fill(-90);
    rightEdge[60] = -88;
    rightEdge[61] = -87;
    rightEdge[62] = -86;
    rightEdge[63] = -85;
    const rightEdgeResult = await run(rightEdge, sourceIndices);

    const duplicateIndex = 520;
    const recovery = Array(length).fill(-90);
    recovery[20] = -50;
    const recoveryResult = await run(
      recovery,
      Array.from({ length }, (_, index) => 500 + index),
      1,
      [duplicateIndex],
    );

    device.destroy();
    return {
      available: true as const,
      plateau: plateauResult,
      rightEdge: rightEdgeResult,
      recovery: recoveryResult,
    };
  }, SPIKE_COMPUTE_WGSL);

  test.skip(!result.available, "Chromium WebGPU adapter unavailable");
  expect(result.available).toBe(true);
  if (!result.available) return;

  expect(result.plateau).toEqual({ count: 1, indices: [66] });
  expect(result.rightEdge).toEqual({ count: 1, indices: [189] });
  expect(result.recovery).toEqual({ count: 1, indices: [520] });
});
