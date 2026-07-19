import { getFilePlaceholderState } from "@n-apt/utils/filePlaceholderState";

describe("getFilePlaceholderState", () => {
  it("asks for a file when file mode has no selection", () => {
    expect(
      getFilePlaceholderState({
        sourceMode: "file",
        selectedFilesCount: 0,
        stitchStatus: "",
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
        hasRenderableFrame: false,
      }),
    ).toEqual({
      kind: "error",
      reason: "File processing error",
      title: "File processing error",
    });
  });
});
