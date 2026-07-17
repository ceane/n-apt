import React from "react";
import styled, { keyframes, css } from "styled-components";
import FileMetadata from "./FileMetadata";
import FileSelection from "./FileSelection";
import SelectedFiles from "./SelectedFiles";

import { fileRegistry } from "../../utils/fileRegistry";
import { useDragAndDropFiles } from "@n-apt/hooks/useDragAndDropFiles";
import { useAppSelector } from "@n-apt/redux";

// Import NaptMetadata type from FileMetadata component
import type { NaptMetadata } from "./FileMetadata";

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
`;

const glowPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 ${(props) => props.theme.primary}80; }
  50% { box-shadow: 0 0 0 12px ${(props) => props.theme.primary}00; }
`;

const DropZone = styled.div<{ $isDragging: boolean; $showGlow: boolean }>`
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
  ${(props) =>
    props.$showGlow &&
    css`
      animation: ${glowPulse} 800ms ease-out;
      border-color: ${props.theme.primary};
      box-shadow: 0 0 0 4px ${props.theme.primary}40;
    `}
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

const ErrorMessage = styled.div`
  grid-column: 1 / -1;
  padding: 10px 12px;
  background-color: ${(props) => `${props.theme.error}1a`};
  border: 1px solid ${(props) => props.theme.error};
  border-radius: 6px;
  color: ${(props) => props.theme.error};
  font-size: 12px;
  font-weight: 500;
  animation: slideIn 200ms ease-out;
`;

const _slideIn = keyframes`
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
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
  const captureStatus = useAppSelector((state) => state.websocket.captureStatus);
  const durationSeconds =
    naptMetadata?.duration_s ??
    (naptMetadata?.channels?.[0]?.iq_length &&
    naptMetadata.channels[0].sample_rate_hz
      ? naptMetadata.channels[0].iq_length /
        2 /
        naptMetadata.channels[0].sample_rate_hz
      : undefined) ??
    (selectedNaptFile &&
    captureStatus?.filename === selectedNaptFile.name &&
    typeof captureStatus.duration === "number"
      ? captureStatus.duration
      : undefined);
  const processFiles = (files: File[]) => {
    if (files.length === 0) return;

    // Register files in the non-serializable registry
    const registeredFiles = files.map((file) => ({
      id: fileRegistry.register(file),
      name: file.name,
    }));

    onSelectedFilesChange(registeredFiles);
  };

  const ACCEPTED_TYPES = [".napt", ".wav", ".c64"];

  const {
    isDragging,
    dragError,
    showGlow,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    clearError,
  } = useDragAndDropFiles({
    onFilesDropped: processFiles,
    acceptedTypes: ACCEPTED_TYPES,
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
      $showGlow={showGlow}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && <DropOverlay>Drop files here</DropOverlay>}
      {dragError && (
        <ErrorMessage onClick={clearError}>{dragError}</ErrorMessage>
      )}
      <Section>
        <FileSelection
          onFileChange={handleFileChange}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
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
              durationSeconds={durationSeconds}
              status={stitchStatus}
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
