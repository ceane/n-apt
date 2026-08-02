import type { CaptureFileType } from "@n-apt/consts/schemas/websocket";
import type {
  SnapshotAspectRatio,
  SnapshotVideoFormat,
} from "@n-apt/hooks/useSnapshot";

const SETTINGS_DEFAULTS_STORAGE_KEY = "n-apt-settings-defaults-v1";

export type CaptureAcquisitionMode =
  | "stepwise"
  | "interleaved"
  | "whole_sample";

export interface CaptureDefaults {
  activeCaptureAreas: string[];
  acquisitionMode: CaptureAcquisitionMode;
  captureDurationMode: "timed" | "manual";
  captureDurationS: number;
  captureFileType: CaptureFileType;
  captureEncrypted: boolean;
  capturePlayback: boolean;
  captureGeolocation: boolean;
}

export interface SnapshotDefaults {
  snapshotWhole: boolean;
  snapshotShowWaterfall: boolean;
  snapshotShowStats: boolean;
  snapshotShowGeolocation: boolean;
  snapshotUseThemeColors: boolean;
  snapshotFormat: "png" | "svg" | SnapshotVideoFormat | "animated-svg";
  snapshotAspectRatio: SnapshotAspectRatio;
  fastSnapshotShowStats: boolean;
}

export interface SettingsDefaults {
  capture: CaptureDefaults;
  snapshot: SnapshotDefaults;
}

export const DEFAULT_SETTINGS_DEFAULTS: SettingsDefaults = {
  capture: {
    activeCaptureAreas: ["Onscreen"],
    acquisitionMode: "stepwise",
    captureDurationMode: "timed",
    captureDurationS: 1,
    captureFileType: ".napt",
    captureEncrypted: true,
    capturePlayback: false,
    captureGeolocation: false,
  },
  snapshot: {
    snapshotWhole: false,
    snapshotShowWaterfall: false,
    snapshotShowStats: true,
    snapshotShowGeolocation: false,
    snapshotUseThemeColors: false,
    snapshotFormat: "png",
    snapshotAspectRatio: "default",
    fastSnapshotShowStats: false,
  },
};

export const getSettingsDefaults = (): SettingsDefaults => {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS_DEFAULTS;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_DEFAULTS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS_DEFAULTS;

    const parsed = JSON.parse(raw) as Partial<SettingsDefaults>;
    return {
      capture: { ...DEFAULT_SETTINGS_DEFAULTS.capture, ...parsed.capture },
      snapshot: { ...DEFAULT_SETTINGS_DEFAULTS.snapshot, ...parsed.snapshot },
    };
  } catch {
    return DEFAULT_SETTINGS_DEFAULTS;
  }
};

export const readSettingsDefaultsSync = (): SettingsDefaults =>
  getSettingsDefaults();

export type SettingsDefaultsPatch = {
  capture?: Partial<CaptureDefaults>;
  snapshot?: Partial<SnapshotDefaults>;
};

export const setSettingsDefaults = (
  partial: SettingsDefaultsPatch,
): void => {
  if (typeof window === "undefined") return;

  const next = {
    capture: { ...getSettingsDefaults().capture, ...partial.capture },
    snapshot: { ...getSettingsDefaults().snapshot, ...partial.snapshot },
  };

  try {
    window.localStorage.setItem(
      SETTINGS_DEFAULTS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // localStorage unavailable
  }
};

export const setCaptureDefaults = (
  partial: Partial<CaptureDefaults>,
): void => {
  setSettingsDefaults({ capture: partial });
};

export const setSnapshotDefaults = (
  partial: Partial<SnapshotDefaults>,
): void => {
  setSettingsDefaults({ snapshot: partial });
};
