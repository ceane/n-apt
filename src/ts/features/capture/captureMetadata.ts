import { decodeIqCaptureHeader } from "@n-apt/webusb/iqCaptureFormat";

const IQ_CAPTURE_EXTENSIONS = [".iq", ".napt", ".wav"] as const;

export const isMetadataCaptureFile = (fileName: string): boolean => {
  const lowerName = fileName.toLowerCase();
  return IQ_CAPTURE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
};

export const selectPrimaryMetadataCaptureFile = <T extends { name: string }>(
  sourceMode: "live" | "file",
  selectedFiles: T[],
): T | null => {
  if (sourceMode !== "file" || selectedFiles.length !== 1) return null;
  return isMetadataCaptureFile(selectedFiles[0].name) ? selectedFiles[0] : null;
};

/** IQ capture metadata is stored in the public header, outside the encrypted payload. */
export const parseIqCaptureMetadata = (
  bytes: Uint8Array,
): Record<string, unknown> => decodeIqCaptureHeader(bytes).metadata;
