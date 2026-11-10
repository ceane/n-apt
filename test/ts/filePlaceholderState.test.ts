import { getFilePlaceholderState } from "@n-apt/app/infrastructure/io/filePlaceholderState";

describe("getFilePlaceholderState", () => {
  it("asks for a file when file mode has no selection", () => {
    expect(
      getFilePlaceholderState({
        sourceMode: "file",
        selectedFilesCount: 0,
        stitchStatus: "",
        stitchState: "idle",
        hasRenderableFrame: false,
      }),
    ).toEqual({ kind: "idle", title: "Upload a file" });
  });

  it("shows file processing until the first frame is available", () => {
    expect(
      getFilePlaceholderState({
        sourceMode: "file",
        selectedFilesCount: 1,
        stitchStatus: "Loading 1 files...",
        stitchState: "loading",
        hasRenderableFrame: false,
      }),
    ).toEqual({ kind: "loading", paneLabel: "file", title: "Processing file" });
  });

  it("clears the placeholder once the first frame is available", () => {
    expect(
      getFilePlaceholderState({
        sourceMode: "file",
        selectedFilesCount: 1,
        stitchStatus: "Processed Successfully",
        stitchState: "ready",
        hasRenderableFrame: true,
      }),
    ).toBeNull();
  });

  it("keeps processing visible after metadata succeeds but before the seed frame", () => {
    expect(
      getFilePlaceholderState({
        sourceMode: "file",
        selectedFilesCount: 1,
        stitchStatus: "Processed Successfully",
        stitchState: "ready",
        hasRenderableFrame: false,
      }),
    ).toEqual({ kind: "loading", paneLabel: "file", title: "Processing file" });
  });

  it("shows a processing error for a failed file", () => {
    expect(
      getFilePlaceholderState({
        sourceMode: "file",
        selectedFilesCount: 1,
        stitchStatus: "invalid file header",
        stitchState: "error",
        hasRenderableFrame: false,
      }),
    ).toEqual({
      kind: "error",
      reason: "File processing error",
      title: "File processing failed",
      message: "invalid file header",
    });
  });
});
