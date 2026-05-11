import React from "react";
import styled from "styled-components";
import { Button } from "@n-apt/components/ui";
import { FolderOpen } from "lucide-react";
import { SidebarSectionTitle } from "@n-apt/components/ui/Collapsible";

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
`;

const SettingRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 6px 6px 12px;
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
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  opacity: 0.8;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileInputActions = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 8px;
  justify-content: end;
  min-width: 0;
`;

const HiddenFileInput = styled.input`
  display: none;
`;

import { useAppSelector } from "@n-apt/redux";
import { DecryptionFallback } from "../ui/DecryptionFallback";

interface FileSelectionProps {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const FileSelection: React.FC<FileSelectionProps> = ({
  onFileChange,
}) => {
  const cryptoCorrupted = useAppSelector(
    (state) => state.websocket.cryptoCorrupted,
  );

  return (
    <Section>
      <SidebarSectionTitle
        icon={<FolderOpen size={14} />}
        title="File selection"
      />

      {cryptoCorrupted && (
        <div style={{ gridColumn: "1 / -1", marginBottom: "12px" }}>
          <DecryptionFallback moduleName="File Selection" errorType="vault" />
        </div>
      )}

      <SettingRow>
        <SettingLabelContainer>
          <SettingLabel>Choose or drag files...</SettingLabel>
        </SettingLabelContainer>
        <FileInputActions>
          <HiddenFileInput
            type="file"
            accept=".napt,.wav,.c64"
            multiple
            id="fileInput"
            onChange={onFileChange}
          />
          <Button
            $variant="secondary"
            onClick={() => document.getElementById("fileInput")?.click()}
            style={{
              minWidth: "124px",
              paddingInline: "18px",
              whiteSpace: "nowrap",
              justifySelf: "end",
            }}
          >
            Browse...
          </Button>
        </FileInputActions>
      </SettingRow>
    </Section>
  );
};

export default FileSelection;
