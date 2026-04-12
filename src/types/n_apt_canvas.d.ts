declare module 'n_apt_canvas' {
  // The WASM module exposes a default export which is an async initializer
  // that returns a Promise<void> when awaited.
  const initWasm: () => Promise<void>;
  export default initWasm;
}
