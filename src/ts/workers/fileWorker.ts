/**
 * File Processing Worker - Handles file I/O and stitching operations
 */

let currentFftSize = 8192;

// File processing functions
function parseFrequencyFromFilename(filename: string): number {
  const match = filename.match(/iq_(\d+\.?\d*)MHz/);
  return match ? parseFloat(match[1]) : 0.0;
}

function loadC64File(fileData: ArrayBuffer, _fileName: string): number[] {
  // Convert ArrayBuffer to number array
  const view = new DataView(fileData);
  return Array.from({ length: fileData.byteLength }, (_, i) =>
    view.getUint8(i),
  );
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
  channels?: {
    center_freq_hz: number;
    sample_rate_hz: number;
    offset_iq?: number;
    iq_length?: number;
    offset_spectrum?: number;
    spectrum_length?: number;
    bins_per_frame?: number;
  }[];
};

type WavLoadResult = {
  raw: number[];
  metadata: FileMetadata | null;
  nSpcFrames: Float32Array[] | null;
  channels?: {
    iq_data: number[];
    spectrum_frames: Float32Array[];
    center_freq_hz: number;
    sample_rate_hz: number;
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
  let nSpcFrames: Float32Array[] | null = null;
  
  // Storage for additional channels
  const extraIqChunks: Map<number, Uint8Array> = new Map();
  const extraSpcChunks: Map<number, Uint8Array> = new Map();

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
    } else if (chunkId.startsWith("nSP")) {
        const idx = chunkId === "nSPC" ? 0 : parseInt(chunkId.substring(3));
        if (!isNaN(idx)) {
            extraSpcChunks.set(idx, new Uint8Array(fileData, chunkDataStart, safeSize));
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
  const raw = Array.prototype.slice.call(mainIqBytes);

  // Parse spectrum frames for all channels
  const defaultFftSize = metadata?.fft_size || 2048;
  const parseSpectrum = (bytes: Uint8Array, customFftSize?: number) => {
    const fftSize = customFftSize || defaultFftSize;
    const numFloats = bytes.byteLength / 4;
    const numFrames = Math.floor(numFloats / fftSize);
    if (numFrames <= 0) return [];
    
    // Ensure alignment
    const floatBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + numFrames * fftSize * 4);
    const floatView = new Float32Array(floatBuffer);
    const frames = [];
    for (let i = 0; i < numFrames; i++) {
        frames.push(floatView.slice(i * fftSize, (i + 1) * fftSize));
    }
    return frames;
  };

  if (extraSpcChunks.has(0)) {
    const ch0Meta = metadata?.channels?.[0];
    nSpcFrames = parseSpectrum(extraSpcChunks.get(0)!, ch0Meta?.bins_per_frame);
  }

  // Construct channels array
  const channels: WavLoadResult["channels"] = [];
  if (metadata?.channels && metadata.channels.length > 0) {
    for (let i = 0; i < metadata.channels.length; i++) {
      const chMeta = metadata.channels[i];
      let iq: number[] = [];
      let spec: Float32Array[] = [];

      if (i === 0) {
        iq = raw;
        spec = nSpcFrames || [];
      } else {
        const iqBytes = extraIqChunks.get(i);
        if (iqBytes) iq = Array.prototype.slice.call(iqBytes);

        const spcBytes = extraSpcChunks.get(i);
        if (spcBytes) spec = parseSpectrum(spcBytes, chMeta.bins_per_frame);
      }

      channels.push({
        iq_data: iq,
        spectrum_frames: spec,
        center_freq_hz: chMeta.center_freq_hz,
        sample_rate_hz: chMeta.sample_rate_hz,
      });
    }
  }

  return { raw, metadata, nSpcFrames, channels };
}

function processToSpectrum(
  rawData: number[],
  frame: number = 0,
  gain: number = 0,
  fftSize: number = 8192,
): number[] {
  const spectrum = new Array(fftSize).fill(-120);
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
    let dbValue = -120;
    if (counts[i] > 0) {
      let meanEnergy = powerBins[i] / counts[i];
      meanEnergy = meanEnergy / fftSize;
      dbValue = 10 * Math.log10(meanEnergy + 1e-12) + gainOffset;
    }
    spectrum[i] = Math.max(-120, Math.min(0, dbValue));
  }
  return spectrum;
}

