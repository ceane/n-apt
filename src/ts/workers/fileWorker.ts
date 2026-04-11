/**
 * File Processing Worker - Handles file I/O and stitching operations
 */

let currentFftSize = 8192;

// File processing functions
function parseFrequencyFromFilename(filename: string): number {
  const match = filename.match(/iq_(\d+\.?\d*)MHz/);
  return match ? parseFloat(match[1]) : 0.0;
}

function loadC64File(fileData: ArrayBuffer, _fileName: string): Uint8Array {
  return new Uint8Array(fileData);
}

type FileMetadata = {
  center_frequency_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  sample_rate_hz?: number;
  encrypted?: boolean;
  timestamp_utc?: string;
  frame_rate?: number;
  fft_size?: number;
  duration_s?: number;
  acquisition_mode?: string;
  source_device?: string;
  gain?: number;
  ppm?: number;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  fft_window?: string;
  data_format?: string;
  frequency_range?: [number, number];
  channels?: {
    center_freq_hz: number;
    sample_rate_hz: number;
    requested_min_freq_hz?: number;
    requested_max_freq_hz?: number;
    offset_iq?: number;
    iq_length?: number;
    bins_per_frame?: number;
  }[];
};

type WavLoadResult = {
  raw: Uint8Array;
  metadata: FileMetadata | null;
  channels?: {
    iq_data: Uint8Array;
    center_freq_hz: number;
    sample_rate_hz: number;
    frequency_range?: [number, number];
    frame_rate?: number;
    hardware_sample_rate_hz?: number;
    bins_per_frame?: number;
  }[];
};

function loadWavFile(fileData: ArrayBuffer): WavLoadResult {
  const view = new DataView(fileData);
  const text = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(fileData, off, len));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
    const bytes = new Uint8Array(fileData.slice(0, 16));
    console.warn(
      "Invalid WAV header. First 16 bytes:",
      bytes,
      "As text:",
      text(0, 16),
    );
    throw new Error("Invalid WAV header");
  }

  let offset = 12;
  let dataStart = 0;
  let dataSize = 0;
  let metadata: FileMetadata | null = null;

  // Storage for additional channels
  const extraIqChunks: Map<number, Uint8Array> = new Map();

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
    } else if (chunkId.startsWith("nIQ")) {
      const idx = parseInt(chunkId.substring(3));
      if (!isNaN(idx)) {
        extraIqChunks.set(idx, new Uint8Array(fileData, chunkDataStart, safeSize));
      }
    } else if (chunkId === "nAPT") {
      try {
        const metaBytes = new Uint8Array(fileData, chunkDataStart, safeSize);
        // Find null terminator if exists
        const nullIdx = metaBytes.indexOf(0);
        const jsonStr = new TextDecoder().decode(
          nullIdx !== -1 ? metaBytes.slice(0, nullIdx) : metaBytes,
        );
        metadata = JSON.parse(jsonStr);
      } catch (e) {
        console.warn("Failed to parse nAPT metadata chunk:", e);
      }
    }

    let nextOffset = chunkDataStart + step + (step % 2);
    if (nextOffset <= offset) nextOffset = offset + 8;
    offset = Math.min(nextOffset, fileData.byteLength);
  }

  if (dataStart === 0) throw new Error("No data chunk in WAV");
  
  const mainIqBytes = new Uint8Array(fileData, dataStart, Math.max(0, dataSize));
  const raw = mainIqBytes.slice(); // Owned copy (source buffer may be transferred)

  // Construct channels array
  const channels: WavLoadResult["channels"] = [];
  if (metadata?.channels && metadata.channels.length > 0) {
    for (let i = 0; i < metadata.channels.length; i++) {
      const chMeta = metadata.channels[i];
      let iq: Uint8Array = new Uint8Array(0);

      if (i === 0) {
        iq = raw;
      } else {
        const iqBytes = extraIqChunks.get(i);
        if (iqBytes) iq = iqBytes.slice(); // Owned copy
      }

      channels.push({
        iq_data: iq,
        center_freq_hz: chMeta.center_freq_hz,
        sample_rate_hz: chMeta.sample_rate_hz,
        bins_per_frame: chMeta.bins_per_frame,
      });
    }
  }

  return { raw, metadata, channels };
}

