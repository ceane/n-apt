import type { CanvasPlaceholderState } from "@n-apt/components/ui/CanvasPlaceholder";

type FilePlaceholderInput = {
  sourceMode: "live" | "file";
  selectedFilesCount: number;
  stitchStatus?: string | null;
  hasRenderableFrame: boolean;
};

const isProcessingStatus = (status: string) =>
  /loading|processing|stitch/i.test(status);

export const getFilePlaceholderState = ({
  sourceMode,
  selectedFilesCount,
  stitchStatus,
  hasRenderableFrame,
}: FilePlaceholderInput): CanvasPlaceholderState | null => {
  if (sourceMode !== "file") return null;

  if (selectedFilesCount === 0) {
    return { kind: "idle", title: "Upload a file" };
  }

  // A successful processing status can arrive before the playback loop emits
  // its seed frame. Keep the processing placeholder until that frame exists.
  if (hasRenderableFrame) {
    return null;
  }

  const normalizedStatus = stitchStatus?.trim() ?? "";
  if (
    normalizedStatus.length > 0 &&
    !isProcessingStatus(normalizedStatus) &&
    !/success|processed|stitched/i.test(normalizedStatus) &&
    !/no files selected/i.test(normalizedStatus)
  ) {
    return {
      kind: "error",
      reason: "File processing error",
      title: "File processing error",
    };
  }

  return {
    kind: "loading",
    paneLabel: "file",
    title: "Processing file",
  };
};
