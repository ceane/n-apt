import { ThemeProvider } from "styled-components";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import type { CaptureStatus } from "@n-apt/hooks/useWebSocket";

const theme = {
  primary: "#00d4ff",
  primaryAnchor: "#002a80",
  primaryAlpha: "rgba(0, 212, 255, 0.2)",
  fft: "#00d4ff",
  mode: "dark",
};

const baseProps = {
  isOpen: true,
  onToggle: () => undefined,
  activeCaptureAreas: ["Onscreen", "A"],
  captureDurationMode: "timed" as const,
  availableCaptureAreas: [
    { label: "Onscreen", min: 0.5, max: 4.37 },
    { label: "A", min: 24.72, max: 29.88 },
    { label: "B", min: 40.1, max: 44.2 },
  ],
  captureDurationS: 12,
  captureFileType: ".napt" as const,
  acquisitionMode: "stepwise" as const,
  captureEncrypted: true,
  capturePlayback: false,
  captureGeolocation: true,
  captureRange: {
    min: 0.5,
    max: 44.2,
    segments: [
      { label: "Onscreen", min: 0.5, max: 4.37 },
      { label: "A", min: 24.72, max: 29.88 },
      { label: "B", min: 40.1, max: 44.2 },
    ],
  },
  maxSampleRate: 6_400_000,
  captureStatus: { jobId: "preview", status: "done" } as CaptureStatus,
  isConnected: true,
  deviceState: "connected" as const,
  onActiveCaptureAreasChange: () => undefined,
  onCaptureDurationModeChange: () => undefined,
  onCaptureDurationSChange: () => undefined,
  onCaptureFileTypeChange: () => undefined,
  onAcquisitionModeChange: () => undefined,
  onCaptureEncryptedChange: () => undefined,
  onCapturePlaybackChange: () => undefined,
  onCaptureGeolocationChange: () => undefined,
  onCapture: () => undefined,
  onClearStatus: () => undefined,
};

export const Default = () => (
  <ThemeProvider theme={theme as any}>
    <div style={{ width: 360, padding: 20, background: "#0a0a0a" }}>
      <IQCaptureControlsSection {...baseProps} />
    </div>
  </ThemeProvider>
);

export default {
  title: "Sidebar/IQ Capture Controls",
};