function processToSpectrum(
  rawData: Uint8Array | number[],
  frame: number = 0,
  gain: number = 0,
  fftSize: number = 8192,
): number[] {
  const spectrum = new Array(fftSize).fill(-150);
  const windowSize = fftSize * 2;
  const windowStep = windowSize * 4;
  const maxChunks = 4;
  const maxStart = Math.max(0, rawData.length - windowSize);
  const startBase = maxStart > 0 ? (frame * windowStep) % maxStart : 0;
  const availableChunks = Math.max(
    1,
    Math.floor((rawData.length - startBase) / windowSize),
  );
  const chunks = Math.min(maxChunks, availableChunks);

  const powerBins = new Array(fftSize).fill(0);
  const counts = new Array(fftSize).fill(0);

  for (let c = 0; c < chunks; c++) {
    const span = Math.max(1, chunks - 1);
    const start =
      chunks === 1
        ? startBase
        : Math.min(
            rawData.length - windowSize,
            startBase +
              Math.floor(
                (c * (rawData.length - windowSize - startBase)) / span,
              ),
          );
    for (let i = 0; i < windowSize && start + i + 1 < rawData.length; i += 2) {
      const real = ((rawData[start + i] ?? 128) - 128.0) / 128.0;
      const imag = ((rawData[start + i + 1] ?? 128) - 128.0) / 128.0;
      const energy = real * real + imag * imag;
      const bin = Math.floor(i / 2) % fftSize;
      powerBins[bin] += energy;
      counts[bin] += 1;
    }
  }

  const gainOffset = gain > 0 ? 20 * Math.log10(gain) : 0;

  for (let i = 0; i < fftSize; i++) {
    let dbValue = -150;
    if (counts[i] > 0) {
      let meanEnergy = powerBins[i] / counts[i];
      meanEnergy = meanEnergy / fftSize;
      dbValue = 10 * Math.log10(meanEnergy + 1e-15) + gainOffset;
    }
    spectrum[i] = Math.max(-150, Math.min(0, dbValue));
  }
  return spectrum;
}

/**
 * Helper: compare two frequency_range arrays for logical channel identity.
 * Returns true if both represent the same requested channel range.
 */
function sameLogicalChannel(rangeA: any, rangeB: any, labelA: any, labelB: any): boolean {
  if (labelA && labelB && labelA !== labelB) return false;
  if (!rangeA || !rangeB) return true; // If either is missing, fall back to proximity
  if (!Array.isArray(rangeA) || !Array.isArray(rangeB)) return true;
  if (rangeA.length < 2 || rangeB.length < 2) return true;
  // Allow small epsilon for floating-point rounding (0.001 MHz = 1 kHz)
  return (
    Math.abs(rangeA[0] - rangeB[0]) < 0.001 &&
    Math.abs(rangeA[1] - rangeB[1]) < 0.001
  );
}

function stitchAdjacentChannels(channels: any[], _defaultFftSize: number, _maxSampleRateHz: number = 3200000) {
  if (!channels || channels.length <= 1) return channels;

  // Preserve the original entry order from the source file/config.
  // Group adjacent/touching channels that belong to the SAME logical channel.
  // Two hops belong to the same logical channel if they share the same
  // frequency_range (requested_min/max from the backend). This prevents
  // merging hops from different channel selections (e.g. C and B).
  const grouped: any[][] = [];
  let currentGroup = [channels[0]];
  
  for (let i = 1; i < channels.length; i++) {
    const ch = channels[i];
    const prev = currentGroup[currentGroup.length - 1];
    
    // FIRST CHECK: logical channel boundary via requested frequency_range.
    // Hops from different logical channels must NEVER be merged.
    if (!sameLogicalChannel(prev.frequency_range, ch.frequency_range, prev.label, ch.label)) {
      grouped.push(currentGroup);
      currentGroup = [ch];
      continue;
    }
    
    // Use actual sample rates for adjacency (no clamping — these are hardware hops)
    const prevSampleRate = prev.sample_rate_hz || _maxSampleRateHz;
    const chSampleRate = ch.sample_rate_hz || _maxSampleRateHz;
    
    const prevMax = (prev.center_freq_hz || 0) + prevSampleRate / 2;
    const chMin = (ch.center_freq_hz || 0) - chSampleRate / 2;
    
    // Group if they touch or nearly touch (allow 1kHz epsilon for float rounding)
    if (chMin <= prevMax + 1000) {
      currentGroup.push(ch);
    } else {
      grouped.push(currentGroup);
      currentGroup = [ch];
    }
  }
  grouped.push(currentGroup);
  
  return grouped.map(group => {
    if (group.length === 1) return group[0];
    
    // Compute overall range from all channels (already trimmed by backend)
    const first = group[0];
    const last = group[group.length - 1];
    
    // Use actual sample rates (no clamping)
    const firstSampleRate = first.sample_rate_hz || _maxSampleRateHz;
    const lastSampleRate = last.sample_rate_hz || _maxSampleRateHz;
    
    const minFreq = (first.center_freq_hz || 0) - firstSampleRate / 2;
    const maxFreq = (last.center_freq_hz || 0) + lastSampleRate / 2;
    const totalSpan = maxFreq - minFreq;
    const newCenter = minFreq + totalSpan / 2;
    const requestedMins = group
      .map((c: any) => c.frequency_range?.[0])
      .filter((v: number | undefined) => Number.isFinite(v));
    const requestedMaxs = group
      .map((c: any) => c.frequency_range?.[1])
      .filter((v: number | undefined) => Number.isFinite(v));
    
    return {
      iq_data: group[0].iq_data || group[0].iq,
      center_freq_hz: newCenter,
      sample_rate_hz: totalSpan,
      bins_per_frame: group[0].bins_per_frame || _defaultFftSize,
      frequency_range:
        requestedMins.length > 0 && requestedMaxs.length > 0
          ? [Math.min(...requestedMins), Math.max(...requestedMaxs)]
          : undefined,
      frame_rate: first.frame_rate,
      hardware_sample_rate_hz: first.hardware_sample_rate_hz,
      label: first.label,
    };
  });
}

