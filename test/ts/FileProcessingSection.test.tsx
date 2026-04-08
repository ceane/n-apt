import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FileProcessingSection from "@n-apt/components/sidebar/FileProcessingSection";
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
          onStitch={jest.fn()}
          onClear={jest.fn()}
          onStitchPauseToggle={jest.fn()}
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
});
