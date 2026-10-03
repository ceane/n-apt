export function resolveCliSnapshotFrameCount(waterfall: boolean): 1 | 64 {
  return waterfall ? 64 : 1;
}
