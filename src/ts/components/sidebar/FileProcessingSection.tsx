import React from "react";
import styled from "styled-components";
import FileMetadata from "./FileMetadata";
import FileSelection from "./FileSelection";
import SelectedFiles from "./SelectedFiles";

import { fileRegistry } from "../../utils/fileRegistry";
import { useDragAndDropFiles } from "@n-apt/hooks/useDragAndDropFiles";

// Import NaptMetadata type from FileMetadata component
import type { NaptMetadata } from "./FileMetadata";

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
`;

const DropZone = styled.div<{ $isDragging: boolean }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  position: relative;
  border: 2px dashed
    ${(props) => (props.$isDragging ? props.theme.primary : "transparent")};
  border-radius: 8px;
  background-color: ${(props) =>
    props.$isDragging ? `${props.theme.primary}1a` : "transparent"};
  transition: all 0.2s ease;
  min-height: 40px;
  z-index: 5;
  box-sizing: border-box;
`;

const DropOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${(props) =>
    props.theme.mode === "light"
      ? "rgba(255, 255, 255, 0.7)"
      : `${props.theme.primary}1a`};
  border-radius: 6px;
  z-index: 10;
  pointer-events: none;
  color: ${(props) => props.theme.primary};
  font-weight: 600;
  font-size: 14px;
  backdrop-filter: blur(2px);
`;

interface FileProcessingSectionProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  stitchStatus: string;
  isStitchPaused: boolean;
  selectedNaptFile: { id: string; name: string; downloadUrl?: string } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  onSelectedFilesChange: (
    files: { id: string; name: string; downloadUrl?: string }[],
  ) => void;
  onClear: () => void;
  sessionToken?: string | null;
  showMetadata?: boolean;
  fileModeActions?: React.ReactNode;
}

export const FileProcessingSection: React.FC<FileProcessingSectionProps> = ({
  selectedFiles,
  stitchStatus,
  isStitchPaused,
  selectedNaptFile,
  naptMetadata,
  naptMetadataError,
  onSelectedFilesChange,
  onClear,
  sessionToken,
  showMetadata = true,
  fileModeActions,
}) => {
  const processFiles = (files: File[]) => {
    if (files.length === 0) return;

    // Register files in the non-serializable registry
    const registeredFiles = files.map((file) => ({
      id: fileRegistry.register(file),
      name: file.name,
    }));

    onSelectedFilesChange(registeredFiles);
  };

  const { isDragging, onDragEnter, onDragOver, onDragLeave, onDrop } =
    useDragAndDropFiles({
      onFilesDropped: processFiles,
    });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    processFiles(Array.from(e.target.files));
    // Reset value so selection of same file triggers onChange again
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    const fileToRemove = selectedFiles[index];
    if (fileToRemove) {
      fileRegistry.remove(fileToRemove.id);
    }
    onSelectedFilesChange(selectedFiles.filter((_, i) => i !== index));
  };

  return (
    <DropZone
      data-testid="file-drop-zone"
      $isDragging={isDragging}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && <DropOverlay>Drop files here</DropOverlay>}
      <Section>
        <FileSelection onFileChange={handleFileChange} />
      </Section>

      {selectedFiles.length > 0 && (
        <>
          {fileModeActions ? <Section>{fileModeActions}</Section> : null}
          <Section>
            <SelectedFiles
              selectedFiles={selectedFiles}
              onRemoveFile={removeFile}
              onClear={onClear}
              sessionToken={sessionToken}
            />
          </Section>
        </>
      )}

      {selectedFiles.length > 0 && showMetadata && (
        <FileMetadata
          selectedNaptFile={selectedNaptFile}
          naptMetadata={naptMetadata}
          naptMetadataError={naptMetadataError}
          sessionToken={sessionToken}
          showTitle={true}
        />
      )}
    </DropZone>
  );
};

export default FileProcessingSection;
