import type { StitchState } from "@n-apt/redux/slices/waterfallSlice";
import type { CanvasPlaceholderState } from "@n-apt/ui/CanvasPlaceholder";

type FilePlaceholderInput = {
  sourceMode: "live" | "file";
  selectedFilesCount: number;
  stitchStatus?: string | null;
  stitchState: StitchState;
  hasRenderableFrame: boolean;
};

export const getFilePlaceholderState = ({
  sourceMode,
  selectedFilesCount,
  stitchStatus,
  stitchState,
  hasRenderableFrame,
}: FilePlaceholderInput): CanvasPlaceholderState | null => {
  if (sourceMode !== "file") return null;

  if (selectedFilesCount === 0) {
    return { kind: "idle", title: "Upload a file" };
  }

  const normalizedStatus = stitchStatus?.trim() ?? "";
  if (stitchState === "error") {
    if (/integrity|corrupt|modified/i.test(normalizedStatus)) {
      return {
        kind: "error",
        reason: "File integrity failed",
        title: "File appears corrupted or modified",
        message: "Its contents do not match the integrity record.",
      };
    }
    if (/fido vault/i.test(normalizedStatus)) {
      return {
        kind: "error",
        reason: "File decryption unavailable",
        title: "Unlock the FIDO vault to process this file",
        message: normalizedStatus,
      };
    }
    return {
      kind: "error",
      reason: "File processing error",
      title: "File processing failed",
      message: normalizedStatus || undefined,
    };
  }

  // A successful processing state can arrive before the playback loop emits
  // its seed frame. Keep the processing placeholder until that frame exists.
  if (hasRenderableFrame) return null;

  if (stitchState === "idle") {
    return {
      kind: "idle",
      title: "File selected",
      message: "Click Stitch/Process to visualize.",
    };
  }

  return {
    kind: "loading",
    paneLabel: "file",
    title: "Processing file",
  };
};
