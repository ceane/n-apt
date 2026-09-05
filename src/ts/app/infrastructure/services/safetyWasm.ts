let wasmModule: any = null;
let wasmPromise: Promise<any> | null = null;

export async function getSafetyWasm() {
  if (wasmModule) return wasmModule;
  if (!wasmPromise) {
    wasmPromise = (async () => {
      try {
        // @ts-ignore
        const module = await import("n_apt_canvas");
        if (typeof module.default === "function") {
          await module.default();
        }
        wasmModule = module;
        return wasmModule;
      } catch (e) {
        console.error("Failed to load safety WASM module:", e);
        return null;
      }
    })();
  }
  return wasmPromise;
}

const C = 299_792_458;

interface MappingPoint {
  vga: number;
  dbm: number;
}

const HACKRF_AMP_OFF_MAPPING: MappingPoint[] = [
  { vga: 0.0, dbm: -7.5 },
  { vga: 5.0, dbm: -2.5 },
  { vga: 10.0, dbm: 1.5 },
  { vga: 15.0, dbm: 4.0 },
  { vga: 20.0, dbm: 6.0 },
  { vga: 25.0, dbm: 8.0 },
  { vga: 30.0, dbm: 10.0 },
  { vga: 35.0, dbm: 11.5 },
  { vga: 40.0, dbm: 13.0 },
  { vga: 47.0, dbm: 14.5 },
];

const HACKRF_AMP_ON_MAPPING: MappingPoint[] = [
  { vga: 0.0, dbm: 1.0 },
  { vga: 10.0, dbm: 6.0 },
  { vga: 20.0, dbm: 9.0 },
  { vga: 30.0, dbm: 12.0 },
  { vga: 35.0, dbm: 13.5 },
  { vga: 40.0, dbm: 14.5 },
  { vga: 47.0, dbm: 15.0 },
];

function dbmToWatts(dbm: number): number {
  return Math.pow(10, dbm / 10) / 1000;
}

function wattsToDbm(watts: number): number {
  if (watts <= 0) return -100;
  return 10.0 * Math.log10(watts * 1000.0);
}

function interpolateVgaToDbm(vga: number, mapping: MappingPoint[]): number {
  const clampedVga = Math.min(
    mapping[mapping.length - 1].vga,
    Math.max(mapping[0].vga, vga),
  );
  for (let i = 0; i < mapping.length - 1; i++) {
    const p0 = mapping[i];
    const p1 = mapping[i + 1];
    if (clampedVga >= p0.vga && clampedVga <= p1.vga) {
      const span = p1.vga - p0.vga;
      if (Math.abs(span) < 1e-6) return p0.dbm;
      const t = (clampedVga - p0.vga) / span;
      return p0.dbm + t * (p1.dbm - p0.dbm);
    }
  }
  return mapping[mapping.length - 1].dbm;
}

function interpolateDbmToVga(dbm: number, mapping: MappingPoint[]): number {
  const clampedDbm = Math.min(
    mapping[mapping.length - 1].dbm,
    Math.max(mapping[0].dbm, dbm),
  );
  for (let i = 0; i < mapping.length - 1; i++) {
    const p0 = mapping[i];
    const p1 = mapping[i + 1];
    if (clampedDbm >= p0.dbm && clampedDbm <= p1.dbm) {
      const dbmSpan = p1.dbm - p0.dbm;
      if (Math.abs(dbmSpan) < 1e-6) return p0.vga;
      const t = (clampedDbm - p0.dbm) / dbmSpan;
      return p0.vga + t * (p1.vga - p0.vga);
    }
  }
  return mapping[mapping.length - 1].vga;
}

export function getApproxOutputPowerJS(
  vgaGain: number,
  ampEnabled: boolean,
): number {
  if (ampEnabled) {
    return interpolateVgaToDbm(vgaGain, HACKRF_AMP_ON_MAPPING);
  } else {
    return interpolateVgaToDbm(vgaGain, HACKRF_AMP_OFF_MAPPING);
  }
}

