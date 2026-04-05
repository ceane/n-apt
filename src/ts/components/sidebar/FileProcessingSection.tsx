import React, { useRef } from "react";
import styled from "styled-components";
import { Button } from "@n-apt/components/ui";
import { CheckCircle2, Play, Pause, Loader2 } from "lucide-react";
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

const SettingRow = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: 10px 12px;
  background-color: ${(props) => props.theme.surface};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border};
  user-select: none;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
  position: relative;
  z-index: 1;
`;

const SettingLabelContainer = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 8px;
  justify-content: start;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  opacity: 0.8;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  justify-self: end;
`;

const FileInputActions = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 8px;
  justify-content: end;
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const DownloadLink = styled.a`
  color: ${(props) => props.theme.primary};
  font-size: 11px;
`;

const LoadedLabel = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.success};
  display: flex;
  align-items: center;
  gap: 4px;
`;

const RemoveButton = styled.button`
  background: none;
  color: ${(props) => props.theme.danger};
  border: none;
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
  padding: 2px 4px;
  opacity: 0.8;
  
  &:hover {
    opacity: 1;
    filter: brightness(1.2);
  }
`;

const ClearAllLink = styled.button`
  background: none;
  border: none;
  color: ${(props) => props.theme.primary};
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  padding: 2px 4px;
  margin-top: 8px;
  
  &:hover {
    filter: brightness(1.2);
  }
`;

const ActionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  grid-column: 1 / -1;
  margin-top: 8px;
`;

const DropZone = styled.div<{ $isDragging: boolean }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  position: relative;
  border: 2px dashed ${(props) => (props.$isDragging ? props.theme.primary : "transparent")};
  border-radius: 8px;
  background-color: ${(props) => (props.$isDragging ? `${props.theme.primary}1a` : "transparent")};
  transition: all 0.2s ease;
  min-height: 40px;
  z-index: 5;
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
  background-color: ${(props) => props.theme.mode === "light" ? "rgba(255, 255, 255, 0.7)" : `${props.theme.primary}1a`};
  border-radius: 6px;
  z-index: 10;
  pointer-events: none;
  color: ${(props) => props.theme.primary};
  font-weight: 600;
  font-size: 14px;
  backdrop-filter: blur(2px);
`;

const FileCard = styled.div`
  background-color: ${(props) => props.theme.surface};
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
  margin-bottom: 12px;
  display: grid;
  gap: 12px;
  grid-column: 1 / -1;
  position: relative;
  z-index: 1;
`;

const FileInfoRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const FileItemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const FileIcon = styled.div`
  width: 24px;
  height: 24px;
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.metadataLabel};
`;

const FileTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  white-space: normal;
  word-break: break-all;
  line-height: 1.3;
  flex: 1;

  .extension {
    display: inline-block;
    white-space: nowrap;
  }
`;

const StitchStatusMessage = styled.div<{ $isError: boolean }>`
  grid-column: 1 / -1;
  margin-bottom: 8px;
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: ${(props) => (props.$isError ? props.theme.danger : props.theme.success)};
  background-color: ${(props) =>
    props.$isError ? `${props.theme.danger}0d` : `${props.theme.success}0d`};
  border: 1px solid
    ${(props) => (props.$isError ? `${props.theme.danger}33` : `${props.theme.success}33`)};
  text-align: center;
`;

const WrappedSettingValue = styled(SettingValue)`
  white-space: normal;
  word-break: break-all;
  line-height: 1.4;
  padding: 4px 0;
  text-align: left;
  justify-self: start;
  max-width: 100%;

  .extension {
    display: inline-block;
    white-space: nowrap;
  }
`;

const FileInfoActions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;

const DownloadActionLink = styled(DownloadLink)`
  text-decoration: underline;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const RemoveActionButton = styled(RemoveButton)`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ClearAllContainer = styled.div`
  display: flex;
  justify-content: flex-start;
  grid-column: 1 / -1;
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
  onStitch: () => void;
  onClear: () => void;
  onStitchPauseToggle: () => void;
  sessionToken?: string | null;
  showMetadata?: boolean;
}

const renderFileName = (name: string) => {
  const lastDotIndex = name.lastIndexOf(".");
  if (lastDotIndex === -1) return name;

  const base = name.substring(0, lastDotIndex);
  const ext = name.substring(lastDotIndex);

  return (
    <>
      {base}
      <span className="extension">{ext}</span>
    </>
  );
};

export const FileProcessingSection: React.FC<FileProcessingSectionProps> = ({
  selectedFiles,
  stitchStatus,
  isStitchPaused,
  selectedNaptFile,
  naptMetadata,
  naptMetadataError,
  onSelectedFilesChange,
  onStitch,
  onClear,
  onStitchPauseToggle,
  sessionToken,
  showMetadata = true,
}) => {

  const stitchButtonRef = useRef<HTMLButtonElement | null>(null);

  const processFiles = (files: File[]) => {
    if (files.length === 0) return;

    // Register files in the non-serializable registry
    const registeredFiles = files.map(file => ({
      id: fileRegistry.register(file),
      name: file.name
    }));

    onSelectedFilesChange(registeredFiles);

    setTimeout(() => {
      const btn = stitchButtonRef.current;
      if (btn) {
        btn.focus();
        if (window.focus) window.focus();
        btn.style.transform = "translateZ(0)";
        void btn.offsetWidth;
        btn.style.transform = "";
      }
    }, 50);
  };

  const {
    isDragging,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  } = useDragAndDropFiles({
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

  const stitchingActive =
    stitchStatus?.includes("Loading") ||
    stitchStatus?.includes("Processing") ||
    stitchStatus?.includes("computing");
  const hasProcessedData = stitchStatus?.includes("Successfully");

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
          <Section>
            <SelectedFiles
              selectedFiles={selectedFiles}
              onRemoveFile={removeFile}
              onClear={onClear}
              sessionToken={sessionToken}
            />
          </Section>

          <ActionsContainer>
            {stitchStatus && !stitchingActive && stitchStatus.startsWith("Stitching failed") && (
              <StitchStatusMessage $isError={true}>
                {stitchStatus}
              </StitchStatusMessage>
            )}

            <Button
              $variant={
                stitchingActive
                  ? "secondary"
                  : stitchStatus?.startsWith("Stitching failed")
                    ? "danger"
                    : "primary"
              }
              ref={stitchButtonRef}
              onClick={() => {
                if (stitchingActive) return;
                if (hasProcessedData) {
                  onStitchPauseToggle();
                } else {
                  onStitch();
                }
              }}
              disabled={stitchingActive}
              style={{ width: '100%', padding: '12px' }}
            >
              {stitchingActive ? (
                <><Loader2 size={16} className="animate-spin" /> Processing...</>
              ) : stitchStatus?.startsWith("Stitching failed") ? (
                "Error"
              ) : hasProcessedData ? (
                isStitchPaused ? (
                  <><Play size={16} fill="currentColor" /> Play</>
                ) : (
                  <><Pause size={16} fill="currentColor" /> Pause</>
                )
              ) : (
                <><CheckCircle2 size={16} /> Process then play</>
              )}
            </Button>
          </ActionsContainer>
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
