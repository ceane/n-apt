import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { resolvePlaywrightPassword } from "../support/authCredentials";

test.use({
  launchOptions: {
    args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox"],
  },
});

const FFT_COMPUTE_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/fft_compute.wgsl"),
  "utf8",
);
const DEV_PASSWORD = resolvePlaywrightPassword();

type PowerCase = {
  fftSize: number;
  txIfftSize: number;
  windowType: number;
};

const POWER_CASES: PowerCase[] = [
  { fftSize: 2_048, txIfftSize: 2_048, windowType: 0 },
  { fftSize: 8_192, txIfftSize: 8_192, windowType: 0 },
  { fftSize: 65_536, txIfftSize: 262_144, windowType: 0 },
  { fftSize: 65_536, txIfftSize: 262_144, windowType: 1 },
];

async function authenticate(page: Page) {
  await page.goto("/");
  await expect(
    page.locator("text=Secure Access Required for N-APT"),
  ).toBeVisible({ timeout: 20_000 });

  const usePasswordLink = page.locator("text=Use password instead");
  if (await usePasswordLink.isVisible()) await usePasswordLink.click();

  await page.locator('input[placeholder="Password"]').fill(DEV_PASSWORD);
  await page.locator('button:has-text("Authenticate")').click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("n-apt-session-token")), {
      timeout: 15_000,
    })
    .toBeTruthy();
}