function stitchAdjacentChannels(channels: any[], _defaultFftSize: number) {
  if (!channels || channels.length <= 1) return channels;
  
  // Sort by center frequency
  const sorted = [...channels].sort((a, b) => (a.center_freq_hz || 0) - (b.center_freq_hz || 0));
  
  // Group adjacent/touching channels
  const grouped: any[][] = [];
  let currentGroup = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const ch = sorted[i];
    const prev = currentGroup[currentGroup.length - 1];
    
    const prevMax = (prev.center_freq_hz || 0) + (prev.sample_rate_hz || 3200000) / 2;
    const chMin = (ch.center_freq_hz || 0) - (ch.sample_rate_hz || 3200000) / 2;
    
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
    const minFreq = (first.center_freq_hz || 0) - (first.sample_rate_hz || 3200000) / 2;
    const maxFreq = (last.center_freq_hz || 0) + (last.sample_rate_hz || 3200000) / 2;
    const totalSpan = maxFreq - minFreq;
    const newCenter = minFreq + totalSpan / 2;
    
    // Ensure all channels have the same number of frames by truncating to the shortest channel.
    // This prevents asymmetric padding at the end of the waterfall, which the user saw as solid
    // blocks of "clipping" on either the left or right edge depending on which channel was shorter.
    const numFrames = Math.min(...group.map((c: any) => c.spectrum_frames?.length || Number.MAX_SAFE_INTEGER));
    if (numFrames === 0 || numFrames === Number.MAX_SAFE_INTEGER) return group[0];
    const stitchedFrames: Float32Array[] = [];
    
    for (let f = 0; f < numFrames; f++) {
      // Simply concatenate — backend already trimmed overlapping data
      const slices: Float32Array[] = [];
      for (const ch of group) {
        let frameData = ch.spectrum_frames?.[f];
        if (!frameData) {
          // Pad with noise if this channel is shorter than the others
          const binCount = ch.spectrum_frames?.[0]?.length || ch.bins_per_frame || _defaultFftSize;
          frameData = new Float32Array(binCount).fill(-100);
        }
        slices.push(frameData);
      }
      
      const totalBins = slices.reduce((sum, s) => sum + s.length, 0);
      const combinedFrame = new Float32Array(totalBins);
      let offset = 0;
      for (const s of slices) {
        combinedFrame.set(s, offset);
        offset += s.length;
      }
      stitchedFrames.push(combinedFrame);
    }
    
    return {
      iq: group[0].iq,
      spectrum_frames: stitchedFrames,
      center_freq_hz: newCenter,
      sample_rate_hz: totalSpan
    };
  });
}

