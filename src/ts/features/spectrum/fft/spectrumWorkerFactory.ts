export function createSpectrumWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./spectrum.worker.ts", import.meta.url), { type: "module" });
  } catch { return null; }
}
