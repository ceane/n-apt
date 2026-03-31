import React from "react";
import styled from "styled-components";
import { FileSignal, FileStack, CheckCircle2, Download, Trash2 } from "lucide-react";
import { SidebarSectionTitle } from "@n-apt/components/ui/Collapsible";

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
`;

const FileCard = styled.div`
  background-color: ${(props) => props.theme.surface};
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
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
  word-wrap: break-word;
  word-break: break-word;
  line-height: 1.3;
  flex: 1;
  min-width: 0;
`;

const FileInfoActions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;

const LoadedLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: ${(props) => props.theme.success};
  font-weight: 500;
`;

const DownloadActionLink = styled.a`
  color: ${(props) => props.theme.primary};
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
  color: ${(props) => props.theme.danger};
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  text-decoration: underline;
  
  &:hover {
    opacity: 0.8;
  }
`;

const ClearAllContainer = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  grid-column: 1 / -1;
`;

const ClearAllLink = styled.button`
  background: none;
  border: none;
  color: ${(props) => props.theme.primary};
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  
  &:hover {
    opacity: 0.8;
  }
`;

const renderFileName = (name: string) => {
  // Return the full name - ellipsis will handle truncation in CSS
  return name;
};

interface SelectedFilesProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  onRemoveFile: (index: number) => void;
  onClear: () => void;
  sessionToken?: string | null;
}

export const SelectedFiles: React.FC<SelectedFilesProps> = ({
  selectedFiles,
  onRemoveFile,
  onClear,
  sessionToken,
}) => {
  if (selectedFiles.length === 0) {
    return null;
  }

  return (
    <Section>
      <SidebarSectionTitle icon={<FileStack size={14} />} title={`Selected files (${selectedFiles.length})`} />
      {selectedFiles.map((file, index) => (
        <FileCard key={`${file.name}-${index}`}>
          <FileItemHeader>
            <FileIcon>
              <FileSignal size={18} strokeWidth={2} />
            </FileIcon>
            <FileTitle>
              {renderFileName(file.name)}
            </FileTitle>
          </FileItemHeader>
          <FileInfoRow>
            <FileInfoActions>
              <LoadedLabel>
                <CheckCircle2 size={12} /> Loaded
              </LoadedLabel>
              {file.downloadUrl && (
                <DownloadActionLink
                  href={`${file.downloadUrl}${sessionToken ? `&token=${encodeURIComponent(sessionToken)}` : ''}`}
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
          <ClearAllLink onClick={onClear}>
            Clear all?
          </ClearAllLink>
        </ClearAllContainer>
      )}
    </Section>
  );
};

export default SelectedFiles;