function buildCombinedFrame(
  fileDataCache: Map<string, Uint8Array | number[]>,
  freqMap: Map<string, number>,
  frame: number,
  metadataMap: Map<string, FileMetadata> = new Map(),
  fftSize: number = currentFftSize,
  _maxSampleRateHz: number = 3200000,
) {
  const allFileNames = new Set(fileDataCache.keys());
  if (allFileNames.size === 0) return null;

  let minFreq = Infinity;
  let maxFreq = -Infinity;
  const fileRanges = new Map<string, { min: number; max: number }>();

  for (const name of allFileNames) {
    const freq = freqMap.get(name) ?? 0;
    const meta = metadataMap.get(name);
    
    // Use the actual sample rate from metadata — multi-channel captures
    // legitimately have sample rates larger than the hardware rate because
    // they represent the full channel span from multiple stitched hops.
    const sampleRate = meta?.capture_sample_rate_hz || meta?.sample_rate_hz || _maxSampleRateHz;
    
    const halfSpan = sampleRate / 1000000 / 2;

    const fMin = freq - halfSpan;
    const fMax = freq + halfSpan;
    fileRanges.set(name, { min: fMin, max: fMax });

    minFreq = Math.min(minFreq, fMin);
    maxFreq = Math.max(maxFreq, fMax);
  }

  if (minFreq === Infinity) return null;

  const combinedWaveform = new Float32Array(fftSize).fill(-150);
  const totalFreqSpan = maxFreq - minFreq || 1;

  for (const name of allFileNames) {
    const range = fileRanges.get(name);
    if (!range) continue;

    const raw = fileDataCache.get(name);
    if (!raw) continue;
    const spectrum = processToSpectrum(raw, frame, 0, fftSize);

    if (!spectrum) continue;

    const isPreShifted = false;

    const startBin = Math.floor(
      ((range.min - minFreq) / totalFreqSpan) * fftSize,
    );
    const endBin = Math.floor(
      ((range.max - minFreq) / totalFreqSpan) * fftSize,
    );

    const numCanvasBins = endBin - startBin;
    const N = spectrum.length;
    const halfN = Math.floor(N / 2);
    
    if (N > numCanvasBins) {
      for (let i = 0; i < N; i++) {
        // If data is pre-shifted, use identity mapping; otherwise fftshift
        const mappedI = isPreShifted ? i : (i < halfN ? i + halfN : i - halfN);
        const targetBin =
          startBin + Math.floor((mappedI / N) * numCanvasBins);
        if (targetBin >= 0 && targetBin < fftSize) {
          combinedWaveform[targetBin] = Math.max(
            combinedWaveform[targetBin],
            spectrum[i],
          );
        }
      }
    } else {
      for (let targetBin = startBin; targetBin < endBin; targetBin++) {
        if (targetBin < 0 || targetBin >= fftSize) continue;
        const fraction = (targetBin - startBin) / numCanvasBins;
        const linearI = Math.min(N - 1, Math.floor(fraction * N));
        // If data is pre-shifted, use identity mapping; otherwise fftshift
        const sourceIndex = isPreShifted ? linearI : (linearI < halfN ? linearI + halfN : linearI - halfN);
        combinedWaveform[targetBin] = Math.max(
          combinedWaveform[targetBin],
          spectrum[sourceIndex],
        );
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
        const { fileData, fileName, aesKey } = data;
        const lower = fileName.toLowerCase();
        let rawData: Uint8Array = new Uint8Array(0);
        if (lower.endsWith(".wav")) {
          const res = loadWavFile(fileData);
          rawData = res.raw; // res.raw is already Uint8Array from loadWavFile
          
          (self as any).postMessage(
            { type: "result", id, data: { rawData, fileName, metadata: res.metadata } },
            [rawData.buffer],
          );
        } else if (lower.endsWith(".napt") && aesKey) {
          const MAX_HEADER_READ = Math.min(8192, fileData.byteLength);
          const maxHeaderBytes = new Uint8Array(fileData, 0, MAX_HEADER_READ);
          let newlineIdx = maxHeaderBytes.indexOf(10);
          
          // Robust header parsing: try newline first, then find JSON boundary
          let jsonStr: string;
          if (newlineIdx > 0) {
            jsonStr = new TextDecoder().decode(maxHeaderBytes.slice(0, newlineIdx));
          } else {
            // Fallback: find the end of the root JSON object by looking for the
            // closing brace that isn't inside a string
            const headerText = new TextDecoder().decode(maxHeaderBytes);
            let braceDepth = 0;
            let inString = false;
            let escape = false;
            let jsonEnd = -1;
            for (let ci = 0; ci < headerText.length; ci++) {
              const c = headerText[ci];
              if (escape) { escape = false; continue; }
              if (c === '\\') { escape = true; continue; }
              if (c === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (c === '{') braceDepth++;
              if (c === '}') { braceDepth--; if (braceDepth === 0) { jsonEnd = ci + 1; break; } }
            }
            if (jsonEnd <= 0) throw new Error("Invalid NAPT header: no JSON boundary found");
            jsonStr = headerText.slice(0, jsonEnd);
          }
          
          const metaObj = JSON.parse(jsonStr);
          
          // Check for channels at top-level OR inside metadata
          const channels = metaObj.channels || metaObj.metadata?.channels || [
            { 
              offset_iq: metaObj.offset_iq ?? metaObj.metadata?.offset_iq, 
              iq_length: metaObj.iq_length ?? metaObj.metadata?.iq_length
            }
          ];
          const firstChannel = channels[0];

          if (firstChannel && firstChannel.offset_iq !== undefined) {
            // Determine actual padding size. Backend now uses 4096, previously used 2048.
            // Force 4096 if metaObj.metadata.channels exists as hinted by the user's header dump
            const headerSize = (metaObj.metadata?.channels || metaObj.channels) ? 4096 : 2048;

            const encryptedData = new Uint8Array(fileData, headerSize);
            const iv = encryptedData.slice(0, 12);
            const ciphertext = encryptedData.slice(12);
            
            try {
              const decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
              const payloadArray = new Uint8Array(decryptedData);
              
              const chOffsetIq = firstChannel.offset_iq;
              const iqByteLength = firstChannel.iq_length ?? (payloadArray.length - chOffsetIq);
              
              const iqPart = payloadArray.slice(chOffsetIq, chOffsetIq + iqByteLength);
              const metadata = metaObj.metadata || metaObj;
              
              const responseData = { rawData: iqPart, fileName, metadata };
              (self as any).postMessage({ type: "result", id, data: responseData }, [iqPart.buffer]);
            } catch (decryptErr: any) {
              console.error("NAPT Load - Decryption Failed:", decryptErr);
              throw new Error(`Decryption failed: ${decryptErr.message || decryptErr}`);
            }
          } else {
            console.error("NAPT Load - Invalid channel offsets", { firstChannel });
            throw new Error("Missing offset_iq in header channels");
          }
        } else {
          rawData = loadC64File(fileData, fileName);
          self.postMessage({ type: "result", id, data: { rawData, fileName } });
        }
        break;
      }

      case "stitchFiles": {
        const { files, settings, fftSize, aesKey, sampleRateOptions } = data;
        if (fftSize) currentFftSize = fftSize;
        
        // DERIVE MAX SAMPLE RATE FROM OPTIONS OR FALLBACK TO 3.2MHz
        const maxSampleRateHz = sampleRateOptions?.maxSampleRateHz || 3200000;
        
        const fileDataCache = new Map();
        const freqMap = new Map();
        const metadataMap = new Map();

        let loadedCount = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const lower = file.fileName.toLowerCase();
            let rawData: Uint8Array = new Uint8Array(0);
            let metadata: FileMetadata | null = null;

            if (lower.endsWith(".wav")) {
              const { raw, metadata: wavMeta, channels } = loadWavFile(file.fileData);
              rawData = raw;
              metadata = wavMeta as FileMetadata;
              
              // Multi-channel WAV files legitimately have sample rates larger
              // than the hardware rate because they represent stitched channel
              // spans. Do NOT clamp per-channel or file-level sample rates.
              
              if (channels && channels.length > 0) {
                 (metadata as any).channels_data = stitchAdjacentChannels(channels, metadata?.fft_size || 8192, maxSampleRateHz);
              }
            } else if (lower.endsWith(".napt") && aesKey) {
              const MAX_HEADER_READ = Math.min(8192, file.fileData.byteLength);
              const maxHeaderBytes = new Uint8Array(file.fileData, 0, MAX_HEADER_READ);
              let naptNewlineIdx = maxHeaderBytes.indexOf(10);
              
              // Robust header parsing: try newline first, then find JSON boundary
              let naptJsonStr: string;
              if (naptNewlineIdx > 0) {
                naptJsonStr = new TextDecoder().decode(maxHeaderBytes.slice(0, naptNewlineIdx));
              } else {
                const headerText = new TextDecoder().decode(maxHeaderBytes);
                let braceDepth = 0;
                let inString = false;
                let escape = false;
                let jsonEnd = -1;
                for (let ci = 0; ci < headerText.length; ci++) {
                  const c = headerText[ci];
                  if (escape) { escape = false; continue; }
                  if (c === '\\') { escape = true; continue; }
                  if (c === '"') { inString = !inString; continue; }
                  if (inString) continue;
                  if (c === '{') braceDepth++;
                  if (c === '}') { braceDepth--; if (braceDepth === 0) { jsonEnd = ci + 1; break; } }
                }
                if (jsonEnd <= 0) throw new Error("Invalid NAPT header: no JSON boundary found");
                naptJsonStr = headerText.slice(0, jsonEnd);
              }
              
              const metaObj = JSON.parse(naptJsonStr);
              metadata = metaObj.metadata || metaObj;

              let channelsMetadata = metadata?.channels || metaObj.channels;
              if (!channelsMetadata && metaObj.offset_iq !== undefined) {
                  channelsMetadata = [{
                      offset_iq: metaObj.offset_iq,
                      iq_length: metaObj.iq_length,
                      center_freq_hz: metadata?.center_frequency_hz || 0,
                      sample_rate_hz: metadata?.capture_sample_rate_hz || 0
                  }];
              }

              if (channelsMetadata && channelsMetadata.length > 0) {
                // Multi-channel NAPT files legitimately have sample rates larger
                // than the hardware rate because they represent stitched channel
                // spans. Do NOT clamp per-channel or file-level sample rates.
                
                const headerSize = metaObj.channels || metadata?.channels ? 4096 : 2048;

                const encryptedData = new Uint8Array(file.fileData, headerSize);
                const iv = encryptedData.slice(0, 12);
                const ciphertext = encryptedData.slice(12);
                const decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
                const payloadArray = new Uint8Array(decryptedData);

                const parsedChannels: any[] = [];
                for (let j = 0; j < channelsMetadata.length; j++) {
                    const ch = channelsMetadata[j];
                    const chOffsetIq = ch.offset_iq;
                    const nextOffsetIq = j + 1 < channelsMetadata.length
                      ? channelsMetadata[j + 1].offset_iq
                      : payloadArray.length;
                    const iqLength = ch.iq_length ?? Math.max(0, nextOffsetIq - chOffsetIq);
                    const iqBytes = payloadArray.slice(chOffsetIq, chOffsetIq + iqLength);
                    parsedChannels.push({
                        iq_data: iqBytes,
                        center_freq_hz: ch.center_freq_hz,
                        sample_rate_hz: ch.sample_rate_hz,
                        label: ch.label,
                        bins_per_frame: ch.bins_per_frame,
                        frame_rate: metadata?.frame_rate,
                        hardware_sample_rate_hz: metadata?.hardware_sample_rate_hz,
                        frequency_range:
                          Number.isFinite(ch.requested_min_freq_hz) &&
                          Number.isFinite(ch.requested_max_freq_hz)
                            ? [ch.requested_min_freq_hz / 1_000_000, ch.requested_max_freq_hz / 1_000_000]
                            : undefined,
                    });
                }
                
                const actualFftSize = metadata?.fft_size || (metadata as any)?.fft?.size || 2048;
                
                // Store the individual hardware hops before they are grouped and overwritten by the stitcher
                (metadata as any).raw_hardware_blocks = parsedChannels.map(ch => ({
                    center_freq_hz: ch.center_freq_hz,
                    sample_rate_hz: ch.sample_rate_hz
                }));

                const stitchedChannelsWithRange = stitchAdjacentChannels(parsedChannels, actualFftSize, maxSampleRateHz);
                (metadata as any).channels_data = stitchedChannelsWithRange;
                
                // Keep first channel IQ for audio playback
                if (parsedChannels.length > 0) {
                    rawData = parsedChannels[0].iq_data;
                }

                const groupsToRegister = stitchedChannelsWithRange.length > 0
                  ? stitchedChannelsWithRange
                  : parsedChannels;

                groupsToRegister.forEach((group, groupIndex) => {
                  const groupIq = group.iq_data || group.iq;
                  if (!groupIq || groupIq.length === 0) return;
                  const entryName = groupIndex === 0 ? file.fileName : `${file.fileName}__group${groupIndex}`;
                  const groupRange = group.frequency_range;
                  const entryCenterHz =
                    groupRange && groupRange.length === 2
                      ? ((groupRange[0] + groupRange[1]) / 2) * 1_000_000
                      : group.center_freq_hz;
                  const entrySpanHz =
                    groupRange && groupRange.length === 2
                      ? (groupRange[1] - groupRange[0]) * 1_000_000
                      : group.sample_rate_hz;

                  fileDataCache.set(entryName, groupIq);
                  freqMap.set(entryName, entryCenterHz / 1e6);
                  metadataMap.set(entryName, {
                    ...metadata,
                    center_frequency_hz: entryCenterHz,
                    capture_sample_rate_hz: entrySpanHz,
                    sample_rate_hz: entrySpanHz,
                    frequency_range: groupRange ?? metadata?.frequency_range,
                  } as any);
                });
              }
            } else {
              rawData = loadC64File(file.fileData, file.fileName);
            }

            if (rawData && rawData.length > 0) {
              if (!fileDataCache.has(file.fileName)) {
                fileDataCache.set(file.fileName, rawData);
              }
              if (metadata && !metadataMap.has(file.fileName)) {
                metadataMap.set(file.fileName, metadata);
              }
              loadedCount++;
            }

            const baseFrequency = metadata?.center_frequency_hz ? metadata.center_frequency_hz / 1000000 : parseFrequencyFromFilename(file.fileName);
            const frequency = baseFrequency * (1 + (settings.ppm || 0) * 1e-6);
            freqMap.set(file.fileName, frequency);

            self.postMessage({ type: "progress", id, data: { current: i + 1, total: files.length, status: `Loaded ${file.fileName}` } });
          } catch (error) {
            console.warn(`Failed to load ${file.fileName}:`, error);
          }
        }

        if (loadedCount === 0) throw new Error("No files could be loaded successfully");

        const internalFftSize = fftSize || currentFftSize;
        const chunkSize = internalFftSize * 2; // IQ pair per bin
        const maxFrames = Math.max(1, Math.min(...Array.from(fileDataCache.keys()).map(name => {
            const raw = fileDataCache.get(name);
            return raw ? Math.floor(raw.length / chunkSize) : 1;
        })));

        // Only compute the first frame for the seed display.
        // The playback animation emits raw IQ chunks per frame —
        // FFTCanvas / GPU shader handles FFT, windowing, and dB conversion.
        const firstFrame = buildCombinedFrame(fileDataCache, freqMap, 0, metadataMap, internalFftSize, maxSampleRateHz);
        const precomputedFrames = firstFrame ? [firstFrame] : [];

        const firstMeta = metadataMap.values().next().value;
        const initialChannels = firstMeta?.channels_data || [];

        self.postMessage({
          type: "result",
          id,
          data: {
            stitchedData: firstFrame,
            fileDataCache: Array.from(fileDataCache.entries()),
            freqMap: Array.from(freqMap.entries()),
            metadataMap: Array.from(metadataMap.entries()),
            precomputedFrames,
            maxFrames,
            loadedCount,
            channels: initialChannels,
          },
        });
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
