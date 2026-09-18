import type { SDRSettings } from "@n-apt/consts/schemas/websocket";
import type { SpectrumState } from "@n-apt/redux/slices/spectrumSlice";
import { clampFrameRateToProtocolLimit } from "@n-apt/math/signals";
import { DEVICE_CONTROL_SCOPE } from "@n-apt/app/infrastructure/streams/streamContract";

const buildCommonSettingsWireData = (
  settings: SDRSettings,
  policy: "update" | "reconnect",
): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  const isNumber = (value: unknown): value is number =>
    typeof value === "number" &&
    (policy === "reconnect" || Number.isFinite(value));

  for (const key of ["fftSize", "sampleRate"] as const) {
    const value = settings[key];
    if (isNumber(value) && value > 0) {
      data[key] = policy === "update" ? Math.floor(value) : value;
    }
  }
  if (
    typeof settings.fftWindow === "string" &&
    (policy === "update" ? settings.fftWindow.trim() : settings.fftWindow).length > 0
  ) {
    data.fftWindow = settings.fftWindow;
  }
  if (isNumber(settings.frameRate) && settings.frameRate > 0) {
    data.frameRate = clampFrameRateToProtocolLimit(settings.frameRate);
  }
  if (isNumber(settings.gain) && settings.gain >= 0) {
    data.gain = settings.gain;
  }
  if (isNumber(settings.ppm)) {
    data.ppm = policy === "update" ? Math.round(settings.ppm) : settings.ppm;
  }
  for (const key of ["tunerAGC", "rtlAGC"] as const) {
    if (typeof settings[key] === "boolean") data[key] = settings[key];
  }
  return data;
};

export const buildSettingsWireData = (
  settings: SDRSettings,
): Record<string, unknown> => {
  const data = buildCommonSettingsWireData(settings, "update");
  if (
    typeof settings.maxFrameRate === "number" &&
    Number.isFinite(settings.maxFrameRate) && settings.maxFrameRate > 0
  ) {
    data.maxFrameRate = clampFrameRateToProtocolLimit(settings.maxFrameRate);
  }
  for (const key of ["hackrfLnaGain", "hackrfVgaGain", "tunerBandwidth"] as const) {
    const value = settings[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      data[key] = key === "tunerBandwidth" ? Math.round(value) : value;
    }
  }
  if (typeof settings.hackrfAmpEnabled === "boolean") {
    data.hackrfAmpEnabled = settings.hackrfAmpEnabled;
  }
  if (typeof settings.mirrorSpectrumBelowZero === "boolean") {
    data.mirror_spectrum_below_zero = settings.mirrorSpectrumBelowZero;
  }
  return data;
};

export const buildReconnectSettingsMessage = (
  spectrum: Partial<SpectrumState>,
): Record<string, unknown> => ({
  type: "settings",
  scope: DEVICE_CONTROL_SCOPE,
  ...buildCommonSettingsWireData({
    fftSize: spectrum.fftSize,
    fftWindow: spectrum.fftWindow,
    frameRate: spectrum.fftFrameRate,
    sampleRate: spectrum.sampleRateHz,
    gain: spectrum.gain,
    ppm: spectrum.ppm,
    tunerAGC: spectrum.tunerAGC,
    rtlAGC: spectrum.rtlAGC,
  }, "reconnect"),
});
