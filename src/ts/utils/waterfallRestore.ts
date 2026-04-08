export interface PendingWaterfallRestore {
  data: Uint8Array;
  width: number;
  height: number;
  writeRow: number;
}

interface ResolvePendingWaterfallRestoreOptions {
  pendingRestore: PendingWaterfallRestore | null;
  shouldUpdateWaterfallRow: boolean;
  hasRenderedRestore: boolean;
}

export function resolvePendingWaterfallRestore({
  pendingRestore,
  shouldUpdateWaterfallRow,
  hasRenderedRestore,
}: ResolvePendingWaterfallRestoreOptions): PendingWaterfallRestore | undefined {
  if (!pendingRestore) {
    return undefined;
  }

  if (shouldUpdateWaterfallRow || hasRenderedRestore) {
    return undefined;
  }

  return pendingRestore;
}
