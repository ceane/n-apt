/** Maximum FFT size supported by the browser-side processing path. */
export const MAX_FRONTEND_FFT_SIZE = 262_144;

export const getFrontendFftSize = (requestedSize: number): number =>
  Math.min(Math.max(1, Math.floor(requestedSize)), MAX_FRONTEND_FFT_SIZE);
