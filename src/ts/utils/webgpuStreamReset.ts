export type WebGpuStreamIdentity = {
  sourceId: string | null;
  status: string | null;
  selectedSourceId?: string | null;
};

export const getInitialHandledWebGpuResetEpoch = (epoch: number): number =>
  epoch > 0 ? epoch - 1 : 0;

/** A hotplug/source-reset epoch must begin from a blank visualizer state. */
export const shouldRestoreWebGpuStreamState = (epoch: number): boolean =>
  epoch === 0;

/**
 * Binary I/Q frames do not carry their source in the wire header. The
 * middleware attaches the owning source before the frame reaches the canvas,
 * which lets a handoff reject a late frame from the socket it just replaced.
 * Untagged frames remain valid for legacy/file paths.
 */
export const shouldAcceptWebGpuStreamFrame = ({
  expectedSourceId,
  frameSourceId,
  fallbackFrameSourceId,
}: {
  expectedSourceId: string | null | undefined;
  frameSourceId: string | null | undefined;
  fallbackFrameSourceId?: string | null;
}): boolean => {
  const effectiveFrameSourceId = frameSourceId ?? fallbackFrameSourceId;
  return (
    !expectedSourceId ||
    !effectiveFrameSourceId ||
    expectedSourceId === effectiveFrameSourceId
  );
};

/**
 * Resolves when a deferred source-boundary GPU reset may be committed.
 *
 * Normal handoffs retain the painted frame until the replacement is ready.
 * Source standby is different: no replacement is expected to render beneath
 * its top bar, so retaining the previous source would misrepresent ownership.
 * A matching standby snapshot is explicitly preserved across a mode-only reset.
 */
export const shouldCommitSourcePresentationReset = (
  resetPending: boolean,
  hasReplacementFrame: boolean,
  clearWithoutReplacement = false,
  preserveCurrentPresentation = false,
): boolean =>
  resetPending &&
  !preserveCurrentPresentation &&
  (hasReplacementFrame || clearWithoutReplacement);

/**
 * Determines whether source standby must clear a painted frame immediately.
 *
 * A standby transition preserves the last frame when it belongs to the
 * selected source (for example, Stop Tx). It clears only when the painted
 * owner differs from the selection, which prevents an underlying RX source
 * from leaking into a newly selected Tx standby view.
 */
export const shouldClearStandbySourcePresentation = ({
  isStandbyTopBar,
  presentedSourceId,
  expectedSourceId,
}: {
  isStandbyTopBar: boolean;
  presentedSourceId: string | null;
  expectedSourceId: string | null;
}): boolean =>
  isStandbyTopBar &&
  expectedSourceId !== null &&
  presentedSourceId !== expectedSourceId;

export const shouldPreservePresentationDuringFrameGap = ({
  hasPresentedFrame,
  hasCurrentFrame,
  isDeviceConnected,
  hasExplicitPlaceholder,
  hasPlaceholderError,
}: {
  hasPresentedFrame: boolean;
  hasCurrentFrame: boolean;
  isDeviceConnected: boolean;
  hasExplicitPlaceholder: boolean;
  hasPlaceholderError: boolean;
}): boolean =>
  hasPresentedFrame &&
  !hasCurrentFrame &&
  isDeviceConnected &&
  !hasExplicitPlaceholder &&
  !hasPlaceholderError;

/** Clear temporal waveform history at the same source boundary as GPU state. */
export const resetWebGpuStreamTemporalHistory = (
  framePool: Float32Array[],
  activeFrames: Float32Array[],
): void => {
  framePool.length = 0;
  activeFrames.length = 0;
};

export const shouldShowSourceHandoffOverlay = ({
  sourceMode,
  selectedSourceId,
  activeSourceId,
  hasActiveSourceFrame,
}: {
  sourceMode: "live" | "file";
  selectedSourceId: string | null;
  activeSourceId: string | null;
  hasActiveSourceFrame: boolean;
}): boolean => {
  if (!selectedSourceId) return false;
  return (
    sourceMode === "live" &&
    ((activeSourceId !== null && selectedSourceId !== activeSourceId) ||
      !hasActiveSourceFrame)
  );
};

export const isMockSource = (sourceId: string | null): boolean => {
  if (!sourceId) return false;
  return (
    sourceId === "mock-apt" ||
    sourceId === "mock-tx" ||
    sourceId === "mock-rtl-sdr" ||
    sourceId === "mock-readsdr" ||
    sourceId.startsWith("mock")
  );
};

/**
 * A reset must replace the canvas subtree, not only clear its current GPU
 * texture. Browser/WebGPU implementations may retain a presented texture
 * across a reconfiguration, particularly after USB hotplug.
 */
export const getWebGpuStreamResetKey = ({
  sourceId,
  epoch,
}: {
  sourceId: string | null;
  epoch: number;
}): string => {
  // Use the actual sourceId directly instead of normalizing to prevent identical keys
  // for different mock devices that would cause stuck GPU frames
  return `${sourceId ?? "no-source"}:${epoch}`;
};

