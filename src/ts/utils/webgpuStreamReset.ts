export type WebGpuStreamIdentity = {
  sourceId: string | null;
  status: string | null;
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
  if (
    selectedSourceId === "mock-apt" ||
    selectedSourceId === "mock-tx" ||
    (selectedSourceId !== null && selectedSourceId.startsWith("mock"))
  ) {
    return false;
  }
  return (
    sourceMode === "live" &&
    ((!!selectedSourceId &&
      !!activeSourceId &&
      selectedSourceId !== activeSourceId) ||
      !hasActiveSourceFrame)
  );
};

const normalizeSourceId = (sourceId: string | null): string | null => {
  if (
    sourceId === "mock-apt" ||
    sourceId === "mock-tx" ||
    (sourceId !== null && sourceId.startsWith("mock"))
  ) {
    return "mock-shared";
  }
  return sourceId;
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
}): string => `${normalizeSourceId(sourceId) ?? "no-source"}:${epoch}`;

const RESET_STATUSES = new Set(["loading", "stale", "disconnected"]);

/**
 * A stream reconnect must not reuse the previous source's presented GPU frame.
 * Reset statuses cover a reconnect where USB briefly disappears between
 * polling intervals. A confirmed source change must also clear the previous
 * device's GPU presentation before the newly subscribed I/Q frames arrive.
 */
export const shouldFlushWebGpuStreamCache = (
  previous: WebGpuStreamIdentity | null,
  next: WebGpuStreamIdentity,
): boolean => {
  if (previous === null) return false;
  const prevId = normalizeSourceId(previous.sourceId);
  const nextId = normalizeSourceId(next.sourceId);
  return (
    prevId !== nextId ||
    (previous.status !== next.status && RESET_STATUSES.has(next.status ?? ""))
  );
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