function buildCombinedFrame(
  fileDataCache: Map<string, number[]>,
  freqMap: Map<string, number>,
  frame: number,
  metadataMap: Map<string, FileMetadata> = new Map(),
  fftSize: number = currentFftSize,
  nSpcCache: Map<string, Float32Array[]> = new Map(),
) {
  const allFileNames = new Set([...fileDataCache.keys(), ...nSpcCache.keys()]);
  if (allFileNames.size === 0) return null;

  let minFreq = Infinity;
  let maxFreq = -Infinity;
  const fileRanges = new Map<string, { min: number; max: number }>();

  for (const name of allFileNames) {
    const freq = freqMap.get(name) ?? 0;
    const meta = metadataMap.get(name);
    const sampleRate =
      meta?.capture_sample_rate_hz || meta?.sample_rate_hz || 3200000;
    const halfSpan = sampleRate / 1000000 / 2;

    const fMin = freq - halfSpan;
    const fMax = freq + halfSpan;
    fileRanges.set(name, { min: fMin, max: fMax });

    minFreq = Math.min(minFreq, fMin);
    maxFreq = Math.max(maxFreq, fMax);
  }

  if (minFreq === Infinity) return null;

  const combinedWaveform = new Float32Array(fftSize).fill(-120);
  const totalFreqSpan = maxFreq - minFreq || 1;

  for (const name of allFileNames) {
    const range = fileRanges.get(name);
    if (!range) continue;

    const nSpcFrames = nSpcCache.get(name);
    let spectrum;
    if (nSpcFrames && nSpcFrames.length > 0) {
      const frameIdx = Math.min(frame, nSpcFrames.length - 1);
      spectrum = nSpcFrames[frameIdx];
    } else {
      const raw = fileDataCache.get(name);
      if (!raw) continue;
      spectrum = processToSpectrum(raw, frame, 0, fftSize);
    }

    if (!spectrum) continue;

    // Check if spectrum data is already fftshifted (from NAPT backend processing)
    const meta = metadataMap.get(name);
    const isPreShifted = !!(meta as any)?.spectrum_shifted && nSpcFrames && nSpcFrames.length > 0;

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
        let rawData: number[] = [];
        if (lower.endsWith(".wav")) {
          const res = loadWavFile(fileData);
          rawData = res.raw;
          self.postMessage({ type: "result", id, data: { rawData, fileName, metadata: res.metadata } });
        } else if (lower.endsWith(".napt") && aesKey) {
          const MAX_HEADER_READ = Math.min(8192, fileData.byteLength);
          const maxHeaderBytes = new Uint8Array(fileData, 0, MAX_HEADER_READ);
          const newlineIdx = maxHeaderBytes.indexOf(10);
          if (newlineIdx <= 0) throw new Error("Invalid NAPT header");

          const jsonStr = new TextDecoder().decode(maxHeaderBytes.slice(0, newlineIdx));
          const metaObj = JSON.parse(jsonStr);
          
          const channels = metaObj.channels || [{ offset_iq: metaObj.offset_iq, offset_spectrum: metaObj.offset_spectrum }];
          const firstChannel = channels[0];

          if (firstChannel && firstChannel.offset_iq !== undefined && firstChannel.offset_spectrum !== undefined) {
            // Determine actual padding size. Backend now uses 4096, previously used 2048.
            const headerSize = metaObj.channels ? 4096 : 2048;

            const encryptedData = new Uint8Array(fileData, headerSize);
            const iv = encryptedData.slice(0, 12);
            const ciphertext = encryptedData.slice(12);
            const decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
            const payloadArray = new Uint8Array(decryptedData);
            
            const chOffsetIq = firstChannel.offset_iq;
            const chOffsetSpec = firstChannel.offset_spectrum;
            
            const iqByteLength = firstChannel.iq_length ?? (chOffsetSpec - chOffsetIq);
            rawData = Array.from(payloadArray.slice(chOffsetIq, chOffsetIq + iqByteLength));
            const metadata = metaObj.metadata || metaObj;
            self.postMessage({ type: "result", id, data: { rawData, fileName, metadata } });
          } else {
            throw new Error("Missing offset_iq or offset_spectrum in header channels");
          }
        } else {
          rawData = loadC64File(fileData, fileName);
          self.postMessage({ type: "result", id, data: { rawData, fileName } });
        }
        break;
      }

      case "stitchFiles": {
        const { files, settings, fftSize, aesKey } = data;
        if (fftSize) currentFftSize = fftSize;
        const fileDataCache = new Map();
        const nSpcCache = new Map();
        const freqMap = new Map();
        const metadataMap = new Map();

        let loadedCount = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const lower = file.fileName.toLowerCase();
            let rawData: number[] = [];
            let metadata: FileMetadata | null = null;
            let nSpcFrames: Float32Array[] | null = null;

            if (lower.endsWith(".wav")) {
              const { raw, metadata: wavMeta, nSpcFrames: wavFrames, channels } = loadWavFile(file.fileData);
              rawData = raw;
              metadata = wavMeta as FileMetadata;
              nSpcFrames = wavFrames;
              if (channels && channels.length > 0) {
                 (metadata as any).channels_data = stitchAdjacentChannels(channels, metadata?.fft_size || 8192);
              }
            } else if (lower.endsWith(".napt") && aesKey) {
              const MAX_HEADER_READ = Math.min(8192, file.fileData.byteLength);
              const maxHeaderBytes = new Uint8Array(file.fileData, 0, MAX_HEADER_READ);
              const newlineIdx = maxHeaderBytes.indexOf(10);
              if (newlineIdx <= 0) throw new Error("Invalid NAPT header");

              const jsonStr = new TextDecoder().decode(maxHeaderBytes.slice(0, newlineIdx));
              const metaObj = JSON.parse(jsonStr);
              metadata = metaObj.metadata || metaObj;

              let channelsMetadata = metadata?.channels || metaObj.channels;
              if (!channelsMetadata && metaObj.offset_iq !== undefined) {
                  channelsMetadata = [{
                      offset_iq: metaObj.offset_iq,
                      offset_spectrum: metaObj.offset_spectrum,
                      iq_length: metaObj.offset_spectrum - metaObj.offset_iq,
                      spectrum_length: undefined,
                      center_freq_hz: metadata?.center_frequency_hz || 0,
                      sample_rate_hz: metadata?.capture_sample_rate_hz || 0
                  }];
              }

              if (channelsMetadata && channelsMetadata.length > 0) {
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
                    const chOffsetSpec = ch.offset_spectrum;
                    const iqLength = ch.iq_length ?? 0;
                    const iqBytes = payloadArray.slice(chOffsetIq, chOffsetIq + iqLength);
                    const iq = Array.prototype.slice.call(iqBytes);

                    const specLength = ch.spectrum_length || (j + 1 < channelsMetadata.length ? channelsMetadata[j+1].offset_iq - ch.offset_spectrum : payloadArray.length - chOffsetSpec);
                    const specBytes = payloadArray.slice(chOffsetSpec, chOffsetSpec + specLength);
                    
                    const frames: Float32Array[] = [];
                    const globalFftSize = metadata?.fft_size || (metadata as any)?.fft?.size || 2048;
                    const chFftSize = ch.bins_per_frame || globalFftSize;
                    if (specBytes.length > 0) {
                        const numFrames = Math.floor((specBytes.length / 4) / chFftSize);
                        if (numFrames > 0) {
                            const floatBuffer = specBytes.buffer.slice(specBytes.byteOffset, specBytes.byteOffset + numFrames * chFftSize * 4);
                            const floatView = new Float32Array(floatBuffer);
                            for (let f = 0; f < numFrames; f++) {
                                frames.push(floatView.slice(f * chFftSize, (f + 1) * chFftSize));
                            }
                        }
                    }
                    parsedChannels.push({ iq, spectrum_frames: frames, center_freq_hz: ch.center_freq_hz, sample_rate_hz: ch.sample_rate_hz });
                }
                
                const actualFftSize = metadata?.fft_size || (metadata as any)?.fft?.size || 2048;
                const stitchedChannels = stitchAdjacentChannels(parsedChannels, actualFftSize);
                (metadata as any).channels_data = stitchedChannels;
                
                // Register each stitched group as a separate entry for buildCombinedFrame.
                // Previously only the first raw channel was stored, causing the waterfall to
                // show only one hop's bandwidth (~3.2MHz) mapped to the full capture range,
                // with everything beyond that hop at -120dB ("clipping at sample rate edge").
                if (stitchedChannels.length === 1 && stitchedChannels[0].spectrum_frames?.length > 0) {
                    // Single stitched group — use it directly as the file's spectrum
                    nSpcFrames = stitchedChannels[0].spectrum_frames;
                    // Update metadata to match the stitched group's actual frequency range
                    if (metadata) {
                        (metadata as any).center_frequency_hz = stitchedChannels[0].center_freq_hz;
                        (metadata as any).capture_sample_rate_hz = stitchedChannels[0].sample_rate_hz;
                        (metadata as any).sample_rate_hz = stitchedChannels[0].sample_rate_hz;
                    }
                } else if (stitchedChannels.length > 1) {
                    // Multiple stitched groups (e.g., group capture with non-adjacent regions A+B)
                    // Register first group as the base file
                    const firstGroup = stitchedChannels[0];
                    if (firstGroup.spectrum_frames?.length > 0) {
                        nSpcFrames = firstGroup.spectrum_frames;
                        if (metadata) {
                            (metadata as any).center_frequency_hz = firstGroup.center_freq_hz;
                            (metadata as any).capture_sample_rate_hz = firstGroup.sample_rate_hz;
                            (metadata as any).sample_rate_hz = firstGroup.sample_rate_hz;
                        }
                    }
                    // Register additional groups as virtual files
                    for (let g = 1; g < stitchedChannels.length; g++) {
                        const group = stitchedChannels[g];
                        if (group.spectrum_frames?.length > 0) {
                            const virtualName = `${file.fileName}__group${g}`;
                            nSpcCache.set(virtualName, group.spectrum_frames);
                            freqMap.set(virtualName, (group.center_freq_hz || 0) / 1e6);
                            const virtualMeta = { ...metadata, 
                                center_frequency_hz: group.center_freq_hz, 
                                capture_sample_rate_hz: group.sample_rate_hz,
                                sample_rate_hz: group.sample_rate_hz 
                            };
                            metadataMap.set(virtualName, virtualMeta as any);
                        }
                    }
                }
                
                // Keep first channel IQ for audio playback
                if (parsedChannels.length > 0) {
                    rawData = parsedChannels[0].iq;
                    // Fallback: if no stitched spectrum, use first raw channel
                    if (!nSpcFrames) nSpcFrames = parsedChannels[0].spectrum_frames;
                }
              }
            } else {
              rawData = loadC64File(file.fileData, file.fileName);
            }

            if ((rawData && rawData.length > 0) || (nSpcFrames && nSpcFrames.length > 0)) {
              if (rawData) fileDataCache.set(file.fileName, rawData);
              if (metadata) metadataMap.set(file.fileName, metadata);
              if (nSpcFrames) nSpcCache.set(file.fileName, nSpcFrames);
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
        const windowStep = internalFftSize * 8;
        const maxFrames = Math.max(1, Math.min(...Array.from(fileDataCache.keys()).map(name => {
            const nSpcFrames = nSpcCache.get(name);
            if (nSpcFrames) return nSpcFrames.length;
            const raw = fileDataCache.get(name);
            return raw ? Math.floor(raw.length / windowStep) : 1;
        })));

        const precomputedFrames = [];
        for (let frame = 0; frame < maxFrames; frame++) {
          const result = buildCombinedFrame(fileDataCache, freqMap, frame, metadataMap, internalFftSize, nSpcCache);
          precomputedFrames.push(result);
          if (frame % Math.max(1, Math.floor(maxFrames / 20)) === 0) {
            const progress = Math.floor((frame / maxFrames) * 100);
            self.postMessage({ type: "progress", id, data: { current: progress, total: 100, status: `Pre-computing frames... ${progress}%` } });
          }
        }

        const firstMeta = metadataMap.values().next().value;
        const initialChannels = firstMeta?.channels_data || [];

        self.postMessage({
          type: "result",
          id,
          data: {
            stitchedData: precomputedFrames[0],
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