test.describe("Mock Tx Rust/WGSL power contract", () => {
  test("executes fft_compute.wgsl against complex_baseband.rs frames", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await authenticate(page);

    const result = await page.evaluate(
      async ({ shaderCode, powerCases }) => {
        if (!navigator.gpu) return { available: false as const };
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { available: false as const };
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({ code: shaderCode });

        const pipelines = {
          window: device.createComputePipeline({
            layout: "auto",
            compute: { module, entryPoint: "rtl_sdr_iq_to_dbm" },
          }),
          bitReverse: device.createComputePipeline({
            layout: "auto",
            compute: { module, entryPoint: "fft_bit_reversal" },
          }),
          fft: device.createComputePipeline({
            layout: "auto",
            compute: { module, entryPoint: "fft_compute" },
          }),
          power: device.createComputePipeline({
            layout: "auto",
            compute: { module, entryPoint: "rtl_sdr_power_spectrum_dbm" },
          }),
        };

        const windowValue = (index: number, size: number, type: number) => {
          if (type === 0) return 1;
          const t = index / (size - 1);
          if (type === 1) return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
          if (type === 2) return 0.54 - 0.46 * Math.cos(2 * Math.PI * t);
          if (type === 3) {
            return 0.42 - 0.5 * Math.cos(2 * Math.PI * t)
              + 0.08 * Math.cos(4 * Math.PI * t);
          }
          return 0.355768 - 0.487396 * Math.cos(2 * Math.PI * t)
            + 0.144232 * Math.cos(4 * Math.PI * t)
            - 0.012604 * Math.cos(6 * Math.PI * t);
        };

        const fft = (real: Float64Array, imag: Float64Array) => {
          const n = real.length;
          for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
              [real[i], real[j]] = [real[j], real[i]];
              [imag[i], imag[j]] = [imag[j], imag[i]];
            }
          }
          for (let length = 2; length <= n; length <<= 1) {
            const angle = -2 * Math.PI / length;
            const wLengthReal = Math.cos(angle);
            const wLengthImag = Math.sin(angle);
            for (let start = 0; start < n; start += length) {
              let wReal = 1;
              let wImag = 0;
              const half = length >> 1;
              for (let i = 0; i < half; i++) {
                const even = start + i;
                const odd = even + half;
                const oddReal = real[odd] * wReal - imag[odd] * wImag;
                const oddImag = real[odd] * wImag + imag[odd] * wReal;
                const evenReal = real[even];
                const evenImag = imag[even];
                real[even] = evenReal + oddReal;
                imag[even] = evenImag + oddImag;
                real[odd] = evenReal - oddReal;
                imag[odd] = evenImag - oddImag;
                const nextWReal = wReal * wLengthReal - wImag * wLengthImag;
                wImag = wReal * wLengthImag + wImag * wLengthReal;
                wReal = nextWReal;
              }
            }
          }
        };

        const makeParams = (
          size: number,
          stage: number,
          windowType: number,
          normalization: number,
          calibrationDb: number,
        ) => {
          const data = new ArrayBuffer(64);
          const view = new DataView(data);
          view.setUint32(0, stage, true);
          view.setInt32(4, 1, true);
          view.setUint32(8, size, true);
          view.setUint32(12, windowType, true);
          view.setFloat32(16, normalization, true);
          view.setFloat32(20, -120, true);
          view.setFloat32(24, 0, true);
          view.setUint32(28, size, true);
          view.setFloat32(32, 137_100_000, true);
          view.setFloat32(36, 6_270_000, true);
          view.setFloat32(40, 0, true);
          view.setFloat32(44, calibrationDb, true);
          view.setFloat32(48, 0, true);
          view.setUint32(52, 0, true);
          view.setUint32(56, 0, true);
          view.setUint32(60, 0, true);
          return new Uint8Array(data);
        };

        const run = async (powerCase: PowerCase) => {
          const query = new URLSearchParams({
            fft_size: String(powerCase.fftSize),
            tx_ifft_size: String(powerCase.txIfftSize),
            sample_rate_hz: "6270000",
            bandwidth_hz: "3200000",
            power_dbm: "-18",
            signal: "wifi",
          });
          const token = localStorage.getItem("n-apt-session-token");
          const response = await fetch(
            `/api/debug/mock-tx-power-frame?${query.toString()}`,
            { headers: { Authorization: `Bearer ${token ?? ""}` } },
          );
          if (!response.ok) throw new Error(`frame request failed: ${response.status}`);
          const rawBytes = new Uint8Array(await response.arrayBuffer());
          const size = powerCase.fftSize;
          const calibrationDb = Number(
            response.headers.get("x-mock-tx-calibration-db") ?? "15",
          );
          const rawWords = new Uint32Array(rawBytes.buffer);
          const byteLength = size * 8;
          const storage = (
            bytes: number,
            usage: number,
            source?: ArrayBufferView,
          ) => {
            const buffer = device.createBuffer({ size: bytes, usage });
            if (source) device.queue.writeBuffer(buffer, 0, source);
            return buffer;
          };
          const inputBuffer = storage(
            byteLength,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          );
          const outputBuffer = storage(
            byteLength,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          );
          const tempBuffer = storage(
            byteLength,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          );
          const rawBuffer = storage(
            rawWords.byteLength,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            rawWords,
          );
          const paramsBuffer = storage(
            64,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          );
          const readbackBuffer = device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const bindGroups = {
            window: device.createBindGroup({
              layout: pipelines.window.getBindGroupLayout(0),
              entries: [
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 3, resource: { buffer: paramsBuffer } },
                { binding: 4, resource: { buffer: rawBuffer } },
              ],
            }),
            bitReverse: device.createBindGroup({
              layout: pipelines.bitReverse.getBindGroupLayout(0),
              entries: [
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 2, resource: { buffer: tempBuffer } },
                { binding: 3, resource: { buffer: paramsBuffer } },
              ],
            }),
            fft: device.createBindGroup({
              layout: pipelines.fft.getBindGroupLayout(0),
              entries: [
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 2, resource: { buffer: tempBuffer } },
                { binding: 3, resource: { buffer: paramsBuffer } },
              ],
            }),
            power: device.createBindGroup({
              layout: pipelines.power.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: inputBuffer } },
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 3, resource: { buffer: paramsBuffer } },
              ],
            }),
          };
          const writeParams = (
            stage: number,
            normalization: number,
          ) => device.queue.writeBuffer(
            paramsBuffer,
            0,
            makeParams(
              size,
              stage,
              powerCase.windowType,
              normalization,
              calibrationDb,
            ),
          );
          const normalization = size * Array.from(
            { length: size },
            (_, index) => windowValue(index, size, powerCase.windowType) ** 2,
          ).reduce((sum, value) => sum + value, 0);
          const stages = Math.log2(size);
          const submitStage = async (
            pipeline: GPUComputePipeline,
            bindGroup: GPUBindGroup,
            stage: number,
            workgroups: number,
            copies: Array<[GPUBuffer, GPUBuffer]>,
          ) => {
            writeParams(stage, normalization);
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(workgroups);
            pass.end();
            for (const [source, destination] of copies) {
              encoder.copyBufferToBuffer(source, 0, destination, 0, byteLength);
            }
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
          };

          await submitStage(
            pipelines.window,
            bindGroups.window,
            0,
            Math.ceil(size / 256),
            [[outputBuffer, tempBuffer]],
          );
          await submitStage(
            pipelines.bitReverse,
            bindGroups.bitReverse,
            stages,
            Math.ceil(size / 256),
            [[outputBuffer, tempBuffer]],
          );
          for (let stage = 0; stage < stages; stage++) {
            await submitStage(
              pipelines.fft,
              bindGroups.fft,
              stage,
              Math.ceil(size / 2 / 256),
              [[outputBuffer, tempBuffer]],
            );
          }
          const fftResultCopy = device.createCommandEncoder();
          fftResultCopy.copyBufferToBuffer(
            outputBuffer,
            0,
            inputBuffer,
            0,
            byteLength,
          );
          device.queue.submit([fftResultCopy.finish()]);
          await device.queue.onSubmittedWorkDone();
          await submitStage(
            pipelines.power,
            bindGroups.power,
            0,
            Math.ceil(size / 256),
            [[outputBuffer, readbackBuffer]],
          );
          await readbackBuffer.mapAsync(GPUMapMode.READ);
          const gpuValues = Array.from(
            new Float32Array(readbackBuffer.getMappedRange().slice(0)),
          ).filter((_, index) => index % 2 === 0);
          readbackBuffer.unmap();

          const real = new Float64Array(size);
          const imag = new Float64Array(size);
          for (let index = 0; index < size; index++) {
            real[index] = (rawBytes[index * 2] - 128) / 128
              * windowValue(index, size, powerCase.windowType);
            imag[index] = (rawBytes[index * 2 + 1] - 128) / 128
              * windowValue(index, size, powerCase.windowType);
          }
          fft(real, imag);
          const expected = Array.from({ length: size }, (_, index) => {
            const shifted = (index + size / 2) % size;
            const power = (real[shifted] ** 2 + imag[shifted] ** 2)
              / normalization;
            return 10 * Math.log10(Math.max(power, 1e-20)) + calibrationDb;
          });
          let maxMeaningfulBinError = 0;
          let maxMeaningfulLinearPowerRelativeError = 0;
          let expectedLinearPower = 0;
          let gpuLinearPower = 0;
          for (let index = 0; index < size; index++) {
            const expectedPower = 10 ** ((expected[index] - calibrationDb) / 10);
            const gpuPower = 10 ** ((gpuValues[index] - calibrationDb) / 10);
            const binError = Math.abs(gpuValues[index] - expected[index]);
            const relativePowerError = Math.abs(gpuPower - expectedPower)
              / Math.max(expectedPower, 1e-20);
            if (expected[index] >= -70) {
              maxMeaningfulBinError = Math.max(maxMeaningfulBinError, binError);
              maxMeaningfulLinearPowerRelativeError = Math.max(
                maxMeaningfulLinearPowerRelativeError,
                relativePowerError,
              );
            }
            expectedLinearPower += expectedPower;
            gpuLinearPower += gpuPower;
          }
          return {
            fftSize: size,
            txIfftSize: powerCase.txIfftSize,
            maxMeaningfulBinError,
            maxMeaningfulLinearPowerRelativeError,
            firstGpuBins: gpuValues.slice(0, 4),
            firstExpectedBins: expected.slice(0, 4),
            expectedPeakDbm: Math.max(...expected),
            gpuPeakDbm: Math.max(...gpuValues),
            expectedIntegratedDbm: 10 * Math.log10(expectedLinearPower) + calibrationDb,
            gpuIntegratedDbm: 10 * Math.log10(gpuLinearPower) + calibrationDb,
            requestedDbm: -18,
          };
        };

        const outputs = [];
        for (const powerCase of powerCases) outputs.push(await run(powerCase));
        return { available: true as const, outputs };
      },
      { shaderCode: FFT_COMPUTE_WGSL, powerCases: POWER_CASES },
    );

    test.skip(!result.available, "Chromium WebGPU adapter unavailable");
    expect(result.available).toBe(true);
    if (!result.available) return;
    for (const output of result.outputs) {
      expect(
        output.maxMeaningfulBinError,
        `FFT=${output.fftSize} gpu=${output.firstGpuBins} expected=${output.firstExpectedBins}`,
      ).toBeLessThan(0.35);
      expect(output.maxMeaningfulLinearPowerRelativeError).toBeLessThan(0.2);
      expect(
        Math.abs(output.gpuIntegratedDbm - output.expectedIntegratedDbm),
        `FFT=${output.fftSize}, IFFT=${output.txIfftSize}`,
      ).toBeLessThan(0.05);
      const requestedPowerMetric = output.txIfftSize <= 2_048
        ? output.gpuPeakDbm
        : output.gpuIntegratedDbm;
      expect(
        Math.abs(requestedPowerMetric - output.requestedDbm),
        `FFT=${output.fftSize}, IFFT=${output.txIfftSize}`,
      ).toBeLessThan(3.0);
    }
  });
});