export function getMaxSafeVgaAndAmpJS(powerLimitDbm: number): {
  vga: number;
  amp: boolean;
} {
  if (powerLimitDbm >= 1.0) {
    const vga = Math.round(
      interpolateDbmToVga(powerLimitDbm, HACKRF_AMP_ON_MAPPING),
    );
    return { vga, amp: true };
  } else {
    const vga = Math.round(
      interpolateDbmToVga(powerLimitDbm, HACKRF_AMP_OFF_MAPPING),
    );
    return { vga, amp: false };
  }
}

export function calculateRadiationLobeReachJS(
  frequencyHz: number,
  powerDbm: number,
  apertureWidth: number,
  apertureHeight: number,
): number {
  const freq = Math.max(1000, Math.min(100_000_000_000, frequencyHz));
  const powerWatts = dbmToWatts(Math.max(-70, Math.min(64, powerDbm)));
  const wavelength = C / freq;
  const peakGain =
    (4.0 * Math.PI * apertureWidth * apertureHeight) /
    (wavelength * wavelength);
  const calculatedReach = Math.sqrt(
    (powerWatts * peakGain) / (4.0 * Math.PI * 2.0),
  );
  const scale = Math.pow(1.8e9 / freq, 1.2);
  return Math.min(150.0, calculatedReach * scale);
}

export function calculateRadiationLobePowerLimitJS(
  frequencyHz: number,
  maxDistanceM: number,
  apertureWidth: number,
  apertureHeight: number,
): number {
  const freq = Math.max(1000, Math.min(100_000_000_000, frequencyHz));
  const wavelength = C / freq;
  const scale = Math.pow(1.8e9 / freq, 1.2);
  const targetReach = Math.max(0.01, Math.min(150.0, maxDistanceM));
  const term = (targetReach * wavelength) / scale;
  const powerWatts = (2.0 * term * term) / (apertureWidth * apertureHeight);
  return wattsToDbm(powerWatts);
}

export function calculateRoomReachJS(
  frequencyHz: number,
  powerDbm: number,
): number {
  const freq = Math.max(1000, Math.min(100_000_000_000, frequencyHz));
  const wavelength = C / freq;
  const receiverSensitivityWatts = 4.6e-7;
  const transmitterGain = 1.64;
  const receiverGain = 1.0;
  const powerWatts = dbmToWatts(powerDbm);
  const reach =
    (wavelength / (4.0 * Math.PI)) *
    Math.sqrt(
      (powerWatts * transmitterGain * receiverGain) / receiverSensitivityWatts,
    );
  return Math.max(0.2, reach);
}

export function calculateRoomPowerLimitJS(
  frequencyHz: number,
  maxDistanceM: number,
): number {
  const freq = Math.max(1000, Math.min(100_000_000_000, frequencyHz));
  const wavelength = C / freq;
  const receiverSensitivityWatts = 4.6e-7;
  const transmitterGain = 1.64;
  const receiverGain = 1.0;
  const calcDist = Math.max(0.01, maxDistanceM);
  const requiredPowerWatts =
    Math.pow((calcDist * 4.0 * Math.PI) / wavelength, 2) *
    (receiverSensitivityWatts / (transmitterGain * receiverGain));
  return wattsToDbm(requiredPowerWatts);
}

export function getQuantizedIqPowerFloorDbmJS(
  bits: number,
  fftSize: number,
  dbmOffset = 30,
): number {
  const usableBits = Math.min(32, Math.max(2, Math.trunc(bits)));
  const sampleCount = Math.max(1, Math.trunc(fftSize));
  const signedSteps = Math.pow(2, usableBits - 1);
  return (
    10 * Math.log10(1 / (signedSteps * signedSteps * sampleCount)) + dbmOffset
  );
}

