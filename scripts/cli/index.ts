#!/usr/bin/env node
import process from "node:process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";
import {
  hasNaptReceiveDefaults,
  resolveCliCaptureFftSize,
  resolveCliCaptureFrequencySpan,
  resolveNaptReceiveDefaults,
  resolveRequestedDevice,
} from "@n-apt/capture/policy";
import {
  executeAgentTool,
  fetchAgentMarkdown,
  printAgentCapabilities,
} from "./agent";
import { cliVersion, renderCliHelp, resolveCliHelpTopic } from "./help";
import { CliUsageError, validateCliArguments } from "./options";
import { verifyCaptureArtifact } from "./artifact";
import {
  assertAspectMountAvailable,
  getCaptureOutputPath,
  loadCaptureDestination,
  saveCaptureDestination,
  writeCaptureArtifact,
} from "./destinations";
import { prepareDemodulation, runDemodulationAlgorithm, type DemodAlgorithm } from "@n-apt/demodulation/utils/demodHarness";
import { inspectSignalFile, summarizeSignal, validateSignalInput } from "@n-apt/cli/signalCli";
import { resolveCliSnapshotFrameCount } from "@n-apt/cli/snapshotPolicy";
import {
  DEMODULATION_QUALITY_PROFILE,
  CLASSIFIER_TRAINING_QUALITY_PROFILE,
  IQ_CAPTURE_CLI_QUALITY_PROFILE,
  resolveCapturePreflightOptions,
  validateCapturePreflightAcknowledgement,
} from "@n-apt/features/capture/quality";

const backend = process.env.N_APT_BACKEND_URL ?? "http://localhost:8765";
const frontend = process.env.N_APT_FRONTEND_URL ?? "http://localhost:5173";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

function usage(): never {
  console.error(renderCliHelp("root"));
  process.exit(2);
}

async function demod(args: string[]) {
  const input = flag(args, "--input", "");
  if (!input) throw new Error("demod requires --input <raw-IQ-file>");
  const output = flag(args, "--output", "demodulated.iq");
  const centerFrequencyHz = Number(flag(args, "--center-frequency", "0"));
  const minHz = Number(flag(args, "--min-frequency", String(centerFrequencyHz)));
  const maxHz = Number(flag(args, "--max-frequency", String(centerFrequencyHz + 1)));
  const sampleRateHz = Number(flag(args, "--sample-rate", "2400000"));
  const algorithm = flag(args, "--algorithm", "fm") as DemodAlgorithm;
  const plan = prepareDemodulation({ centerFrequencyHz, frequencyRangeHz: [minHz, maxHz], sampleRateHz, algorithm });
  const processed = runDemodulationAlgorithm(algorithm, new Uint8Array(await readFile(input)), { sampleRateHz, targetSampleRate: sampleRateHz, centerFrequencyHz, bandwidthHz: maxHz - minHz });
  const trailer = Buffer.from(JSON.stringify({ ...plan.trailer, reference: { parent_artifact: input }, tool_version: "n-apt-cli" }));
  const processedBytes = Buffer.from(processed.buffer, processed.byteOffset, processed.byteLength);
  const chunk = Buffer.alloc(20 + processedBytes.length); chunk.writeBigUInt64LE(0n, 0); chunk.writeUInt32LE(0, 8); chunk.writeBigUInt64LE(BigInt(processedBytes.length), 12); processedBytes.copy(chunk, 20);
  const frames = Buffer.from("[]");
  const marker = Buffer.alloc(24); Buffer.from("NAPTTRLR").copy(marker); marker[8] = 1; marker.writeBigUInt64LE(BigInt(trailer.length), 16);
  const metadata: any = { format: "iq", format_version: 4, interleaving: "IQ", center_frequency_hz: centerFrequencyHz, capture_sample_rate_hz: sampleRateHz, frequency_range: [minHz, maxHz], bandwidth: maxHz - minHz, fft_size: plan.fftSize, temporal_resolution: "lossless", data_format: "demod_pcm_f32", sections: { binary: { offset_bytes: 0, length_bytes: chunk.length, encoding: "pcm_f32_mono", encrypted: false }, trailer: { offset_bytes: 0, length_bytes: marker.length + trailer.length, encoding: "utf8_json", version: 1 } } };
  let metadataBytes = Buffer.from(JSON.stringify(metadata));
  metadata.sections.binary.offset_bytes = 40 + metadataBytes.length + frames.length; metadata.sections.trailer.offset_bytes = metadata.sections.binary.offset_bytes + chunk.length;
  metadataBytes = Buffer.from(JSON.stringify(metadata)); metadata.sections.binary.offset_bytes = 40 + metadataBytes.length + frames.length; metadata.sections.trailer.offset_bytes = metadata.sections.binary.offset_bytes + chunk.length;
  const header = Buffer.alloc(40); Buffer.from("NAPT-IQ3").copy(header); header.writeBigUInt64LE(BigInt(metadataBytes.length), 8); header.writeBigUInt64LE(BigInt(frames.length), 16); header.writeBigUInt64LE(BigInt(chunk.length), 24);
  await writeFile(output, Buffer.concat([header, metadataBytes, frames, chunk, marker, trailer]));
  console.log(JSON.stringify({ output, algorithm, fftSize: plan.fftSize, bytes: processed.length }));
}

