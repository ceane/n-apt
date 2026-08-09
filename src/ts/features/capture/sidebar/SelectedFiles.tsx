import React from "react";
import styled from "styled-components";
import {
  FileSignal,
  FileStack,
  CheckCircle2,
  Download,
  Trash2,
} from "lucide-react";
import { SidebarSectionTitle } from "@n-apt/ui/Collapsible";
import { formatDuration, formatFileSize } from "@n-apt/math/formatters";
import { fileRegistry } from "@n-apt/app/infrastructure/io/fileRegistry";

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
`;

const FileCard = styled.div`
  background-color: rgba(255, 255, 255, 0.03);
  padding: 18px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  position: relative;
  z-index: 1;
  overflow: hidden;
  grid-column: 1 / -1;
`;

const FileInfoRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const FileItemHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 12px;
`;

const FileIcon = styled.div`
  width: 20px;
  height: 20px;
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.metadataLabel};
`;

const FileTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  white-space: normal;
  word-wrap: break-word;
  word-break: break-word;
  line-height: 1.45;
  flex: 1;
  min-width: 0;
`;

const FileStats = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 15px;
  white-space: nowrap;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 500;
`;

const FileInfoActions = styled.div`
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
`;

const LoadedLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-weight: 500;
  white-space: nowrap;
`;

const FileStatValue = styled.span`
  white-space: nowrap;
`;

const DownloadActionLink = styled.a`
  color: #44cfff;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const RemoveActionButton = styled.button`
  background: none;
  border: none;
  color: #ff6b6b;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  text-decoration: underline;
  padding: 0;
  outline: none;

  &:hover {
    opacity: 0.8;
  }
`;

const ClearAllContainer = styled.div`
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  grid-column: 1 / -1;
`;

const ClearAllLink = styled.button`
  background: none;
  border: none;
  color: #44cfff;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  outline: none;

  &:hover {
    opacity: 0.8;
  }
`;

const renderFileName = (name: string) => {
  // Return the full name - ellipsis will handle truncation in CSS
  return name;
};

interface SelectedFilesProps {
  title?: string;
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  onRemoveFile: (index: number) => void;
  onClear: () => void;
  sessionToken?: string | null;
  durationSeconds?: number;
  status?: string;
}

export const SelectedFiles: React.FC<SelectedFilesProps> = ({
  title,
  selectedFiles,
  onRemoveFile,
  onClear,
  sessionToken,
  durationSeconds,
  status = "loaded",
}) => {
  if (selectedFiles.length === 0) {
    return null;
  }

  const normalizedStatus = status.toLowerCase();
  const statusLabel = normalizedStatus.includes("error") || normalizedStatus.includes("fail")
    ? "Error"
    : normalizedStatus.includes("loading") || normalizedStatus.includes("processing")
      ? "Loading"
      : "File Loaded";

  return (
    <Section>
      <SidebarSectionTitle
        icon={<FileStack size={14} />}
        title={title ?? `Selected files (${selectedFiles.length})`}
      />
      {selectedFiles.map((file, index) => (
        <FileCard key={`${file.name}-${index}`}>
          <FileItemHeader>
            <FileIcon>
              <FileSignal size={16} strokeWidth={2} />
            </FileIcon>
            <div style={{ minWidth: 0, flex: 1 }}>
              <FileTitle>{renderFileName(file.name)}</FileTitle>
              {index === 0 && (
                <FileStats>
                  <FileStatValue>
                    {typeof fileRegistry.get(file.id)?.size === "number" &&
                      formatFileSize(fileRegistry.get(file.id)!.size!)}
                  </FileStatValue>
                  {typeof fileRegistry.get(file.id)?.size === "number" &&
                    typeof durationSeconds === "number" && <span>/</span>}
                  {typeof durationSeconds === "number" &&
                    Number.isFinite(durationSeconds) && (
                      <FileStatValue>
                        {formatDuration(durationSeconds)} length capture
                      </FileStatValue>
                    )}
                  <LoadedLabel>
                    <CheckCircle2 size={12} /> {statusLabel}
                  </LoadedLabel>
                </FileStats>
              )}
            </div>
          </FileItemHeader>
          <FileInfoRow>
            <FileInfoActions>
              {file.downloadUrl && (
                <DownloadActionLink
                  href={`${file.downloadUrl}${sessionToken ? `&token=${encodeURIComponent(sessionToken)}` : ""}`}
                  download={file.name}
                >
                  <Download size={12} /> Download
                </DownloadActionLink>
              )}
            </FileInfoActions>
            <RemoveActionButton onClick={() => onRemoveFile(index)}>
              <Trash2 size={12} /> Remove?
            </RemoveActionButton>
          </FileInfoRow>
        </FileCard>
      ))}
      {selectedFiles.length > 0 && (
        <ClearAllContainer>
          <ClearAllLink onClick={onClear}>Clear all?</ClearAllLink>
        </ClearAllContainer>
      )}
    </Section>
  );
};

export default SelectedFiles;
