import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

test.use({
  launchOptions: {
    args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox"],
  },
});

const CLASSIFY_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_classify.wgsl"),
  "utf8",
);
const TEMPORAL_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_temporal.wgsl"),
  "utf8",
);

type Fixture = {
  name: string;
  values?: number[];
  isolated?: boolean;
  edge?: "left" | "right";
  shuffle?: boolean;
  shape?: "wide-u" | "noisy-wide-u" | "flat" | "inverted-dome" | "one-sided-ramp" | "sinc" | "edge-sinc";
  envelopeShape?: "partial-descending" | "partial-ascending" | "irregular" | "jagged-descending" | "flat-valley";
};

const FIXTURES: Fixture[] = [
  {
    name: "deep ordered staircase hat",
    values: [0, 2, 10, 20, 35, 55, 70, 55, 35, 20, 10, 2, 0],
  },
  {
    name: "moderate ordered staircase hat",
    values: [0, 8, 16, 24, 32, 40, 32, 24, 16, 8, 0],
  },
  {
    name: "unimodal bridge with tolerant apex",
    values: [0, 3, 9, 18, 31, 47, 64, 51, 35, 21, 11, 4, 0],
  },
  {
    name: "partial unimodal shoulder",
    values: [0, 4, 10, 18, 29, 42, 57, 70],
    edge: "right",
  },
  {
    name: "asymmetric staircase without symmetric bridge",
    values: [0, 4, 9, 18, 31, 48, 68, 54, 43, 37, 30, 22, 15, 9, 4, 0],
  },
  {
    name: "double ordered hat",
    values: [0, 10, 25, 45, 60, 45, 25, 10, 0, 0, 8, 24, 40, 58, 40, 24, 8, 0],
  },
  {
    name: "extreme random comb",
    values: [0, 80, 2, 70, 1, 65, 4, 90, 0, 75, 3, 60, 1, 85, 0, 70],
  },
  {
    name: "random spike field without symmetric bridge",
    values: [
      0, 18, 4, 31, 7, 12, 28, 3, 24, 9, 36, 5, 16, 2, 29, 11,
      21, 6, 34, 1, 15, 27, 8, 19, 3, 33, 10, 22, 5, 14, 30, 4,
    ],
  },
  {
    name: "isolated extreme spur",
    values: [0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0],
    isolated: true,
  },
  {
    name: "wide shallow U-dip with clump spikes",
    shape: "wide-u",
  },
  {
    name: "noisy wide U envelope",
    shape: "noisy-wide-u",
    shuffle: true,
  },
  {
    name: "flat floor with intermittent spikes",
    shape: "flat",
  },
  {
    name: "inverted dome",
    shape: "inverted-dome",
  },
  {
    name: "one-sided ramp",
    shape: "one-sided-ramp",
  },
  {
    name: "sinc hardware artifact",
    shape: "sinc",
  },
  {
    name: "irregular edge sinc artifact",
    shape: "edge-sinc",
  },
  {
    name: "partial descending envelope",
    envelopeShape: "partial-descending",
  },
  {
    name: "partial ascending envelope",
    envelopeShape: "partial-ascending",
  },
  {
    name: "irregular envelope",
    envelopeShape: "irregular",
  },
  {
    name: "jagged descending envelope",
    envelopeShape: "jagged-descending",
  },
  {
    name: "partial flat valley envelope",
    envelopeShape: "flat-valley",
  },
];

