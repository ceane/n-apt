#!/usr/bin/env node

/**
 * Manual raw-IQ -> FFT -> WebGPU N-APT classifier harness.
 *
 * This is deliberately not a Jest/Playwright CI test. It is an operator-run
 * calibration tool for decrypted output produced by manual_napt_capture_harness.mjs.
 * It feeds the full FFT frame to the same resample, floor, spike, classifier,
 * finalizer, and decision stages used by the browser renderer.
 */

import { existsSync, readFileSync as readFileSyncNode } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  aggregateClassifierFrames,
  evaluateRegressionCase,
  parseRegressionManifest,
} from "./napt_classifier_regression.mjs";

const DEFAULT_URL = "http://localhost:5173/";
const DEFAULT_DISPLAY_WIDTH = 1024;
const MAX_SPIKES = 1024;
const NAPT_TEMPORAL_HISTORY_LENGTH = 32;

function parseArgs(argv) {
  const options = { manifest_dirs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    if (argument === "--assert") {
      options.assert = true;
      continue;
    }
    if (argument === "--headed") {
      options.headed = true;
      continue;
    }
    const key = argument.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key.replaceAll("_", "-")}`);
    index += 1;
    if (key === "manifest_dir") options.manifest_dirs.push(value);
    else if (key === "regression_manifest") options.regression_manifest = value;
    else options[key] = value;
  }
  return options;
}

export function parseFrameSelection(selection, frameCount) {
  if (frameCount <= 0) return [];
  if (!selection || selection.trim().toLowerCase() === "all") {
    return Array.from({ length: frameCount }, (_, index) => index);
  }
  const selected = [];
  const seen = new Set();
  for (const token of selection.split(",")) {
    const index = Number.parseInt(token.trim(), 10);
    if (Number.isInteger(index) && index >= 0 && index < frameCount && !seen.has(index)) {
      seen.add(index);
      selected.push(index);
    }
  }
  return selected;
}

function fft(re, im) {
  const length = re.length;
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >>> 1;
    for (; j & bit; bit >>>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const rootRe = Math.cos(angle);
    const rootIm = Math.sin(angle);
    const half = size >>> 1;
    for (let start = 0; start < length; start += size) {
      let wRe = 1;
      let wIm = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddRe = re[odd] * wRe - im[odd] * wIm;
        const oddIm = re[odd] * wIm + im[odd] * wRe;
        const evenRe = re[even];
        const evenIm = im[even];
        re[even] = evenRe + oddRe;
        im[even] = evenIm + oddIm;
        re[odd] = evenRe - oddRe;
        im[odd] = evenIm - oddIm;
        const nextRe = wRe * rootRe - wIm * rootIm;
        wIm = wRe * rootIm + wIm * rootRe;
        wRe = nextRe;
      }
    }
  }
}

function fftFrame(iq, frameIndex, fftSize) {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const offset = frameIndex * fftSize * 2;
  for (let index = 0; index < fftSize; index += 1) {
    re[index] = iq[offset + index * 2] - 127.5;
    im[index] = iq[offset + index * 2 + 1] - 127.5;
  }
  fft(re, im);
  const waveform = new Float32Array(fftSize);
  for (let index = 0; index < fftSize; index += 1) {
    const source = (index + fftSize / 2) & (fftSize - 1);
    const magnitude = Math.hypot(re[source], im[source]) / fftSize;
    waveform[index] = Math.max(-120, 20 * Math.log10(Math.max(1e-12, magnitude)));
  }
  return waveform;
}

function loadCapture(manifestDir, frameSelection) {
  const manifestPath = path.join(manifestDir, "manifest.json");
  const rawPath = path.join(manifestDir, "raw.iq.u8");
  if (!existsSync(manifestPath) || !existsSync(rawPath)) {
    throw new Error(`Expected manifest.json and raw.iq.u8 in ${manifestDir}`);
  }
  const manifest = JSON.parse(readFileSyncNode(manifestPath, "utf8"));
  const fftSize = Number(manifest.fft_size);
  const completeFrameCount = Number(manifest.complete_frame_count);
  if (!Number.isInteger(fftSize) || fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) {
    throw new Error(`Invalid fft_size in ${manifestPath}`);
  }
  const indices = parseFrameSelection(frameSelection, completeFrameCount);
  const iq = new Uint8Array(readFileSyncNode(rawPath));
  const sampleRate = Number(
    manifest.capture_metadata?.sample_rate_hz ??
    manifest.capture_metadata?.capture_sample_rate_hz ??
    manifest.capture_metadata?.hardware_sample_rate_hz ??
    manifest.sample_rate_hz ??
    manifest.capture_sample_rate_hz ??
    0,
  );
  const centerFrequency = Number(manifest.capture_metadata?.center_frequency_hz ?? manifest.capture_metadata?.center_frequency ?? 0);
  const frequencyMin = centerFrequency - sampleRate / 2;
  const frequencyMax = centerFrequency + sampleRate / 2;
  return {
    manifest,
    frames: indices.map((index) => ({ index, waveform: fftFrame(iq, index, fftSize) })),
    frequencyMin: Number.isFinite(frequencyMin) ? frequencyMin : 0,
    frequencyMax: Number.isFinite(frequencyMax) && frequencyMax > 0 ? frequencyMax : sampleRate,
  };
}

function help() {
  console.log(`Manual N-APT classifier harness (WebGPU)

This tool is intentionally manual and never runs as part of CI. Start the local
app first, then score raw IQ output made by manual_napt_capture_harness.mjs.

Usage:
  node scripts/test/manual_napt_classifier_harness.mjs \
    --manifest-dir /private/tmp/napt-harness/<capture> \
    --frames 0,8,16,24,32
  node scripts/test/manual_napt_classifier_harness.mjs \
    --regression-manifest test/fixtures/napt-classifier/regression.json --assert

Options:
  --manifest-dir PATH  Directory containing manifest.json and raw.iq.u8; repeatable
  --regression-manifest PATH  Explicit labeled capture regression manifest
  --assert              Exit non-zero when a labeled regression case fails
  --frames LIST        Frame indices or 'all' (default: 0)
  --display-width N    GPU resample width (default: 1024)
  --url URL            Local app URL (default: ${DEFAULT_URL})
  --headed             Show Chromium while running
  --help               Show this help

The classifier receives full FFT-sized frames. The harness reports GPU errors
and marks a result invalid if the readback is not populated.
`);
}

async function scoreCapture(page, capture, shaderCode, displayWidth) {
  return page.evaluate(async ({ shaderCode, displayWidth, maxSpikes, frames, frequencyMin, frequencyMax }) => {
    if (!navigator.gpu) return { available: false, reason: "navigator.gpu unavailable" };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: "WebGPU adapter unavailable" };
    const device = await adapter.requestDevice();
    const NAPT_TEMPORAL_HISTORY_LENGTH = 32;
    const errors = [];
    device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
    const module = (code) => device.createShaderModule({ code });
    const layout = (types) => device.createBindGroupLayout({
      entries: types.map(([binding, type]) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    });
    const pipeline = (code, entryPoint, bindGroupLayout) => device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: module(code), entryPoint },
    });
    const resampleLayout = layout([[0, "read-only-storage"], [1, "storage"], [2, "uniform"], [3, "storage"]]);
    const floorLayout = layout([[0, "read-only-storage"], [1, "storage"], [2, "uniform"]]);
    const spikeLayout = layout([[0, "read-only-storage"], [1, "read-only-storage"], [2, "storage"], [3, "storage"], [4, "read-only-storage"], [5, "read-only-storage"]]);
    const classifyLayout = layout([[0, "read-only-storage"], [1, "uniform"], [2, "read-only-storage"], [3, "storage"], [4, "storage"], [5, "storage"]]);
    const detectLayout = layout([[0, "read-only-storage"], [1, "storage"]]);
    const resamplePipeline = pipeline(shaderCode.resample, "main", resampleLayout);
    const floorPipeline = pipeline(shaderCode.floor, "reduce", floorLayout);
    const floorFinalizePipeline = pipeline(shaderCode.floor, "finalize", floorLayout);
    const spikePipeline = pipeline(shaderCode.spike, "main", spikeLayout);
    const classifyPipeline = pipeline(shaderCode.classify, "classify", classifyLayout);
    const classifyFinalizePipeline = pipeline(shaderCode.classify, "finalize", classifyLayout);
    const detectPipeline = pipeline(shaderCode.detect, "main", detectLayout);
    const temporalLayout = layout([
      [0, "read-only-storage"],
      [1, "read-only-storage"],
      [2, "storage"],
      [3, "uniform"],
      [4, "storage"],
    ]);
    const temporalPipeline = pipeline(shaderCode.temporal, "main", temporalLayout);
    const storage = (size) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const storageParams = (bytes) => {
      const buffer = storage(Math.max(16, bytes.byteLength));
      device.queue.writeBuffer(buffer, 0, bytes);
      return buffer;
    };
    const uniform = (bytes) => {
      const buffer = device.createBuffer({ size: Math.max(16, bytes.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, bytes);
      return buffer;
    };
    const readback = (size) => device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const temporalHistoryBuffer = storage(NAPT_TEMPORAL_HISTORY_LENGTH * 32);
    const temporalParamsBuffer = uniform(new Uint32Array([NAPT_TEMPORAL_HISTORY_LENGTH, 0, 0, 0]));
    const temporalDecisionBuffer = storage(32);
    const temporalReadbackBuffer = readback(32);
    device.queue.writeBuffer(
      temporalHistoryBuffer,
      0,
      new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 8),
    );
    let temporalHistoryIndex = 0;
    let temporalHistoryCount = 0;
    const result = [];
    const gpuErrorScope = async (label) => {
      const error = await device.popErrorScope();
      if (error) errors.push(`${label}: ${error.message}`);
    };

    for (const frame of frames) {
      const input = new Float32Array(frame.waveform);
      const sourceLength = input.length;
      const rawBuffer = storage(input.byteLength);
      device.queue.writeBuffer(rawBuffer, 0, input);
      const waveformBuffer = storage(displayWidth * 4);
      const peakIndexBuffer = storage(displayWidth * 4);
      const resampleParams = new Uint32Array([sourceLength, displayWidth, 0, 0]);
      const resampleGroup = device.createBindGroup({ layout: resampleLayout, entries: [
        { binding: 0, resource: { buffer: rawBuffer } },
        { binding: 1, resource: { buffer: waveformBuffer } },
        { binding: 2, resource: { buffer: uniform(resampleParams) } },
        { binding: 3, resource: { buffer: peakIndexBuffer } },
      ] });
      const floorBuffer = storage(12);
      const floorParamsBuffer = uniform(new Uint32Array([displayWidth, 0, 0, 0]));
      const floorGroup = device.createBindGroup({ layout: floorLayout, entries: [
        { binding: 0, resource: { buffer: waveformBuffer } },
        { binding: 1, resource: { buffer: floorBuffer } },
        { binding: 2, resource: { buffer: floorParamsBuffer } },
      ] });
      const spikeBuffer = storage(maxSpikes * 16);
      const spikeCountBuffer = storage(4);
      const spikeParams = new ArrayBuffer(16);
      const spikeParamsView = new DataView(spikeParams);
      spikeParamsView.setUint32(0, displayWidth, true);
      spikeParamsView.setUint32(4, 2, true);
      spikeParamsView.setFloat32(8, 3, true);
      const recoveryParams = spikeParams.slice(0);
      new DataView(recoveryParams).setUint32(12, 1, true);
      const spikeGroup = (params) => device.createBindGroup({ layout: spikeLayout, entries: [
        { binding: 0, resource: { buffer: waveformBuffer } },
        { binding: 1, resource: { buffer: storageParams(new Uint8Array(params)) } },
        { binding: 2, resource: { buffer: spikeBuffer } },
        { binding: 3, resource: { buffer: spikeCountBuffer } },
        { binding: 4, resource: { buffer: floorBuffer } },
        { binding: 5, resource: { buffer: peakIndexBuffer } },
      ] });
      const primarySpikeGroup = spikeGroup(spikeParams);
      const recoverySpikeGroup = spikeGroup(recoveryParams);
      const resultBuffer = storage(128);
      const metricsBuffer = storage(maxSpikes * 16);
      const countBuffer = spikeCountBuffer;
      const classifyParams = new ArrayBuffer(16);
      const classifyParamsView = new DataView(classifyParams);
      classifyParamsView.setUint32(0, displayWidth, true);
      classifyParamsView.setUint32(4, sourceLength, true);
      classifyParamsView.setFloat32(8, frequencyMin, true);
      classifyParamsView.setFloat32(12, frequencyMax, true);
      const classifyGroup = device.createBindGroup({ layout: classifyLayout, entries: [
        { binding: 0, resource: { buffer: waveformBuffer } },
        { binding: 1, resource: { buffer: uniform(new Uint8Array(classifyParams)) } },
        { binding: 2, resource: { buffer: spikeBuffer } },
        { binding: 3, resource: { buffer: resultBuffer } },
        { binding: 4, resource: { buffer: countBuffer } },
        { binding: 5, resource: { buffer: metricsBuffer } },
      ] });
      const decisionBuffer = storage(8);
      const detectGroup = device.createBindGroup({ layout: detectLayout, entries: [
        { binding: 0, resource: { buffer: resultBuffer } },
        { binding: 1, resource: { buffer: decisionBuffer } },
      ] });
      const temporalGroup = device.createBindGroup({ layout: temporalLayout, entries: [
        { binding: 0, resource: { buffer: decisionBuffer } },
        { binding: 1, resource: { buffer: resultBuffer } },
        { binding: 2, resource: { buffer: temporalHistoryBuffer } },
        { binding: 3, resource: { buffer: temporalParamsBuffer } },
        { binding: 4, resource: { buffer: temporalDecisionBuffer } },
      ] });
      const resultReadback = readback(128);
      const decisionReadback = readback(8);
      const temporalReadback = temporalReadbackBuffer;
      const countReadback = readback(4);
      device.queue.writeBuffer(
        temporalParamsBuffer,
        0,
        new Uint32Array([
          NAPT_TEMPORAL_HISTORY_LENGTH,
          temporalHistoryIndex,
          temporalHistoryCount,
          0,
        ]),
      );
      device.pushErrorScope("validation");
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(floorBuffer);
      encoder.clearBuffer(spikeCountBuffer);
      encoder.clearBuffer(resultBuffer);
      encoder.clearBuffer(decisionBuffer);
      const pass = encoder.beginComputePass();
      pass.setPipeline(resamplePipeline); pass.setBindGroup(0, resampleGroup); pass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
      pass.setPipeline(floorPipeline); pass.setBindGroup(0, floorGroup); pass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
      pass.setPipeline(floorFinalizePipeline); pass.setBindGroup(0, floorGroup); pass.dispatchWorkgroups(1);
      pass.setPipeline(spikePipeline); pass.setBindGroup(0, primarySpikeGroup); pass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
      pass.setBindGroup(0, recoverySpikeGroup); pass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
      pass.setPipeline(classifyPipeline); pass.setBindGroup(0, classifyGroup); pass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
      pass.setPipeline(classifyFinalizePipeline); pass.setBindGroup(0, classifyGroup); pass.dispatchWorkgroups(1);
      pass.setPipeline(detectPipeline); pass.setBindGroup(0, detectGroup); pass.dispatchWorkgroups(1);
      pass.setPipeline(temporalPipeline); pass.setBindGroup(0, temporalGroup); pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(resultBuffer, 0, resultReadback, 0, 128);
      encoder.copyBufferToBuffer(decisionBuffer, 0, decisionReadback, 0, 8);
      encoder.copyBufferToBuffer(temporalDecisionBuffer, 0, temporalReadback, 0, 32);
      encoder.copyBufferToBuffer(spikeCountBuffer, 0, countReadback, 0, 4);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await gpuErrorScope(`frame ${frame.index}`);
      await resultReadback.mapAsync(GPUMapMode.READ);
      const resultView = new DataView(resultReadback.getMappedRange().slice(0));
      resultReadback.unmap();
      await decisionReadback.mapAsync(GPUMapMode.READ);
      const decisionView = new DataView(decisionReadback.getMappedRange().slice(0));
      decisionReadback.unmap();
      await temporalReadback.mapAsync(GPUMapMode.READ);
      const temporalView = new DataView(temporalReadback.getMappedRange().slice(0));
      temporalReadback.unmap();
      await countReadback.mapAsync(GPUMapMode.READ);
      const count = new Uint32Array(countReadback.getMappedRange().slice(0))[0];
      countReadback.unmap();
      result.push({
        frame: frame.index,
        pointCount: Math.min(count, maxSpikes),
        suspensionBridge: resultView.getFloat32(56, true),
        clumpCount: resultView.getUint32(60, true),
        bridgeWidth: resultView.getFloat32(64, true),
        bridgeShoulder: resultView.getFloat32(68, true),
        uDip: resultView.getFloat32(72, true),
        floorRelativePower: resultView.getFloat32(76, true),
        temporalStability: resultView.getFloat32(80, true),
        aboveFloorFraction: resultView.getFloat32(44, true),
        periodicity: resultView.getFloat32(48, true),
        envelopeFit: resultView.getFloat32(88, true),
        envelopeResidual: resultView.getFloat32(92, true),
        sincPenalty: resultView.getFloat32(100, true),
        lowRiseBridge: resultView.getFloat32(104, true),
        uDipSource: resultView.getUint32(108, true),
        unimodalBridge: resultView.getFloat32(112, true),
        partialBridge: resultView.getFloat32(116, true),
        apexProminence: resultView.getFloat32(120, true),
        shoulderSymmetry: resultView.getFloat32(124, true),
        floorDbm: resultView.getFloat32(40, true),
        confidence: temporalView.getFloat32(12, true),
        isNapt: temporalView.getUint32(4, true) !== 0,
        baselineConfidence: decisionView.getFloat32(4, true),
        baselineIsNapt: decisionView.getUint32(0, true) !== 0,
        multiFrameConfidence: temporalView.getFloat32(12, true),
        multiFrameIsNapt: temporalView.getUint32(4, true) !== 0,
        multiFramePersistence: temporalView.getFloat32(16, true),
        multiFrameBridgeScore: temporalView.getFloat32(20, true),
        multiFrameUDipScore: temporalView.getFloat32(24, true),
        multiFrameFrameCount: temporalView.getUint32(28, true),
      });
      temporalHistoryIndex =
        (temporalHistoryIndex + 1) % NAPT_TEMPORAL_HISTORY_LENGTH;
      temporalHistoryCount = Math.min(
        NAPT_TEMPORAL_HISTORY_LENGTH,
        temporalHistoryCount + 1,
      );
      for (const buffer of [rawBuffer, waveformBuffer, peakIndexBuffer, floorBuffer, floorParamsBuffer, spikeBuffer, spikeCountBuffer, resultBuffer, metricsBuffer, decisionBuffer, resultReadback, decisionReadback, countReadback]) buffer.destroy();
    }
    for (const buffer of [temporalHistoryBuffer, temporalParamsBuffer, temporalDecisionBuffer, temporalReadbackBuffer]) buffer.destroy();
    const valid = errors.length === 0 && result.length > 0 && result.every((frame) =>
      frame.pointCount > 0 && Number.isFinite(frame.confidence) && frame.floorDbm !== 0);
    return { available: true, valid, errors, frames: result };
  }, {
    shaderCode,
    displayWidth,
    frames: capture.frames,
    frequencyMin: capture.frequencyMin,
    frequencyMax: capture.frequencyMax,
    maxSpikes: MAX_SPIKES,
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (args.manifest_dirs.length === 0 && !args.regression_manifest) {
    throw new Error("--manifest-dir or --regression-manifest is required");
  }
  const displayWidth = Number.parseInt(args.display_width ?? DEFAULT_DISPLAY_WIDTH, 10);
  if (!Number.isInteger(displayWidth) || displayWidth <= 0) throw new Error("--display-width must be a positive integer");
  let regressionManifest = null;
  if (args.regression_manifest) {
    const regressionPath = path.resolve(args.regression_manifest);
    regressionManifest = parseRegressionManifest(
      JSON.parse(readFileSyncNode(regressionPath, "utf8")),
      path.dirname(regressionPath),
    );
  }
  const captureSpecs = regressionManifest
    ? regressionManifest.cases.map((testCase) => ({ testCase, directory: testCase.capture_dir }))
    : args.manifest_dirs.map((directory) => ({ directory: path.resolve(directory) }));
  const captures = captureSpecs.map(({ directory }) =>
    loadCapture(directory, args.frames ?? (regressionManifest ? "all" : "0")));
  const shaderRoot = path.resolve("src/ts/shaders");
  const shaderCode = {
    resample: readFileSyncNode(path.join(shaderRoot, "resample.wgsl"), "utf8"),
    floor: readFileSyncNode(path.join(shaderRoot, "floor_avg.wgsl"), "utf8"),
    spike: readFileSyncNode(path.join(shaderRoot, "spike_compute.wgsl"), "utf8"),
    classify: readFileSyncNode(path.join(shaderRoot, "napt_classify.wgsl"), "utf8"),
    detect: readFileSyncNode(path.join(shaderRoot, "napt_detect.wgsl"), "utf8"),
    temporal: readFileSyncNode(path.join(shaderRoot, "napt_temporal.wgsl"), "utf8"),
  };
  const browser = await chromium.launch({
    headless: args.headed ? false : true,
    args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(args.url ?? DEFAULT_URL, { waitUntil: "domcontentloaded" });
    const output = [];
    for (let index = 0; index < captures.length; index += 1) {
      const capture = captures[index];
      const score = await scoreCapture(page, capture, shaderCode, displayWidth);
      const testCase = captureSpecs[index].testCase;
      if (testCase) {
        const aggregate = score.valid
          ? aggregateClassifierFrames(score.frames)
          : { frame_count: 0, metrics: {}, temporal_yes_fraction: 0, baseline_yes_fraction: 0, frames: [] };
        const assertions = score.valid
          ? evaluateRegressionCase(testCase, aggregate)
          : { ok: false, failures: ["GPU score readback was invalid"] };
        output.push({ id: testCase.id, expected: testCase.expected, ...score, aggregate, assertions });
      } else {
        output.push({ label: capture.manifest.input_file, ...score });
      }
    }
    console.log(JSON.stringify({ manual: true, display_width: displayWidth, captures: output }, null, 2));
    if (args.assert && output.some((capture) => capture.assertions && !capture.assertions.ok)) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  run().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