/**
 * Pause/resume and source handoff are presentation state, not canvas mount
 * boundaries. Same-source reconnects advance the epoch and still reset.
 */
export const getVisualizerLifecycleKey = ({
  epoch,
}: {
  sourceId: string | null;
  epoch: number;
  status?: string | null;
}): string => `live:${epoch}`;

const RESET_STATUSES = new Set(["loading", "stale", "disconnected"]);

/**
 * A same-source reconnect must not reuse the previous presentation. Source
 * identity changes are already lifecycle boundaries because the source id is
 * part of the canvas key; advancing the epoch for those changes would remount
 * the canvas twice.
 */
export const shouldFlushWebGpuStreamCache = (
  previous: WebGpuStreamIdentity | null,
  next: WebGpuStreamIdentity,
): boolean => {
  if (previous === null) {
    return false;
  }

  const prevSourceId = previous.sourceId ?? null;
  const nextSourceId = next.sourceId ?? null;
  if (prevSourceId !== nextSourceId) {
    return false;
  }

  const prevSelectedId = previous.selectedSourceId ?? null;
  const nextSelectedId = next.selectedSourceId ?? null;
  if (prevSelectedId !== nextSelectedId) {
    return false;
  }

  return (
    previous.status !== next.status && RESET_STATUSES.has(next.status ?? "")
  );
};

/** Whether a new selection invalidates the currently painted presentation. */
export const shouldResetVisualPresentationForSelection = (
  previousSelectedSourceId: string | null | undefined,
  nextSelectedSourceId: string | null | undefined,
): boolean =>
  (previousSelectedSourceId ?? null) !== (nextSelectedSourceId ?? null);

/**
 * Resolve the minimal presentation reset for a source lifecycle transition.
 * Source selection retains the currently painted canvas until the target's
 * first frame replaces it. Same-source reconnects still clear immediately.
 */
export const resolveWebGpuStreamTransition = (
  previous: WebGpuStreamIdentity | null,
  next: WebGpuStreamIdentity,
): { clearLiveFrame: boolean; advanceResetEpoch: boolean } => {
  if (!previous) {
    return { clearLiveFrame: false, advanceResetEpoch: false };
  }
  const reconnectBoundary = shouldFlushWebGpuStreamCache(previous, next);
  const selectedSourceChanged = shouldResetVisualPresentationForSelection(
    previous.selectedSourceId,
    next.selectedSourceId,
  );
  const activeSourceChanged = previous.sourceId !== next.sourceId;
  const activeSourceCommittedToSelection =
    activeSourceChanged &&
    next.selectedSourceId != null &&
    next.sourceId === next.selectedSourceId;
  return {
    // Source selection is an ownership boundary. Clear the old frame and GPU
    // surfaces immediately so markers/status for the target source can never
    // be drawn over another device's spectrum. The later active-source commit
    // does not reset again because the selection identity is unchanged.
    clearLiveFrame:
      selectedSourceChanged ||
      (activeSourceChanged && !activeSourceCommittedToSelection) ||
      reconnectBoundary,
    advanceResetEpoch: selectedSourceChanged || reconnectBoundary,
  };
};

export const flushWebGpuPresentation = ({
  canvas,
  device,
  format,
  clearValue = { r: 0.04, g: 0.04, b: 0.04, a: 1 },
}: {
  canvas: HTMLCanvasElement | null;
  device: GPUDevice | null;
  format: GPUTextureFormat | null;
  clearValue?: GPUColor;
}): boolean => {
  if (!canvas) return false;

  // Resetting dimensions discards the browser's current presentation texture.
  const { width, height } = canvas;
  if (width > 0 && height > 0) {
    canvas.width = width;
    canvas.height = height;
  }

  if (!device || !format) return false;

  try {
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) return false;
    context.configure({ device, format, alphaMode: "premultiplied" });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    return true;
  } catch {
    return false;
  }
};

export const flushWebGpuPresentationMultiple = ({
  canvases,
  device,
  format,
  clearValue = { r: 0.04, g: 0.04, b: 0.04, a: 1 },
}: {
  canvases: (HTMLCanvasElement | null)[];
  device: GPUDevice | null;
  format: GPUTextureFormat | null;
  clearValue?: GPUColor;
}): boolean => {
  let success = false;

  for (const canvas of canvases) {
    if (!canvas) continue;

    const { width, height } = canvas;
    if (width > 0 && height > 0) {
      canvas.width = width;
      canvas.height = height;
    }

    if (!device || !format) continue;

    try {
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) continue;
      context.configure({ device, format, alphaMode: "premultiplied" });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue,
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
      success = true;
    } catch (e) {
      console.error("Error flushing WebGPU presentation for canvas:", e);
    }
  }

  return success;
};