test.describe("N-APT suspension_bridge shader math", () => {
  test("executes classify/finalize WGSL and separates extreme fixtures", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ({ shaderCode, fixtures }) => {
      if (!navigator.gpu) return { available: false as const };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { available: false as const };
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: shaderCode });
      const classifyPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "classify" },
      });
      const finalizePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "finalize" },
      });

      const FLOOR = -90;
      const SOURCE_LENGTH = 256;
      const MAX_SPIKES = 1024;
      const toPoints = (fixture: Fixture) => Array.from({ length: 64 }, (_, index) => {
        if (fixture.isolated) {
          return {
            index: Math.min(SOURCE_LENGTH - 1, 4 + index * 3),
            value: index === 32 ? FLOOR + 100 : FLOOR,
          };
        }
        const values = fixture.values ?? [];
        const position = index / 63 * (values.length - 1);
        const lower = Math.floor(position);
        const upper = Math.min(values.length - 1, lower + 1);
        const fraction = position - lower;
        const pointIndex = fixture.edge === "right"
          ? Math.min(SOURCE_LENGTH - 1, 64 + index * 3)
          : fixture.edge === "left"
            ? Math.min(SOURCE_LENGTH - 1, index * 3)
            : Math.min(SOURCE_LENGTH - 1, 4 + index * 3);
        return {
          index: pointIndex,
          value: FLOOR + values[lower] + (values[upper] - values[lower]) * fraction,
        };
      });

      const run = async (fixture: Fixture) => {
        let points = toPoints(fixture);
        const waveform = new Float32Array(SOURCE_LENGTH).fill(FLOOR);
        if (fixture.shape) {
          const shapePoints = Array.from({ length: 96 }, (_, index) => {
            const x = index / 95;
            const sincArgument = 12 * Math.PI * (2 * x - 1);
            const sincMagnitude = Math.abs(sincArgument) < 0.0001
              ? 1
              : Math.abs(Math.sin(sincArgument) / sincArgument);
            const envelope = fixture.shape === "wide-u" || fixture.shape === "noisy-wide-u"
              ? 20 + 30 * (2 * x - 1) ** 2
              : fixture.shape === "inverted-dome"
                ? 20 + 30 * (1 - (2 * x - 1) ** 2)
                : fixture.shape === "one-sided-ramp"
                  ? 20 + 30 * x
              : fixture.shape === "sinc"
                    ? 18 + 42 * sincMagnitude
                  : fixture.shape === "edge-sinc"
                    ? 16 + 48 * Math.abs(2 * x - 1) ** 1.25
                  : 20;
            const pointIndex = Math.round(x * (SOURCE_LENGTH - 1));
            const lift = fixture.shape === "wide-u"
              ? (index % 6 === 0 ? 14 : 6)
              : fixture.shape === "noisy-wide-u"
                ? [0, 18, 3, 12, 1, 15, 4, 10, 2, 16, 5, 11][index % 12]
              : fixture.shape === "edge-sinc"
                ? 0
                : (index % 5 === 0 ? 12 : 4);
            const value = FLOOR + envelope + lift;
            waveform[pointIndex] = value;
            return { index: pointIndex, value };
          });
          if (fixture.shape === "sinc") {
            for (let index = 0; index < SOURCE_LENGTH; index++) {
              const x = index / (SOURCE_LENGTH - 1);
              const argument = 12 * Math.PI * (2 * x - 1);
              const magnitude = Math.abs(argument) < 0.0001
                ? 1
                : Math.abs(Math.sin(argument) / argument);
              waveform[index] = FLOOR + 18 + 42 * magnitude;
            }
          }
          if (fixture.shape === "edge-sinc") {
            for (let index = 0; index < SOURCE_LENGTH; index++) {
              const x = index / (SOURCE_LENGTH - 1);
              waveform[index] = FLOOR + 16 + 48 * Math.abs(2 * x - 1) ** 1.25;
            }
          }
          points = shapePoints;
        }
        if (fixture.envelopeShape) {
          const envelopePoints = Array.from({ length: 96 }, (_, index) => {
            const t = index / 95;
            const shape = fixture.envelopeShape;
            const base = shape === "partial-descending"
              ? 45 - 32 * t
              : shape === "partial-ascending"
                ? 13 + 32 * t
                : shape === "jagged-descending"
                    ? 45 - 30 * t + [0, 9, -2, 7, -1, 6, -3, 5][index % 8]
                    : shape === "flat-valley"
                      ? 25 + [0, 0.4, -0.2, 0.3, -0.1, 0.2][index % 6]
                    : [18, 39, 21, 34, 16, 31, 23, 42, 19, 36][index % 10];
            const spur = 0;
            const pointIndex = Math.round(t * (SOURCE_LENGTH - 1));
            const value = FLOOR + base + spur;
            waveform[pointIndex] = value;
            return { index: pointIndex, value };
          });
          points = envelopePoints;
        }
        if (fixture.shuffle) {
          // Simulate the atomic append order produced by spike_compute. The
          // waveform remains frequency ordered; only the marker records move.
          points = points.map((point, index) =>
            points[(index * 37) % points.length]);
        }
        const spikeData = new ArrayBuffer(MAX_SPIKES * 16);
        const spikeView = new DataView(spikeData);
        points.forEach((point, index) => {
          waveform[point.index] = point.value;
          spikeView.setUint32(index * 16, point.index, true);
          spikeView.setFloat32(index * 16 + 4, point.value, true);
        });
        const paramsData = new ArrayBuffer(16);
        const paramsView = new DataView(paramsData);
        paramsView.setUint32(0, SOURCE_LENGTH, true);
        paramsView.setUint32(4, SOURCE_LENGTH, true);
        paramsView.setFloat32(8, 1_000_000, true);
        paramsView.setFloat32(12, 4_000_000, true);
        const storage = (size: number, source?: ArrayBufferView) => {
          const buffer = device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          });
          if (source) device.queue.writeBuffer(buffer, 0, source);
          return buffer;
        };
        const waveformBuffer = storage(waveform.byteLength, waveform);
        const paramsBuffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(paramsBuffer, 0, new Uint8Array(paramsData));
        const spikesBuffer = storage(spikeData.byteLength, new Uint8Array(spikeData));
        const resultBuffer = storage(132, new Uint8Array(132));
        const spikeCountBuffer = storage(4, new Uint32Array([points.length]));
        const metricsBuffer = storage(MAX_SPIKES * 16);
        const readbackBuffer = device.createBuffer({
          size: 132,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const classifyBindGroup = device.createBindGroup({
          layout: classifyPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: waveformBuffer } },
            { binding: 1, resource: { buffer: paramsBuffer } },
            { binding: 3, resource: { buffer: resultBuffer } },
          ],
        });
        const finalizeBindGroup = device.createBindGroup({
          layout: finalizePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: waveformBuffer } },
            { binding: 1, resource: { buffer: paramsBuffer } },
            { binding: 2, resource: { buffer: spikesBuffer } },
            { binding: 3, resource: { buffer: resultBuffer } },
            { binding: 4, resource: { buffer: spikeCountBuffer } },
            { binding: 5, resource: { buffer: metricsBuffer } },
          ],
        });
        const encoder = device.createCommandEncoder();
        const classifyPass = encoder.beginComputePass();
        classifyPass.setPipeline(classifyPipeline);
        classifyPass.setBindGroup(0, classifyBindGroup);
        classifyPass.dispatchWorkgroups(Math.ceil(SOURCE_LENGTH / 64));
        classifyPass.end();
        const finalizePass = encoder.beginComputePass();
        finalizePass.setPipeline(finalizePipeline);
        finalizePass.setBindGroup(0, finalizeBindGroup);
        finalizePass.dispatchWorkgroups(1);
        finalizePass.end();
        encoder.copyBufferToBuffer(resultBuffer, 0, readbackBuffer, 0, 132);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const outputBytes = new Uint8Array(readbackBuffer.getMappedRange().slice(0));
        const output = new Float32Array(outputBytes.buffer);
        const outputView = new DataView(outputBytes.buffer);
        readbackBuffer.unmap();
        return {
          bridge: output[14],
          clumpCount: outputView.getUint32(60, true),
          width: output[16],
          shoulder: output[17],
          uDip: output[18],
          fit: output[22],
          residual: output[23],
          sincPenalty: output[25],
          unimodal: outputView.getFloat32(112, true),
          partialBranch: outputView.getFloat32(116, true),
          apexProminence: outputView.getFloat32(120, true),
          shoulderSymmetry: outputView.getFloat32(124, true),
          captureQuality: outputView.getFloat32(128, true),
        };
      };
      const outputs: Record<string, Awaited<ReturnType<typeof run>>> = {};
      for (const fixture of fixtures) outputs[fixture.name] = await run(fixture);
      return { available: true as const, outputs };
    }, { shaderCode: CLASSIFY_WGSL, fixtures: FIXTURES });

    test.skip(!result.available, "Chromium WebGPU adapter unavailable");
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.outputs["deep ordered staircase hat"].bridge).toBeGreaterThan(0.60);
    expect(result.outputs["moderate ordered staircase hat"].bridge).toBeGreaterThan(0.35);
    expect(result.outputs["unimodal bridge with tolerant apex"].unimodal).toBeGreaterThan(0.75);
    expect(result.outputs["unimodal bridge with tolerant apex"].apexProminence).toBeGreaterThan(0.75);
    expect(result.outputs["unimodal bridge with tolerant apex"].shoulderSymmetry).toBeGreaterThan(0.65);
    expect(result.outputs["partial unimodal shoulder"].partialBranch).toBeGreaterThan(0.75);
    expect(result.outputs["partial unimodal shoulder"].unimodal).toBeGreaterThan(0.75);
    expect(result.outputs["double ordered hat"].bridge).toBeGreaterThan(0.60);
    expect(result.outputs["asymmetric staircase without symmetric bridge"].bridge).toBeLessThan(0.45);
    expect(result.outputs["extreme random comb"].bridge).toBeLessThan(0.40);
    expect(result.outputs["extreme random comb"].uDip).toBeLessThan(0.30);
    expect(result.outputs["random spike field without symmetric bridge"].bridge).toBeLessThan(0.25);
    expect(result.outputs["random spike field without symmetric bridge"].uDip).toBeLessThan(0.30);
    expect(result.outputs["random spike field without symmetric bridge"].unimodal).toBeLessThan(0.40);
    expect(result.outputs["isolated extreme spur"].bridge).toBeLessThan(0.10);
    expect(result.outputs["isolated extreme spur"].width).toBeLessThan(0.10);
    expect(result.outputs["isolated extreme spur"].shoulder).toBeLessThan(0.10);
    expect(result.outputs["wide shallow U-dip with clump spikes"].uDip).toBeGreaterThan(0.60);
    expect(result.outputs["flat floor with intermittent spikes"].uDip).toBeLessThan(0.15);
    expect(result.outputs["inverted dome"].uDip).toBeLessThan(0.15);
    expect(result.outputs["one-sided ramp"].uDip).toBeLessThan(0.30);
    expect(result.outputs["sinc hardware artifact"].sincPenalty).toBeGreaterThan(0.60);
    expect(result.outputs["sinc hardware artifact"].captureQuality).toBeLessThan(0.40);
    expect(result.outputs["irregular edge sinc artifact"].sincPenalty).toBeGreaterThan(0.55);
    expect(result.outputs["irregular edge sinc artifact"].captureQuality).toBeLessThan(0.45);
    expect(result.outputs["wide shallow U-dip with clump spikes"].captureQuality).toBeGreaterThan(0.65);
    expect(result.outputs["wide shallow U-dip with clump spikes"].sincPenalty).toBeLessThan(0.35);
    expect(result.outputs["noisy wide U envelope"].sincPenalty).toBeLessThan(0.45);
    expect(result.outputs["partial descending envelope"].fit).toBeGreaterThan(0.60);
    expect(result.outputs["partial descending envelope"].residual).toBeGreaterThan(0.50);
    expect(result.outputs["partial ascending envelope"].fit).toBeGreaterThan(0.60);
    expect(result.outputs["partial ascending envelope"].residual).toBeGreaterThan(0.50);
    expect(result.outputs["irregular envelope"].fit).toBeLessThan(0.45);
    expect(result.outputs["irregular envelope"].residual).toBeLessThan(0.45);
    expect(result.outputs["partial flat valley envelope"].fit).toBeGreaterThan(0.60);
    expect(result.outputs["partial flat valley envelope"].residual).toBeGreaterThan(0.60);
    expect(result.outputs["wide shallow U-dip with clump spikes"].fit).toBeGreaterThan(0.60);
    expect(result.outputs["wide shallow U-dip with clump spikes"].residual).toBeGreaterThan(0.60);
    expect(result.outputs["noisy wide U envelope"].fit).toBeGreaterThan(0.60);
    expect(result.outputs["noisy wide U envelope"].residual).toBeGreaterThan(0.60);
  });

  test("keeps the one-frame baseline while requiring persistent higher-order structure", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (shaderCode) => {
      if (!navigator.gpu) return { available: false as const };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { available: false as const };
      const device = await adapter.requestDevice();
      const HISTORY_LENGTH = 32;
      const module = device.createShaderModule({ code: shaderCode });
      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });
      const storage = (size: number, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) =>
        device.createBuffer({ size, usage });
      const baselineBuffer = storage(8);
      const metricsBuffer = storage(128);
      const historyBuffer = storage(HISTORY_LENGTH * 32);
      const paramsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const decisionBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const readbackBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: baselineBuffer } },
          { binding: 1, resource: { buffer: metricsBuffer } },
          { binding: 2, resource: { buffer: historyBuffer } },
          { binding: 3, resource: { buffer: paramsBuffer } },
          { binding: 4, resource: { buffer: decisionBuffer } },
        ],
      });
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));

      const runSequence = async (
        activeFrames: boolean[],
        metricsMode: "strong" | "partial" | "partial-u" | "low-rise" | "mock-u" | "sinc" = "strong",
      ) => {
        let writeIndex = 0;
        let validCount = 0;
        let output = new DataView(new ArrayBuffer(32));
        for (const active of activeFrames) {
          const baseline = new ArrayBuffer(8);
          const baselineView = new DataView(baseline);
          baselineView.setUint32(
            0,
            active && metricsMode === "strong" ? 1 : 0,
            true,
          );
          baselineView.setFloat32(
            4,
            active && metricsMode === "strong" ? 0.9 : 0.18,
            true,
          );
          device.queue.writeBuffer(baselineBuffer, 0, new Uint8Array(baseline));

          const metrics = new ArrayBuffer(128);
          const metricsView = new DataView(metrics);
          metricsView.setFloat32(44, active ? 0.25 : 0.02, true);
          metricsView.setFloat32(
            56,
            active && (metricsMode === "partial" || metricsMode === "partial-u")
              ? 0.47
              : active && metricsMode === "low-rise"
                ? 0.20
              : active && metricsMode === "mock-u"
                ? 0.05
              : active
                ? 0.85
                : 0.05,
            true,
          );
          metricsView.setUint32(
            60,
            active && metricsMode === "low-rise"
              ? 2
              : active && (metricsMode === "partial" || metricsMode === "partial-u")
              ? 1
              : active && metricsMode === "mock-u"
                ? 0
              : active
                ? 3
                : 0,
            true,
          );
          metricsView.setFloat32(
            64,
            active && metricsMode === "low-rise" ? 0.49 : active ? 0.65 : 0.1,
            true,
          );
          metricsView.setFloat32(
            68,
            active && metricsMode === "low-rise" ? 0.59 : active ? 0.65 : 0.1,
            true,
          );
          metricsView.setFloat32(
            72,
            active && metricsMode === "low-rise"
              ? 0.0
              : active && metricsMode === "partial-u"
              ? 0.70
              : active && metricsMode === "mock-u"
                ? 0.95
              : active && metricsMode === "partial"
                ? 0.0
                : active
                  ? 0.65
                  : 0.02,
            true,
          );
          metricsView.setFloat32(
            100,
            active && metricsMode === "sinc" ? 0.95 : 0.0,
            true,
          );
          metricsView.setFloat32(
            104,
            active && metricsMode === "low-rise" ? 0.49 : 0.0,
            true,
          );
          metricsView.setFloat32(88, active ? 0.8 : 0.1, true);
          device.queue.writeBuffer(metricsBuffer, 0, new Uint8Array(metrics));

          device.queue.writeBuffer(
            paramsBuffer,
            0,
            new Uint32Array([HISTORY_LENGTH, writeIndex, validCount, 0]),
          );
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(1);
          pass.end();
          encoder.copyBufferToBuffer(decisionBuffer, 0, readbackBuffer, 0, 32);
          device.queue.submit([encoder.finish()]);
          await device.queue.onSubmittedWorkDone();
          await readbackBuffer.mapAsync(GPUMapMode.READ);
          output = new DataView(readbackBuffer.getMappedRange().slice(0));
          readbackBuffer.unmap();
          writeIndex = (writeIndex + 1) % HISTORY_LENGTH;
          validCount = Math.min(HISTORY_LENGTH, validCount + 1);
        }
        return {
          baselineIsNapt: output.getUint32(0, true) !== 0,
          temporalIsNapt: output.getUint32(4, true) !== 0,
          temporalConfidence: output.getFloat32(12, true),
          persistence: output.getFloat32(16, true),
          temporalBridgeScore: output.getFloat32(20, true),
          temporalUDipScore: output.getFloat32(24, true),
          frameCount: output.getUint32(28, true),
        };
      };

      const persistent = await runSequence([true, true, true, true]);
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const intermittent = await runSequence([true, false, true, false]);
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const persistentPartial = await runSequence(
        [true, true, true, true],
        "partial",
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const persistentLowRise = await runSequence(
        [true, true, true, true],
        "low-rise",
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const pulsedPartial = await runSequence(
        [false, false, true, false, true, false, true, false, true, false, true],
        "partial",
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const pulsedPartialU = await runSequence(
        [false, false, true, false, true, false, true, false, true, false, true],
        "partial-u",
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const widelySpacedBridge = await runSequence(
        [true, false, false, false, false, false, false, true, false, false, false, false, false, false, true],
        "partial",
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const mockWideUWithoutBridge = await runSequence(
        [true, true, true, true, true, true, true, true],
        "mock-u",
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const oneFrameBridge = await runSequence(
        [true, false, false, false],
      );
      device.queue.writeBuffer(historyBuffer, 0, new Uint32Array(HISTORY_LENGTH * 8));
      const oneFrameLowRise = await runSequence(
        [true, false, false, false],
        "low-rise",
      );
      const sincArtifact = await runSequence(
        [true, true, true, true],
        "sinc",
      );
      return {
        available: true as const,
        persistent,
        intermittent,
        persistentPartial,
        persistentLowRise,
        pulsedPartial,
        pulsedPartialU,
        widelySpacedBridge,
        mockWideUWithoutBridge,
        oneFrameBridge,
        oneFrameLowRise,
        sincArtifact,
      };
    }, TEMPORAL_WGSL);

    test.skip(!result.available, "Chromium WebGPU adapter unavailable");
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.persistent.baselineIsNapt).toBe(true);
    expect(result.persistent.temporalIsNapt).toBe(true);
    expect(result.persistent.persistence).toBeGreaterThanOrEqual(0.99);
    expect(result.persistent.frameCount).toBe(4);
    expect(result.intermittent.baselineIsNapt).toBe(false);
    expect(result.intermittent.temporalIsNapt).toBe(false);
    // Pulse-aware persistence can exceed raw frame occupancy, but two events
    // still do not reach the three-event cadence support required for Yes.
    expect(result.intermittent.persistence).toBeLessThan(0.75);
    expect(result.persistentPartial.baselineIsNapt).toBe(false);
    expect(result.persistentPartial.temporalIsNapt).toBe(true);
    expect(result.persistentPartial.persistence).toBeGreaterThanOrEqual(0.99);
    expect(result.persistentPartial.temporalConfidence).toBeGreaterThanOrEqual(0.60);
    expect(result.persistentPartial.temporalBridgeScore).toBeGreaterThanOrEqual(0.70);
    expect(result.persistentLowRise.baselineIsNapt).toBe(false);
    expect(result.persistentLowRise.temporalIsNapt).toBe(true);
    expect(result.persistentLowRise.persistence).toBeGreaterThanOrEqual(0.99);
    expect(result.persistentLowRise.temporalBridgeScore).toBeGreaterThanOrEqual(0.45);
    expect(result.pulsedPartial.baselineIsNapt).toBe(false);
    expect(result.pulsedPartial.temporalIsNapt).toBe(true);
    expect(result.pulsedPartial.persistence).toBeGreaterThanOrEqual(0.99);
    expect(result.pulsedPartial.temporalBridgeScore).toBeGreaterThanOrEqual(0.70);
    expect(result.pulsedPartialU.baselineIsNapt).toBe(false);
    expect(result.pulsedPartialU.temporalUDipScore).toBeGreaterThanOrEqual(0.70);
    expect(result.widelySpacedBridge.baselineIsNapt).toBe(false);
    expect(result.widelySpacedBridge.temporalIsNapt).toBe(true);
    expect(result.widelySpacedBridge.persistence).toBeGreaterThanOrEqual(0.75);
    expect(result.widelySpacedBridge.temporalConfidence).toBeGreaterThanOrEqual(0.60);
    expect(result.mockWideUWithoutBridge.temporalUDipScore).toBeLessThan(0.30);
    expect(result.mockWideUWithoutBridge.temporalIsNapt).toBe(false);
    expect(result.oneFrameBridge.temporalBridgeScore).toBeLessThan(0.30);
    expect(result.oneFrameBridge.temporalIsNapt).toBe(false);
    expect(result.oneFrameLowRise.temporalIsNapt).toBe(true);
    expect(result.oneFrameLowRise.temporalConfidence).toBeGreaterThanOrEqual(0.75);
    expect(result.sincArtifact.baselineIsNapt).toBe(false);
    expect(result.sincArtifact.temporalIsNapt).toBe(false);
    expect(result.sincArtifact.temporalConfidence).toBeLessThan(0.60);
  });
});