export function getRecommendedFftSizeForIqPowerDbmJS(
  requestedDbm: number,
  bits: number,
  dbmOffset = 30,
): number {
  if (!Number.isFinite(requestedDbm)) return 1;
  const usableBits = Math.min(32, Math.max(2, Math.trunc(bits)));
  const signedSteps = Math.pow(2, usableBits - 1);
  const required = Math.max(
    1,
    Math.ceil(
      Math.pow(10, (dbmOffset - requestedDbm) / 10) /
        (signedSteps * signedSteps),
    ),
  );
  let size = 1;
  while (size < required && size < 1 << 30) {
    size *= 2;
  }
  return size;
}

// WASM wrappers with JS fallback
export async function getApproxOutputPower(
  vgaGain: number,
  ampEnabled: boolean,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.get_approx_output_power === "function") {
    return wasm.get_approx_output_power(vgaGain, ampEnabled);
  }
  return getApproxOutputPowerJS(vgaGain, ampEnabled);
}

export async function getMaxSafeVgaAndAmp(
  powerLimitDbm: number,
): Promise<{ vga: number; amp: boolean }> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.get_max_safe_vga_and_amp === "function") {
    const res = wasm.get_max_safe_vga_and_amp(powerLimitDbm);
    return { vga: res.vga, amp: res.amp };
  }
  return getMaxSafeVgaAndAmpJS(powerLimitDbm);
}

export async function calculateRadiationLobeReach(
  frequencyHz: number,
  powerDbm: number,
  apertureWidth: number,
  apertureHeight: number,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.calculate_radiation_lobe_reach === "function") {
    return wasm.calculate_radiation_lobe_reach(
      frequencyHz,
      powerDbm,
      apertureWidth,
      apertureHeight,
    );
  }
  return calculateRadiationLobeReachJS(
    frequencyHz,
    powerDbm,
    apertureWidth,
    apertureHeight,
  );
}

export async function calculateRadiationLobePowerLimit(
  frequencyHz: number,
  maxDistanceM: number,
  apertureWidth: number,
  apertureHeight: number,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.calculate_radiation_lobe_power_limit === "function") {
    return wasm.calculate_radiation_lobe_power_limit(
      frequencyHz,
      maxDistanceM,
      apertureWidth,
      apertureHeight,
    );
  }
  return calculateRadiationLobePowerLimitJS(
    frequencyHz,
    maxDistanceM,
    apertureWidth,
    apertureHeight,
  );
}

export async function calculateRoomReach(
  frequencyHz: number,
  powerDbm: number,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.calculate_room_reach === "function") {
    return wasm.calculate_room_reach(frequencyHz, powerDbm);
  }
  return calculateRoomReachJS(frequencyHz, powerDbm);
}

export async function calculateRoomPowerLimit(
  frequencyHz: number,
  maxDistanceM: number,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.calculate_room_power_limit === "function") {
    return wasm.calculate_room_power_limit(frequencyHz, maxDistanceM);
  }
  return calculateRoomPowerLimitJS(frequencyHz, maxDistanceM);
}

export async function getQuantizedIqPowerFloorDbm(
  bits: number,
  fftSize: number,
  dbmOffset = 30,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (wasm && typeof wasm.get_quantized_iq_power_floor_dbm === "function") {
    return wasm.get_quantized_iq_power_floor_dbm(bits, fftSize, dbmOffset);
  }
  return getQuantizedIqPowerFloorDbmJS(bits, fftSize, dbmOffset);
}

export async function getRecommendedFftSizeForIqPowerDbm(
  requestedDbm: number,
  bits: number,
  dbmOffset = 30,
): Promise<number> {
  const wasm = await getSafetyWasm();
  if (
    wasm &&
    typeof wasm.get_recommended_fft_size_for_iq_power_dbm === "function"
  ) {
    return wasm.get_recommended_fft_size_for_iq_power_dbm(
      requestedDbm,
      bits,
      dbmOffset,
    );
  }
  return getRecommendedFftSizeForIqPowerDbmJS(requestedDbm, bits, dbmOffset);
}