async function signals(args: string[]) {
  const operation = args[1];
  if (!operation || operation === "--help" || operation === "help") usage();
  if (args.includes("--help")) usage();
  if (operation === "capture") {
    if (!args.includes("--allow-mutations")) {
      throw new Error("signals capture requires --allow-mutations; RX capture changes device state");
    }
    await requireAppRunning("backend");
    const sources = await fetchSources();
    const selected = resolveRequestedDevice({
      requested: await resolveDeviceArgument(args, sources),
      sources,
    });
    await iqCapture(args, selected.id, selected);
    return;
  }
  const input = flag(args, "--input", args[2] ?? "");
  if (!input) throw new Error(`signals ${operation ?? "command"} requires an input file`);
  const bytes = new Uint8Array(await readFile(input));
  if (operation === "inspect") {
    const result = inspectSignalFile(bytes, input);
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : JSON.stringify(result));
    return;
  }
  if (operation === "spectrum") {
    const result = summarizeSignal(bytes, input);
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : JSON.stringify(result));
    return;
  }
  if (operation === "validate") {
    const result = validateSignalInput(inspectSignalFile(bytes, input).metadata);
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : JSON.stringify(result));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (operation === "demod") {
    const demodArgs = ["demod", "--input", input, ...args.slice(3)];
    await demod(demodArgs);
    return;
  }
  usage();
}

type BackendStatus = {
  activeSource: string | null;
  sources: any[];
};

async function fetchBackendStatus(): Promise<BackendStatus> {
  const response = await fetch(`${backend}/status`);
  if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: { active_source?: string | null; sources?: unknown[] };
  };
  const sources = body.status?.sources;
  if (!Array.isArray(sources)) throw new Error("Backend status did not include sources");
  return {
    activeSource: body.status?.active_source ?? null,
    sources: sources as any[],
  };
}

async function fetchSources() {
  return (await fetchBackendStatus()).sources;
}

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

type ServiceRequirement = "backend" | "frontend" | "both";

function requiredServices(requirement: ServiceRequirement): string[] {
  if (requirement === "backend") return [`${backend}/status`];
  if (requirement === "frontend") return [frontend];
  return [`${backend}/status`, frontend];
}

async function requiredServicesReady(requirement: ServiceRequirement): Promise<boolean> {
  const checks = await Promise.all(requiredServices(requirement).map(isReady));
  return checks.every(Boolean);
}

async function requireAppRunning(requirement: ServiceRequirement = "both") {
  if (await requiredServicesReady(requirement)) return;
  const service = requirement === "both" ? "backend and frontend" : requirement;
  throw new Error(
    `Required N-APT ${service} service is not running. Start the Rust backend and frontend with \`npm run dev\` from the repository root.`,
  );
}

