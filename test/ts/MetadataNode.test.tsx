import { getMetadataPlaceholderCopy } from "@n-apt/demodulation/react-flow/nodes/MetadataNode";

describe("getMetadataPlaceholderCopy", () => {
  it("shows no file selected when there is no file", () => {
    expect(
      getMetadataPlaceholderCopy({
        sourceMode: "file",
        selectedFilesCount: 0,
        metadataLoaded: false,
        metadataError: null,
      }),
    ).toBe("No file currently selected");
  });

  it("shows processing while metadata is being loaded", () => {
    expect(
      getMetadataPlaceholderCopy({
        sourceMode: "file",
        selectedFilesCount: 1,
        metadataLoaded: false,
        metadataError: null,
      }),
    ).toBe("Processing file");
  });

  it("shows a processing error for corrupt metadata", () => {
    expect(
      getMetadataPlaceholderCopy({
        sourceMode: "file",
        selectedFilesCount: 1,
        metadataLoaded: false,
        metadataError: "Invalid NAPT header",
      }),
    ).toBe("File processing error");
  });

  it("clears the placeholder after metadata loads", () => {
    expect(
      getMetadataPlaceholderCopy({
        sourceMode: "file",
        selectedFilesCount: 1,
        metadataLoaded: true,
        metadataError: null,
      }),
    ).toBeNull();
  });
});
