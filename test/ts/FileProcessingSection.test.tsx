import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FileProcessingSection from "@n-apt/capture/sidebar/FileProcessingSection";
import { TestWrapper } from "./testUtils";

describe("FileProcessingSection", () => {
  it("registers dropped files from dataTransfer items", () => {
    const onSelectedFilesChange = jest.fn();
    const file = new File(["abc"], "capture.wav", {
      type: "application/octet-stream",
    });

    render(
      <TestWrapper>
        <FileProcessingSection
          selectedFiles={[]}
          stitchStatus=""
          isStitchPaused={false}
          selectedNaptFile={null}
          naptMetadata={null}
          naptMetadataError={null}
          onSelectedFilesChange={onSelectedFilesChange}
          onClear={jest.fn()}
        />
      </TestWrapper>,
    );

    const dropTarget = screen.getByTestId("file-drop-zone");

    fireEvent.drop(dropTarget, {
      dataTransfer: {
        items: [
          {
            kind: "file",
            getAsFile: () => file,
          },
        ],
        files: [],
      },
    });

    expect(onSelectedFilesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "capture.wav",
      }),
    ]);
  });

  it("registers dropped files when the browser only provides dataTransfer.files", () => {
    const onSelectedFilesChange = jest.fn();
    const file = new File(["abc"], "capture.iq", {
      type: "application/octet-stream",
    });

    render(
      <TestWrapper>
        <FileProcessingSection
          selectedFiles={[]}
          stitchStatus=""
          isStitchPaused={false}
          selectedNaptFile={null}
          naptMetadata={null}
          naptMetadataError={null}
          onSelectedFilesChange={onSelectedFilesChange}
          onClear={jest.fn()}
        />
      </TestWrapper>,
    );

    fireEvent.drop(screen.getByTestId("file-drop-zone"), {
      dataTransfer: { items: [], files: [file] },
    });

    expect(onSelectedFilesChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: "capture.iq" }),
    ]);
  });

  it("shows the supported file extensions in the requested order", () => {
    render(
      <TestWrapper>
        <FileProcessingSection
          selectedFiles={[]}
          stitchStatus=""
          isStitchPaused={false}
          selectedNaptFile={null}
          naptMetadata={null}
          naptMetadataError={null}
          onSelectedFilesChange={jest.fn()}
          onClear={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("No files selected (.napt, .iq, .wav)")).toBeInTheDocument();
  });
});
