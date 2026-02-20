/**
 * File Processing Worker - Handles file I/O and stitching operations
 */

// File processing functions
function parseFrequencyFromFilename(filename: string): number {
  const match = filename.match(/iq_(\d+\.?\d*)MHz/);
  return match ? parseFloat(match[1]) : 0.0;
}

function loadC64File(fileData: ArrayBuffer, _fileName: string): number[] {
  // Convert ArrayBuffer to number array
  const view = new DataView(fileData);
  return Array.from({ length: fileData.byteLength }, (_, i) => view.getUint8(i));
}

type WavLoadResult = {
  raw: number[];
};

function loadWavFile(fileData: ArrayBuffer): WavLoadResult {
  const view = new DataView(fileData);
  const text = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(fileData, off, len));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
    throw new Error("Invalid WAV header");
  }

  let offset = 12;
  let dataStart = 0;
  let dataSize = 0;

  while (offset + 8 <= fileData.byteLength) {
    const chunkId = text(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    const available = fileData.byteLength - chunkDataStart;
    const safeSize = Math.max(0, Math.min(chunkSize, available));
    const step = chunkSize > 0 ? chunkSize : safeSize;

    if (chunkId === "data") {
      dataStart = chunkDataStart;
      dataSize = safeSize;
      break;
    }

    let nextOffset = chunkDataStart + step + (step % 2);
    if (nextOffset <= offset) nextOffset = offset + 8;
    offset = Math.min(nextOffset, fileData.byteLength);
  }

  if (dataStart === 0) throw new Error("No data chunk in WAV");
  const dataBytes = new Uint8Array(fileData, dataStart, Math.max(0, dataSize));
  const raw = new Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) raw[i] = dataBytes[i];
  return { raw };
}

function processToSpectrum(rawData: number[], frame: number = 0, gain: number = 0): number[] {
  const fftSize = 1024;
  const spectrum = new Array(fftSize).fill(-120);
  const windowSize = fftSize * 2;
  const windowStep = windowSize * 4;
  const maxChunks = 8;
  const maxStart = Math.max(0, rawData.length - windowSize);
  const startBase = maxStart > 0 ? (frame * windowStep) % maxStart : 0;
  const availableChunks = Math.max(1, Math.floor((rawData.length - startBase) / windowSize));
  const chunks = Math.min(maxChunks, availableChunks);

  const powerBins = new Array(fftSize).fill(0);
  const counts = new Array(fftSize).fill(0);
  const refMag = 512;

  for (let c = 0; c < chunks; c++) {
    const span = Math.max(1, chunks - 1);
    const start =
      chunks === 1
        ? startBase
        : Math.min(
            rawData.length - windowSize,
            startBase + Math.floor((c * (rawData.length - windowSize - startBase)) / span),
          );
    for (let i = 0; i < windowSize && start + i + 1 < rawData.length; i += 2) {
      const real = (rawData[start + i] ?? 128) - 128;
      const imag = (rawData[start + i + 1] ?? 128) - 128;
      const magnitude = Math.sqrt(real * real + imag * imag);
      const bin = Math.floor(i / 2) % fftSize;
      powerBins[bin] += magnitude * magnitude;
      counts[bin] += 1;
    }
  }

  const gainOffset = -60 + gain;
  for (let i = 0; i < fftSize; i++) {
    const rms = counts[i] > 0 ? Math.sqrt(powerBins[i] / counts[i]) : 0;
    const normalized = rms / refMag;
    const dbValue = normalized > 0 ? 20 * Math.log10(normalized) + gainOffset : -120;
    spectrum[i] = Math.max(-120, Math.min(0, dbValue));
  }
  return spectrum;
}

function buildCombinedFrame(
  fileDataCache: Map<string, number[]>,
  freqMap: Map<string, number>,
  frame: number,
) {
  const fftSize = 1024;
  const cachedEntries = Array.from(fileDataCache.entries());
  if (cachedEntries.length === 0) return null;

  let minFreq = Infinity;
  let maxFreq = -Infinity;
  for (const [name] of cachedEntries) {
    const freq = freqMap.get(name) ?? 0;
    minFreq = Math.min(minFreq, freq - 1.6);
    maxFreq = Math.max(maxFreq, freq + 1.6);
  }
  if (minFreq === Infinity) return null;

  const combinedWaveform = new Float32Array(fftSize).fill(-120);
  const totalFreqSpan = maxFreq - minFreq || 1;

  for (const [name, raw] of cachedEntries) {
    const freq = freqMap.get(name) ?? 0;
    const spectrum = processToSpectrum(raw, frame);
    const fMin = freq - 1.6;
    const startBin = Math.floor(((fMin - minFreq) / totalFreqSpan) * fftSize);
    const endBin = Math.floor(((freq + 1.6 - minFreq) / totalFreqSpan) * fftSize);

    for (let i = 0; i < spectrum.length; i++) {
      const targetBin = startBin + Math.floor((i / spectrum.length) * (endBin - startBin));
      if (targetBin >= 0 && targetBin < fftSize) {
        combinedWaveform[targetBin] = Math.max(combinedWaveform[targetBin], spectrum[i]);
      }
    }
  }

  return { waveform: combinedWaveform, range: { min: minFreq, max: maxFreq } };
}

