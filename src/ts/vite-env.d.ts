/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_WASM_BUILD_PATH?: string;
  readonly VITE_SESSION_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
