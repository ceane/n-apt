// Network configuration constants (single source of truth)

// Safely access env vars in both Vite (import.meta.env) and Jest (process.env)
const getEnvVar = (key: string): string | undefined => {
  // Try process.env first (for Jest/Node environments)
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key];
  }

  // Try import.meta.env (for Vite browser environments)
  // We use dynamic evaluation to prevent Jest parsing errors
  try {
    const meta = new Function("return import.meta")();
    if (meta && meta.env && meta.env[key]) {
      return meta.env[key];
    }
  } catch (_e) {
    // Ignore errors (like when import.meta is not available)
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
