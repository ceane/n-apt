/**
 * RTL-SDR samples have their selected PPM correction applied before they are
 * sent to the spectrum view, either by the tuner or by the native ingress
 * processor. Applying it in the FFT would shift those samples twice.
 */
export function shouldApplyFrontendSpectrumPpmCorrection(
  isRtlSdr: boolean,
  useAppPpmCorrection = true,
): boolean {
  return !isRtlSdr && useAppPpmCorrection;
}
