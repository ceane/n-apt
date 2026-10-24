const RESAMPLE_EDGE_COVERAGE_OFFSET = 36;
const RESAMPLE_PADDING_OFFSETS = [40, 44] as const;

/** Write the half-pixel acquisition-edge tolerance at the WGSL uniform offset. */
export function writeResampleEdgeCoverageParams(
  params: DataView,
  displayRange: { min: number; max: number },
  displayWidth: number,
): void {
  const displaySpan = displayRange.max - displayRange.min;
  const edgeCoverageHz =
    Number.isFinite(displaySpan) &&
    Number.isFinite(displayWidth) &&
    displaySpan >= 0 &&
    displayWidth > 0
      ? displaySpan / displayWidth / 2
      : 0;

  params.setFloat32(RESAMPLE_EDGE_COVERAGE_OFFSET, edgeCoverageHz, true);
  for (const offset of RESAMPLE_PADDING_OFFSETS) {
    params.setFloat32(offset, 0, true);
  }
}
