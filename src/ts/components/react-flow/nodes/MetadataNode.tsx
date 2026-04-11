import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { FileBox } from "lucide-react";
import FileMetadata from "@n-apt/components/sidebar/FileMetadata";
import type { NaptMetadata } from "@n-apt/components/sidebar/FileMetadata";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import { useAppSelector } from "@n-apt/redux";

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: ${({ theme }) => theme.spacing.lg};
  min-width: 320px;
  max-width: 400px;
`;

const NodeTitle = styled.div`
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NodeSubtitle = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

interface MetadataNodeProps {
  data: {
    metadataNode: boolean;
    label: string;
  };
}

export const MetadataNode: React.FC<MetadataNodeProps> = ({ data }) => {
  const { sessionToken, aesKey } = useAuthentication();
  const selectedFiles = useAppSelector((state) => state.waterfall.selectedFiles);
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);

  const selectedPrimaryFile = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length === 0) return null;
    const file = selectedFiles[0];
    const lowerName = file.name.toLowerCase();
    return lowerName.endsWith(".napt") || lowerName.endsWith(".wav") ? file : null;
  }, [selectedFiles, sourceMode]);

  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!selectedPrimaryFile || sourceMode !== "file") {
      setNaptMetadata(null);
      setNaptMetadataError(null);
      return;
    }

    const isNapt = selectedPrimaryFile.name.toLowerCase().endsWith(".napt");
    const isWav = selectedPrimaryFile.name.toLowerCase().endsWith(".wav");

    if (isNapt && !aesKey) {
      setNaptMetadata(null);
      setNaptMetadataError("Locked (no session key)");
      return;
    }

    const run = async () => {
      try {
        const fileObj = fileRegistry.get(selectedPrimaryFile.id);
        if (!fileObj) throw new Error("File not found in registry");

        const buffer = await fileObj.arrayBuffer();

        if (isNapt) {
          const maxHeaderRead = Math.min(8192, buffer.byteLength);
          const headerBytes = new Uint8Array(buffer, 0, maxHeaderRead);
          const newlineIndex = headerBytes.indexOf(10);

          let jsonStr: string;
          if (newlineIndex > 0) {
            jsonStr = new TextDecoder().decode(headerBytes.slice(0, newlineIndex));
          } else {
            const headerText = new TextDecoder().decode(headerBytes);
            let braceDepth = 0, inStr = false, esc = false, jsonEnd = -1;
            for (let ci = 0; ci < headerText.length; ci++) {
              const c = headerText[ci];
              if (esc) { esc = false; continue; }
              if (c === '\\') { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === '{') braceDepth++;
              if (c === '}') { braceDepth--; if (braceDepth === 0) { jsonEnd = ci + 1; break; } }
            }
            if (jsonEnd <= 0) throw new Error("Invalid NAPT header");
            jsonStr = headerText.slice(0, jsonEnd);
          }

          const parsed = JSON.parse(jsonStr);
          if (!cancelled) {
            setNaptMetadata((parsed.metadata || parsed) as NaptMetadata);
            setNaptMetadataError(null);
          }
          return;
        }

        if (isWav) {
          const view = new DataView(buffer);
          const readText = (offset: number, length: number) =>
            String.fromCharCode(...Array.from(new Uint8Array(buffer, offset, length)));

          if (readText(0, 4) !== "RIFF" || readText(8, 4) !== "WAVE") {
            throw new Error("Invalid WAV header");
          }

          let offset = 12;
          let metadata: NaptMetadata | null = null;
          while (offset + 8 <= buffer.byteLength) {
            const chunkId = readText(offset, 4);
            const chunkSize = view.getUint32(offset + 4, true);
            if (chunkId === "nAPT") {
              const metadataBytes = new Uint8Array(buffer, offset + 8, chunkSize);
              const nullIndex = metadataBytes.indexOf(0);
              const json = new TextDecoder().decode(
                nullIndex === -1 ? metadataBytes : metadataBytes.slice(0, nullIndex),
              );
              const parsed = JSON.parse(json);
              metadata = (parsed.metadata || parsed) as NaptMetadata;
              break;
            }
            offset += 8 + chunkSize + (chunkSize % 2);
          }

          if (!cancelled) {
            setNaptMetadata(metadata);
            setNaptMetadataError(metadata ? null : "No embedded metadata found");
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          setNaptMetadata(null);
          setNaptMetadataError(error?.message || "Failed to load metadata");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [aesKey, selectedPrimaryFile, sourceMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const notifyLayout = () => {
      window.dispatchEvent(new CustomEvent("demod-flow-node-resize"));
    };

    const rafId = window.requestAnimationFrame(notifyLayout);
    return () => window.cancelAnimationFrame(rafId);
  }, [selectedPrimaryFile, naptMetadata, naptMetadataError]);

  return (
    <NodeContainer>
      <NodeTitle>
        <FileBox size={16} />
        {data.label}
      </NodeTitle>
      <NodeSubtitle>Recorded data properties</NodeSubtitle>
      <FileMetadata
        selectedNaptFile={selectedPrimaryFile}
        naptMetadata={naptMetadata}
        naptMetadataError={naptMetadataError}
        sessionToken={sessionToken}
        showTitle={false}
      />
    </NodeContainer>
  );
};

export default MetadataNode;