async function selectDevice(
  deviceId: string,
  receiveDefaults: { gainDb: number; ppm: number },
) {
  const token = await authenticateCli();
  const { WebSocket } = await import("ws");
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${backend.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for device selection"));
    }, 15000);
    let settingsSent = false;
    socket.on("open", () => socket.send(JSON.stringify({ type: "select_source", source_id: deviceId })));
    socket.on("message", (raw) => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === "active_source" && message.source_id === deviceId) {
        if (settingsSent) return;
        settingsSent = true;
        socket.send(JSON.stringify({
          type: "settings",
          gain: receiveDefaults.gainDb,
          ppm: receiveDefaults.ppm,
          tunerAGC: false,
          rtlAGC: false,
        }));
        // Rust handles messages from this socket serially. Give the settings
        // command time to enter that queue, then verify via authoritative status.
        setTimeout(() => {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }, 100);
      }
      if (message.type === "error" && message.source_id === deviceId) {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(message.message ?? "Device selection failed"));
      }
    });
    socket.on("error", reject);
  });
}

async function waitForDeviceSettings(
  deviceId: string,
  receiveDefaults: { gainDb: number; ppm: number },
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const source = (await fetchSources()).find((item) => item.id === deviceId);
    if (source && hasNaptReceiveDefaults(source, receiveDefaults)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Rust did not confirm gain ${receiveDefaults.gainDb} dB and PPM ${receiveDefaults.ppm}`,
  );
}

/** Authenticates directly with Rust without mounting or driving the web UI. */
async function authenticateCli(): Promise<string> {
  if (process.env.N_APT_SESSION_TOKEN) return process.env.N_APT_SESSION_TOKEN;
  const password = process.env.UNSAFE_LOCAL_USER_PASSWORD;
  if (!password) throw new Error("UNSAFE_LOCAL_USER_PASSWORD is missing from .env.local");
  const challengeResponse = await fetch(`${backend}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!challengeResponse.ok) throw new Error("Rust authentication challenge failed");
  const challenge = (await challengeResponse.json()) as {
    challenge_id: string;
    nonce: string;
  };
  const { computeHmac } = await import("@n-apt/crypto/webcrypto");
  const hmac = await computeHmac(password, challenge.nonce);
  const verifyResponse = await fetch(`${backend}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: challenge.challenge_id, hmac }),
  });
  if (!verifyResponse.ok) throw new Error("Rust CLI authentication failed");
  const result = (await verifyResponse.json()) as { token: string };
  return result.token;
}

async function fetchSnapshotFrames(token: string, fftSize: number, frameCount: 1 | 64) {
  const query = new URLSearchParams({ frames: String(frameCount), fft_size: String(fftSize) });
  const response = await fetch(`${backend}/api/cli/snapshot-frame?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Rust snapshot frame request failed: HTTP ${response.status}`);
  }
  return (await response.json()) as Array<{
    iq_data: number[];
    center_frequency_hz?: number;
    sample_rate?: number;
    timestamp: number;
  }>;
}

async function snapshot(args: string[], selected: any) {
  const receiveDefaults = resolveNaptReceiveDefaults(selected);
  if (selected.id !== "mock-apt") {
    await selectDevice(selected.id, receiveDefaults);
    await waitForDeviceSettings(selected.id, receiveDefaults);
  }
  const token = await authenticateCli();
  const fftSize = resolveCliCaptureFftSize(args);
  const frameCount = resolveCliSnapshotFrameCount(args.includes("--waterfall"));
  const frames = await fetchSnapshotFrames(token, fftSize, frameCount);
  const frame = frames[frames.length - 1];
  if (!frame?.iq_data?.length) throw new Error("Rust returned no usable I/Q frames");
  const gainDb = Number(flag(args, "--gain", String(receiveDefaults.gainDb)));
  const ppm = Number(flag(args, "--ppm", String(receiveDefaults.ppm)));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--disable-gpu-sandbox"],
  });
  try {
    const page = await browser.newPage({ colorScheme: flag(args, "--theme", "dark") as "dark" | "light" });
    const harnessErrors: string[] = [];
    page.on("pageerror", (error) => harnessErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") harnessErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        harnessErrors.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(`${frontend}/cli-snapshot.html`, { waitUntil: "networkidle" });
    try {
      await page.waitForFunction(
        () => typeof (window as any).__renderNaptCliSnapshot === "function",
        undefined,
        { timeout: 10000 },
      );
    } catch {
      throw new Error(`CLI snapshot harness failed to load: ${harnessErrors.join(" | ")}`);
    }
    const dataUrl = await page.evaluate(
      async (request) => (window as any).__renderNaptCliSnapshot(request),
      {
        iqFrames: frames.map((item) => item.iq_data),
        centerFrequencyHz: frame.center_frequency_hz ?? 0,
        sampleRateHz: frame.sample_rate ?? 3_200_000,
        snapshotTimestamp: frame.timestamp ?? Date.now(),
        deviceName: selected.name ?? selected.id,
        gainDb,
        ppm,
        fftSize,
        waterfall: args.includes("--waterfall"),
        grid: args.includes("--grid"),
        stats: args.includes("--stats"),
        theme: flag(args, "--theme", "dark"),
        width: 1400,
        spectrumHeight: 520,
        waterfallHeight: 520,
      },
    );
    const output = flag(args, "--output", join(process.env.HOME ?? ".", "Downloads", `n-apt_snapshot_${Date.now()}.png`));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, Buffer.from(String(dataUrl).split(",")[1], "base64"));
    console.log(`Saved snapshot: ${output}`);
  } finally {
    await browser.close();
  }
}

async function iqCapture(args: string[], deviceId: string, selected: any) {
  const destinationArg = flag(args, "--destination", "");
  const outputOverride = flag(args, "--output", "") || undefined;
  const destination: "local" | "aspect" = destinationArg
    ? (destinationArg as "local" | "aspect")
    : (await loadCaptureDestination()) === "aspect"
      ? "aspect"
      : "local";
  if (destinationArg) await saveCaptureDestination(destination);
  if (destination === "aspect" && !outputOverride) {
    const aspectPath = process.env.N_APT_ASPECT_PATH;
    if (!aspectPath) {
      throw new Error(
        "Aspect destination is not configured; set N_APT_ASPECT_PATH to its mounted captures folder",
      );
    }
    await assertAspectMountAvailable(aspectPath);
  }
  const receiveDefaults = resolveNaptReceiveDefaults(selected);
  const { centerFrequencyHz: center, sampleRateHz: rate } =
    resolveCliCaptureFrequencySpan(args, selected);
  const fftSize = resolveCliCaptureFftSize(args);
  const profileName = flag(args, "--quality-profile", "iq-capture-cli");
  const profile = ({ "iq-capture-cli": IQ_CAPTURE_CLI_QUALITY_PROFILE, demodulation: DEMODULATION_QUALITY_PROFILE,
    "classifier-training": CLASSIFIER_TRAINING_QUALITY_PROFILE } as const)[profileName as "iq-capture-cli" | "demodulation" | "classifier-training"];
  if (!profile) throw new Error(`Unknown --quality-profile ${profileName}; choose iq-capture-cli, demodulation, or classifier-training`);
  const requestedFrameRate = flag(args, "--frame-rate", "");
  const preflight = resolveCapturePreflightOptions({
    profile,
    requested: {
      sampleRateHz: rate,
      fftSize,
      ...(requestedFrameRate ? { frameRateHz: Number(requestedFrameRate) } : {}),
      fftWindow: flag(args, "--fft-window", selected.sdr?.settings?.fft_window ?? "Rectangular"),
      temporalResolution: "lossless",
    },
    sourceCapabilities: {
      minSampleRateHz: selected.sdr?.settings?.min_receive_sample_rate ?? undefined,
      maxSampleRateHz: selected.capabilities?.max_sample_rate ?? selected.sdr?.max_sample_rate,
      fftSizes: selected.capabilities?.fft?.sizes,
      maxFrameRateHz: selected.capabilities?.fft?.max_frame_rate,
    },
  });
  console.log(`Capture preflight options: ${JSON.stringify(preflight)}`);
  if (preflight.fit !== "ready" || !preflight.options) {
    throw new Error(`Capture quality profile ${profile.id} is not supported: ${preflight.reasons.join(" ")}`);
  }
  const options = preflight.options;
  if (deviceId !== "mock-apt") {
    await selectDevice(deviceId, receiveDefaults);
    await waitForDeviceSettings(deviceId, receiveDefaults);
  }
  const token = await authenticateCli();
  const { WebSocket } = await import("ws");
  const jobId = `cli_${randomUUID()}`;
  const request: Record<string, unknown> = {
    type: "capture",
    jobId,
    durationMode: flag(args, "--duration-mode", "timed"),
    durationS: Number(flag(args, "--duration", "1")),
    fileType: flag(args, "--file-type", ".napt"),
    encrypted: true,
    acquisitionMode: flag(args, "--acquisition-mode", "stepwise"),
    sampleRateHz: options.sampleRateHz,
    frameRate: options.frameRateHz,
    fftSize: options.fftSize,
    fftWindow: options.fftWindow,
    gain: Number(flag(args, "--gain", String(receiveDefaults.gainDb))),
    ppm: Number(flag(args, "--ppm", String(receiveDefaults.ppm))),
    tunerAGC: false,
    rtlAGC: false,
    fragments: [{ minFreq: center - rate / 2, maxFreq: center + rate / 2 }],
  };
  if (request.fileType === ".wav") request.encrypted = args.includes("--encrypted");
  const sourceId = selected.id;
  const completed = await new Promise<{
    downloadUrl?: string;
    filename?: string;
    checksum?: string;
    fileSize?: number;
  }>((resolve, reject) => {
    const socket = new WebSocket(`${backend.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Timed out waiting for I/Q capture")); }, (Number(request.durationS) + 30) * 1000);
    let acknowledged = false;
    socket.on("open", () => socket.send(JSON.stringify({ ...request, source_id: sourceId })));
    socket.on("message", (raw) => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      const status = message.type === "capture_status" ? message.status : null;
      if (status?.jobId !== jobId) return;
      if (status.status === "started") {
        const validation = validateCapturePreflightAcknowledgement(options, status);
        if (status.sourceId && status.sourceId !== sourceId) {
          clearTimeout(timeout);
          socket.send(JSON.stringify({ type: "capture_stop", jobId }));
          socket.close();
          reject(new Error(`Capture acknowledgement source ${status.sourceId} does not match ${sourceId}`));
          return;
        }
        if (!validation.valid) {
          clearTimeout(timeout);
          socket.send(JSON.stringify({ type: "capture_stop", jobId }));
          socket.close();
          reject(new Error(validation.reason ?? "Capture preflight acknowledgement failed"));
          return;
        }
        acknowledged = true;
      }
      if (status.status === "done") {
        if (!acknowledged) {
          clearTimeout(timeout);
          socket.close();
          reject(new Error("Capture completed without a preflight settings acknowledgement"));
          return;
        }
        clearTimeout(timeout); socket.close(); resolve(status);
      }
      if (status.status === "failed" || status.status === "error") {
        clearTimeout(timeout); socket.close(); reject(new Error(status.error ?? status.message ?? "I/Q capture failed"));
      }
    });
    socket.on("error", reject);
  });
  if (!completed.downloadUrl) {
    console.log(`Capture completed: ${jobId}`);
    return;
  }
  const separator = completed.downloadUrl.includes("?") ? "&" : "?";
  const downloadUrl = `${backend}${completed.downloadUrl}${separator}token=${encodeURIComponent(token)}`;
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Capture download failed: HTTP ${response.status}`);
  }
  if (!completed.filename || completed.fileSize === undefined || !completed.checksum) {
    throw new Error("Capture completion is missing artifact verification metadata");
  }
  const captureOutput = getCaptureOutputPath({
    destination,
    filename: completed.filename,
    downloadsDirectory: join(process.env.HOME ?? homedir(), "Downloads"),
    aspectPath: process.env.N_APT_ASPECT_PATH,
    outputOverride,
  });
  const artifact = new Uint8Array(await response.arrayBuffer());
  const verification = await verifyCaptureArtifact(artifact, {
    filename: completed.filename,
    fileSize: completed.fileSize,
    checksum: completed.checksum,
  });
  await writeCaptureArtifact(
    captureOutput,
    artifact,
    destination === "aspect" && !outputOverride ? "aspect" : "local",
  );
  console.log(
    `Saved verified ${verification.format.toUpperCase()} V${verification.formatVersion} capture to ${destination === "aspect" ? "Aspect" : "Local Downloads"}: ${captureOutput} (${verification.frameUpdateCount} frame updates)`,
  );
}

function flag(args: string[], name: string, fallback: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

async function resolveDeviceArgument(args: string[], sources: any[]) {
  const requested = flag(args, "--device", "auto");
  if (requested !== "auto" || !args.includes("--interactive")) return requested;

  const physical = sources.filter(
    (source) =>
      source.capability !== "mock" &&
      !String(source.kind).includes("mock") &&
      (source.status === "connected" || source.status === "streaming"),
  );
  if (physical.length <= 1) return requested;

  console.log("Available SDR devices:");
  physical.forEach((source, index) => {
    const serial = source.serial_number ? ` (serial: ${source.serial_number})` : "";
    console.log(`  ${index + 1}. ${source.name} [${source.kind}]${serial}`);
  });
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Select a device: ");
    const index = Number.parseInt(answer.trim(), 10) - 1;
    if (!Number.isInteger(index) || !physical[index]) {
      throw new Error("Invalid device selection");
    }
    return physical[index].id;
  } finally {
    rl.close();
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const helpTopic = resolveCliHelpTopic(rawArgs);
  if (helpTopic) {
    console.log(renderCliHelp(helpTopic));
    return;
  }
  if (rawArgs.length === 1 && rawArgs[0] === "--version") {
    console.log(cliVersion());
    return;
  }
  if (!new Set(["devices", "capture", "signals", "agent", "demod"]).has(rawArgs[0])) usage();
  if (rawArgs[0] === "capture" && rawArgs[1] !== "snapshot" && rawArgs[1] !== "iq") usage();
  if (rawArgs[0] === "signals" && !new Set(["inspect", "spectrum", "validate", "demod", "capture"]).has(rawArgs[1])) usage();
  if (rawArgs[0] === "agent" && !new Set(["capabilities", "tools", "markdown", "call"]).has(rawArgs[1])) usage();

  const args = validateCliArguments(rawArgs);
  if (args[0] === "demod") { await demod(args); return; }
  if (args[0] === "signals") { await signals(args); return; }
  if (args[0] === "agent") {
    const command = args[1];
    const json = args.includes("--json");
    if (command === "capabilities" || command === "tools") {
      printAgentCapabilities(json);
      return;
    }
    if (command === "markdown") {
      const route = flag(args, "--route", "/");
      await requireAppRunning("frontend");
      const result = await fetchAgentMarkdown(frontend, route);
      console.log(json ? JSON.stringify(result, null, 2) : result.body);
      return;
    }
    if (command === "call") {
      const name = args[2];
      if (!name) usage();
      const paramsText = flag(args, "--params", "{}");
      let params: unknown;
      try { params = JSON.parse(paramsText); } catch { throw new Error("--params must be valid JSON"); }
      await requireAppRunning("backend");
      const token = await authenticateCli();
      const result = await executeAgentTool(backend, token, name, params, args.includes("--allow-mutations"));
      console.log(json ? JSON.stringify(result, null, 2) : JSON.stringify(result));
      return;
    }
    usage();
  }
  if (args[0] !== "devices" && args[0] !== "capture") usage();

  const operation = args[1];
  if (args[0] === "capture" && operation !== "snapshot" && operation !== "iq") usage();
  if (args[0] === "capture" && operation === "iq" && !args.includes("--allow-mutations")) {
    throw new Error("capture iq requires --allow-mutations; RX capture changes device state");
  }

  await requireAppRunning(operation === "snapshot" ? "both" : "backend");
  const status = await fetchBackendStatus();
  const sources = status.sources.map((source) => ({
    ...source,
    active: source.id === status.activeSource,
  }));
  if (args[0] === "devices") {
    if (args.includes("--json")) {
      console.log(JSON.stringify({
        schemaVersion: 1,
        activeSource: status.activeSource,
        sources,
      }));
    } else {
      console.table(
        sources.map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.kind,
          status: source.status,
          serial: source.serial_number ?? "",
          active: source.active,
        })),
      );
    }
    return;
  }

  const selected = resolveRequestedDevice({
    requested: await resolveDeviceArgument(args, sources),
    sources,
  });
  console.log(`Selected device: ${selected.id}`);
  if (operation === "snapshot") return snapshot(args, selected);
  return iqCapture(args, selected.id, selected);
}

main().catch((error: unknown) => {
  if (error instanceof CliUsageError) {
    console.error(error.message);
    console.error("Run `npm run cli -- --help` for usage.");
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
