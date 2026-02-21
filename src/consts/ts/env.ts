// Network configuration constants (single source of truth)

// Safely access env vars in both Vite (import.meta.env) and Jest (process.env)
const getEnvVar = (key: string): string | undefined => {
  // Try process.env first (for Jest/Node environments)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  
  // Try import.meta.env (for Vite browser environments)
  // We avoid directly using import.meta to prevent Jest parsing errors
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {
    // Ignore errors
  }
  
  return undefined;
};

export const BACKEND_HTTP_URL = getEnvVar('VITE_BACKEND_URL') ?? "http://localhost:8765";

export const WS_URL = getEnvVar('VITE_WS_URL') ?? BACKEND_HTTP_URL.replace(/^http/, "ws");
