import React, { createContext } from "react";

// Fast Refresh can re-evaluate useSpectrumStore.tsx while a mounted consumer
// still belongs to the previous module instance. Keep the context object out
// of that module, and retain it in the global symbol registry so a full module
// re-evaluation cannot make the provider and consumer disagree about context
// identity.
const SPECTRUM_STORE_CONTEXT_KEY = Symbol.for("n-apt.spectrum-store-context");
type SpectrumStoreContextRegistry = typeof globalThis & {
  [SPECTRUM_STORE_CONTEXT_KEY]?: React.Context<unknown>;
};

const globalRegistry = globalThis as SpectrumStoreContextRegistry;

export const SpectrumStoreContext =
  globalRegistry[SPECTRUM_STORE_CONTEXT_KEY] ??
  (globalRegistry[SPECTRUM_STORE_CONTEXT_KEY] = createContext<unknown>(null));
