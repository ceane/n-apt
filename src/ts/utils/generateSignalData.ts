import { FFT_MIN_DB, FFT_MAX_DB } from "@n-apt/consts";

/**
 * Generates synthetic spectrum data for a NOAA APT signal (AM-modulated 2400Hz subcarrier).
 * Exhibits a characteristic "comb" pattern with multiple sidebands.
 */
export const generateAPTSpectrum = (size: number): Float32Array => {
  const data = new Float32Array(size).fill(FFT_MIN_DB);
  const center = size / 2;
  const sidebandSpacing = size * 0.015;
  for (let offset = -5; offset <= 5; offset++) {
    const peakPos = center + offset * sidebandSpacing;
    const peakHeight = FFT_MAX_DB - 10 - Math.abs(offset) * 8;
    const peakWidth = size * 0.002;
    for (let i = Math.floor(peakPos - peakWidth * 3); i < Math.ceil(peakPos + peakWidth * 3); i++) {
      if (i >= 0 && i < size) {
        const dist = (i - peakPos) / peakWidth;
        const val = peakHeight * Math.exp(-0.5 * dist * dist);
        data[i] = Math.max(data[i], val);
      }
    }
  }
  return data;
};

/**
 * Generates synthetic spectrum data for a standard Broadcast FM signal.
 */
export const generateFMSpectrum = (size: number): Float32Array => {
  const data = new Float32Array(size).fill(FFT_MIN_DB);
  const center = size / 2;
  const signalWidth = size * 0.15;
  for (let i = 0; i < size; i++) {
    const dist = Math.abs(i - center);
    if (dist < signalWidth / 2) {
      data[i] = Math.max(data[i], FFT_MAX_DB - 15 + Math.random() * 5);
    }
  }
  return data;
};

/**
 * Generates synthetic I/Q data for a Broadcast FM signal as Uint8Array (offset binary).
 */
export const generateFMIQData = (size: number): Uint8Array => {
  const iq = new Uint8Array(size * 2);
  const sampleRate = 250000;
  const freq = 15000;
  for (let i = 0; i < size; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (freq * t + 2.0 * Math.sin(2 * Math.PI * 400 * t));
    // Scale float (-1.0 to 1.0) to uint8 (0 to 255)
    iq[i * 2] = Math.floor((Math.cos(phase) * 0.5 + (Math.random() - 0.5) * 0.05) * 127 + 128);
    iq[i * 2 + 1] = Math.floor((Math.sin(phase) * 0.5 + (Math.random() - 0.5) * 0.05) * 127 + 128);
  }
  return iq;
};

/**
 * Generates synthetic I/Q data for a NOAA APT signal as Uint8Array (offset binary).
 */
export const generateAPTIQData = (size: number): Uint8Array => {
  const iq = new Uint8Array(size * 2);
  const sampleRate = 250000;
  for (let i = 0; i < size; i++) {
    const t = i / sampleRate;
    const subcarrier = 1.0 + 0.8 * Math.sin(2 * Math.PI * 2400 * t);
    const phase = 5.0 * Math.sin(2 * Math.PI * 2400 * t);
    // Scale float to uint8 (0 to 255)
    iq[i * 2] = Math.floor((Math.cos(phase) * subcarrier * 0.4 + (Math.random() - 0.5) * 0.02) * 127 + 128);
    iq[i * 2 + 1] = Math.floor((Math.sin(phase) * subcarrier * 0.4 + (Math.random() - 0.5) * 0.02) * 127 + 128);
  }
  return iq;
};
