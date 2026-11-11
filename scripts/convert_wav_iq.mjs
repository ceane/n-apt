#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage: node scripts/convert_wav_iq.mjs <input.wav> [--output file.iq] [--center-frequency-hz hz]

Converts stereo PCM I/Q WAV to a plaintext NAPT-IQ3 .iq capture. Supported
inputs are unsigned 8-bit PCM and signed 16-bit PCM, including WAVEFORMATEXTENSIBLE
with 10, 12, or 16 valid bits in each 16-bit sample. Sample bytes are copied
without quantization. Center frequency defaults to 0 (unknown).`;

function parseArgs(args) {
  let input;
  let output;
  let centerFrequencyHz = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--output" || arg === "-o") {
      output = args[++i];
      if (!output) throw new Error("--output requires a path.");
    } else if (arg === "--center-frequency-hz") {
      centerFrequencyHz = Number(args[++i]);
    }
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!input) input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!input) throw new Error("An input WAV file is required.");
  if (!Number.isFinite(centerFrequencyHz) || centerFrequencyHz < 0) {
    throw new Error("Center frequency must be a non-negative number of hertz.");
  }
  return { input, output, centerFrequencyHz };
}

function parseWav(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Input is not a RIFF/WAVE file.");
  }
  let format;
  let data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error(`Truncated WAV ${id} chunk.`);
    if (id === "fmt ") {
      if (size < 16) throw new Error("WAV format chunk is too short.");
      const tag = bytes.readUInt16LE(start);
      const channels = bytes.readUInt16LE(start + 2);
      const sampleRateHz = bytes.readUInt32LE(start + 4);
      const blockAlign = bytes.readUInt16LE(start + 12);
      const bitsPerSample = bytes.readUInt16LE(start + 14);
      let validBitsPerSample = bitsPerSample;
      let bitAlignment = "right";
      let pcmTag = tag;
      if (tag === 0xfffe) {
        if (size < 40) throw new Error("WAVEFORMATEXTENSIBLE fmt chunk is incomplete.");
        validBitsPerSample = bytes.readUInt16LE(start + 18);
        pcmTag = bytes.readUInt32LE(start + 24);
        bitAlignment = "left";
      }
      format = { pcmTag, channels, sampleRateHz, blockAlign, bitsPerSample, validBitsPerSample, bitAlignment };
    } else if (id === "data") {
      data = bytes.subarray(start, end);
    }
    offset = end + (size & 1);
  }
  if (!format || !data) throw new Error("WAV must contain fmt and data chunks.");
  if (format.pcmTag !== 1) throw new Error("Only integer PCM WAV is supported.");
  if (format.channels !== 2) throw new Error("I/Q WAV must have exactly two channels (I then Q).");
  if (!format.sampleRateHz || format.blockAlign !== format.channels * format.bitsPerSample / 8) {
    throw new Error("WAV has an invalid sample rate or block alignment.");
  }
  const isU8 = format.bitsPerSample === 8 && format.validBitsPerSample === 8;
  const isInt16 = format.bitsPerSample === 16 && [10, 12, 16].includes(format.validBitsPerSample);
  if (!isU8 && !isInt16) {
    throw new Error("Supported sample formats are unsigned PCM8 or signed PCM16 with 10, 12, or 16 valid bits.");
  }
  if (data.length % format.blockAlign !== 0) throw new Error("WAV data ends in a partial I/Q sample.");
  return { format, data };
}

function encodeNaptIq3({ data, format, centerFrequencyHz, inputPath }) {
  const sampleCount = data.length / format.blockAlign;
  const bits = format.validBitsPerSample;
  const encoding = {
    element_type: "integer",
    bits_per_element: bits,
    storage_bits_per_element: format.bitsPerSample,
    signed: format.bitsPerSample === 16,
    byte_order: "little",
    bit_alignment: format.bitAlignment,
    normalization: format.bitsPerSample === 8
      ? "(value - 128) / 128"
      : `value / ${2 ** (bits - 1)}`,
  };
  const sampleRateHz = format.sampleRateHz;
  const metadata = Buffer.from(JSON.stringify({
    format: "iq",
    format_version: 3,
    interleaving: "IQ",
    encrypted: false,
    center_frequency_hz: centerFrequencyHz,
    capture_sample_rate_hz: sampleRateHz,
    sample_rate_hz: sampleRateHz,
    duration_s: sampleCount / sampleRateHz,
    fft_size: 8192,
    frame_rate: sampleRateHz / 8192,
    sample_encoding: encoding,
    source_format: "WAV PCM",
    source_file_name: path.basename(inputPath),
    iq_sample_count: sampleCount,
    channels: [{
      center_freq_hz: centerFrequencyHz,
      sample_rate_hz: sampleRateHz,
      bins_per_frame: 8192,
      frame_rate: sampleRateHz / 8192,
      label: "I/Q",
      offset_iq: 0,
      iq_length: data.length,
    }],
  }));
  const frameUpdates = Buffer.from("[]");
  const chunkHeader = Buffer.alloc(20);
  chunkHeader.writeBigUInt64LE(0n, 0);
  chunkHeader.writeUInt32LE(0, 8);
  chunkHeader.writeBigUInt64LE(BigInt(data.length), 12);
  const payload = Buffer.concat([chunkHeader, data]);
  const header = Buffer.alloc(40);
  header.write("NAPT-IQ3", 0, "ascii");
  header.writeBigUInt64LE(BigInt(metadata.length), 8);
  header.writeBigUInt64LE(BigInt(frameUpdates.length), 16);
  header.writeBigUInt64LE(BigInt(payload.length), 24);
  header.writeUInt8(0, 32);
  return Buffer.concat([header, metadata, frameUpdates, payload]);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
  }
  const inputPath = path.resolve(options.input);
  if (path.extname(inputPath).toLowerCase() !== ".wav") throw new Error("Input filename must end in .wav.");
  const outputPath = path.resolve(options.output ?? inputPath.replace(/\.wav$/i, ".iq"));
  if (path.extname(outputPath).toLowerCase() !== ".iq") throw new Error("Output filename must end in .iq.");
  if (inputPath === outputPath) throw new Error("Input and output paths must differ.");
  if (fs.existsSync(outputPath)) throw new Error(`Output already exists: ${outputPath}`);
  const { format, data } = parseWav(fs.readFileSync(inputPath));
  const capture = encodeNaptIq3({ data, format, centerFrequencyHz: options.centerFrequencyHz, inputPath });
  fs.writeFileSync(outputPath, capture, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Wrote ${outputPath} (${format.validBitsPerSample}-bit, ${format.sampleRateHz} samples/s; source sample bytes preserved).\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
  process.exitCode = 1;
}
