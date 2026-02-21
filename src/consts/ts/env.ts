// Network configuration constants (single source of truth)
export const BACKEND_HTTP_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8765";
export const WS_URL = import.meta.env.VITE_WS_URL ?? BACKEND_HTTP_URL.replace(/^http/, "ws");