// Worker message handling
self.onmessage = async function (e) {
  const { type, id, data } = e.data;

  try {
    switch (type) {
      case "loadFile": {
        const { fileData, fileName } = data;
        const lower = fileName.toLowerCase();
        let rawData: number[] = [];
        if (lower.endsWith(".wav")) {
          const res = loadWavFile(fileData);
          rawData = res.raw;
        } else {
          rawData = loadC64File(fileData, fileName);
        }
        self.postMessage({ type: "result", id, data: { rawData, fileName } });
        break;
      }

      case "processToSpectrum": {
        const { rawData, frame, gain } = data;
        const spectrum = processToSpectrum(rawData, frame, gain);
        self.postMessage({ type: "result", id, data: { spectrum } });
        break;
      }

      case "stitchFiles": {
        const { files, settings } = data;
        const fileDataCache = new Map();
        const freqMap = new Map();

        let loadedCount = 0;

        // Load all files
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const rawData = loadC64File(file.fileData, file.fileName);
            fileDataCache.set(file.fileName, rawData);
            const baseFrequency = parseFrequencyFromFilename(file.fileName);
            const frequency = baseFrequency * (1 + (settings.ppm || 0) * 1e-6);
            freqMap.set(file.fileName, frequency);
            loadedCount++;

            // Send progress update
            self.postMessage({
              type: "progress",
              id,
              data: {
                current: i + 1,
                total: files.length,
                status: `Loaded ${file.fileName}`,
              },
            });
          } catch (error) {
            console.warn(`Failed to load ${file.fileName}:`, error);
          }
        }

        if (loadedCount === 0) {
          throw new Error("No files could be loaded successfully");
        }

        // PERFORMANCE OPTIMIZATION: Pre-compute all frames during stitching
        self.postMessage({
          type: "progress",
          id,
          data: {
            current: 0,
            total: 100,
            status: "Pre-computing frames...",
          },
        });

        // Calculate max frames
        const fftSize = 1024;
        const windowSize = fftSize * 2;
        const windowStep = windowSize * 4;
        const cachedEntries = Array.from(fileDataCache.entries());
        const maxFrames = Math.max(
          1,
          Math.min(...cachedEntries.map(([, raw]) => Math.floor(raw.length / windowStep))),
        );

        // Pre-compute all frames
        const precomputedFrames = [];
        for (let frame = 0; frame < maxFrames; frame++) {
          const result = buildCombinedFrame(fileDataCache, freqMap, frame);
          precomputedFrames.push(result);

          // Send progress updates during pre-computation
          if (frame % Math.max(1, Math.floor(maxFrames / 20)) === 0) {
            const progress = Math.floor((frame / maxFrames) * 100);
            self.postMessage({
              type: "progress",
              id,
              data: {
                current: progress,
                total: 100,
                status: `Pre-computing frames... ${progress}%`,
              },
            });
          }
        }

        // Build initial frame
        const initialFrame = buildCombinedFrame(fileDataCache, freqMap, 0);
        if (!initialFrame) throw new Error("Failed to build combined spectrum");

        self.postMessage({
          type: "result",
          id,
          data: {
            stitchedData: initialFrame,
            loadedCount,
            fileDataCache: Array.from(fileDataCache.entries()),
            freqMap: Array.from(freqMap.entries()),
            precomputedFrames: precomputedFrames,
            maxFrames: maxFrames,
          },
        });
        break;
      }

      case "getFrame": {
        const { frameIndex, precomputedFrames } = data;
        const frame = precomputedFrames[frameIndex % precomputedFrames.length];
        self.postMessage({ type: "result", id, data: { frame } });
        break;
      }

      case "buildFrame": {
        const { frame, fileDataCache, freqMap } = data;
        const cacheMap = new Map(fileDataCache as [string, number[]][]);
        const freqMapObj = new Map(freqMap as [string, number][]);
        const result = buildCombinedFrame(cacheMap, freqMapObj, frame);
        self.postMessage({ type: "result", id, data: { frame: result } });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error: unknown) {
    self.postMessage({
      type: "error",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
