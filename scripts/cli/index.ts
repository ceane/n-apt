#!/usr/bin/env node
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";
import {
  hasNaptReceiveDefaults,
  resolveCliCaptureFftSize,
  resolveNaptReceiveDefaults,
  resolveRequestedDevice,
} from "../../src/ts/capture/policy";

const backend = process.env.N_APT_BACKEND_URL ?? "http://localhost:8765";
const frontend = process.env.N_APT_FRONTEND_URL ?? "http://localhost:5173";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

function usage(): never {
  console.error(`Usage: npm run cli -- capture <snapshot|iq> [options]\n       npm run cli -- devices`);
  process.exit(2);
}

async function fetchSources() {
  const response = await fetch(`${backend}/status`);
  if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
  const body = (await response.json()) as { status?: { sources?: unknown[] } };
  const sources = body.status?.sources;
  if (!Array.isArray(sources)) throw new Error("Backend status did not include sources");
  return sources as any[];
}

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Starts the project's normal development orchestrator when either app is absent. */
async function ensureAppRunning() {
  if ((await isReady(`${backend}/status`)) && (await isReady(frontend))) return;

  console.log("N-APT is not running; starting the app...");
  const child = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, N_APT_CLI_STARTED: "1" },
  });
  child.unref();

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isReady(`${backend}/status`) && (await isReady(frontend))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for N-APT to start on localhost:8765 and localhost:5173");
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
  const { computeHmac } = await import("../../src/ts/crypto/webcrypto");
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

async function fetchSnapshotFrames(token: string, fftSize: number) {
  const query = new URLSearchParams({ frames: "64", fft_size: String(fftSize) });
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
  const frames = await fetchSnapshotFrames(token, fftSize);
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
  const receiveDefaults = resolveNaptReceiveDefaults(selected);
  if (deviceId !== "mock-apt") {
    await selectDevice(deviceId, receiveDefaults);
    await waitForDeviceSettings(deviceId, receiveDefaults);
  }
  const token = await authenticateCli();
  const { WebSocket } = await import("ws");
  const jobId = `cli_${randomUUID()}`;
  const rate = Number(flag(args, "--sample-rate", String(selected.sdr?.sample_rate_options?.[0] ?? selected.sdr?.max_sample_rate ?? 3200000)));
  const center = Number(flag(args, "--center-frequency", "0"));
  const fftSize = resolveCliCaptureFftSize(args);
  const request: Record<string, unknown> = {
    type: "capture",
    jobId,
    durationMode: flag(args, "--duration-mode", "timed"),
    durationS: Number(flag(args, "--duration", "1")),
    fileType: flag(args, "--file-type", ".napt"),
    encrypted: true,
    acquisitionMode: flag(args, "--acquisition-mode", "stepwise"),
    fftSize,
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
  }>((resolve, reject) => {
    const socket = new WebSocket(`${backend.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Timed out waiting for I/Q capture")); }, (Number(request.durationS) + 30) * 1000);
    socket.on("open", () => socket.send(JSON.stringify({ ...request, source_id: sourceId })));
    socket.on("message", (raw) => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      const status = message.type === "capture_status" ? message.status : null;
      if (status?.jobId === jobId && status.status === "done") {
        clearTimeout(timeout); socket.close(); resolve(status);
      }
      if (status?.jobId === jobId && status.status === "failed") {
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
  const captureOutput = flag(
    args,
    "--output",
    join(
      process.env.HOME ?? ".",
      "Downloads",
      completed.filename ?? `n-apt_capture_${Date.now()}.napt`,
    ),
  );
  await mkdir(dirname(captureOutput), { recursive: true });
  await writeFile(captureOutput, Buffer.from(await response.arrayBuffer()));
  console.log(`Saved I/Q capture: ${captureOutput}`);
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
  const args = process.argv.slice(2);
  if (args[0] !== "devices" && args[0] !== "capture") usage();

  await ensureAppRunning();
  const sources = await fetchSources();
  if (args[0] === "devices") {
    console.table(
      sources.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        status: source.status,
        serial: source.serial_number ?? "",
        active: source.id === (sources as any).active_source,
      })),
    );
    return;
  }

  const operation = args[1];
  if (operation !== "snapshot" && operation !== "iq") usage();
  const selected = resolveRequestedDevice({
    requested: await resolveDeviceArgument(args, sources),
    sources,
  });
  console.log(`Selected device: ${selected.id}`);
  if (operation === "snapshot") return snapshot(args, selected);
  return iqCapture(args, selected.id, selected);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
