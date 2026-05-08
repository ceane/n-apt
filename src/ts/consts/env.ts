// Network configuration constants (single source of truth)

// Safely access env vars in both Vite (import.meta.env) and Jest (process.env)
declare const __N_APT_BROWSER_ENV__:
  | Record<string, string | undefined>
  | undefined;

const expandEnvValue = (
  value: string | undefined,
  getReferencedValue: (key: string) => string | undefined,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^\$([A-Z0-9_]+)$/);
  if (!match) {
    return value;
  }

  return getReferencedValue(match[1]) ?? undefined;
};

export const getEnvVar = (key: string): string | undefined => {
  // Try process.env first (for Jest/Node environments)
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return expandEnvValue(process.env[key], (refKey) => process.env[refKey]);
  }

  // Vite injects this global in vite.config.js for browser runtime env access.
  const injectedBrowserEnv =
    typeof __N_APT_BROWSER_ENV__ !== "undefined"
      ? __N_APT_BROWSER_ENV__
      : undefined;
  const viteEnv =
    (
      globalThis as typeof globalThis & {
        __N_APT_ENV__?: Record<string, string | undefined>;
      }
    ).__N_APT_ENV__ ?? injectedBrowserEnv;
  if (viteEnv && viteEnv[key]) {
    return expandEnvValue(viteEnv[key], (refKey) => viteEnv[refKey]);
  }

  return undefined;
};

export const APP_URL = getEnvVar("VITE_APP_URL") ?? "http://localhost:5173";
export const BACKEND_HTTP_URL =
  getEnvVar("VITE_BACKEND_URL") ?? "http://localhost:8765";
export const WS_URL =
  getEnvVar("VITE_WS_URL") ?? BACKEND_HTTP_URL.replace(/^http/, "ws");
export const SESSION_KEY =
  getEnvVar("VITE_SESSION_KEY") ??
  getEnvVar("SESSION_KEY") ??
  "n-apt-session-token";
export const WASM_BUILD_PATH =
  getEnvVar("VITE_WASM_BUILD_PATH") ??
  getEnvVar("WASM_BUILD_PATH") ??
  "packages/n_apt_canvas";
export const PBKDF2_SALT_VAL =
  getEnvVar("VITE_PBKDF2_SALT") ?? "n-apt-aes-salt-v1";
export const getGoogleMapsApiKey =
  getEnvVar("VITE_GOOGLE_MAPS_API_KEY") ?? "";
