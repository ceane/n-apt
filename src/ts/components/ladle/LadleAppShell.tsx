import React from "react";
import { MainLayout } from "@n-apt/components/MainLayout";
import SidebarNew from "@n-apt/components/sidebar/SidebarNew";
import type { DrawParams, SourceMode } from "@n-apt/hooks/useSpectrumStore";
import type { CaptureRequest, CaptureStatus, FrequencyRange } from "@n-apt/hooks/useWebSocket";

import { useLadleContext, useLink } from "@ladle/react";
import { useLocation } from "react-router-dom";

interface LadleAppShellProps {
  children: React.ReactNode;
  route?: string;
  title?: string;
}

const statusPayload = {
  device_connected: false,
  device_name: "Mock APT SDR",
  device_loading_reason: null as null,
  device_state: "disconnected" as const,
  paused: false,
  max_sample_rate: 64000000,
  channels: [
    {
      id: "a",
      label: "A",
      min_mhz: 0.018,
      max_mhz: 4.37,
      description: "Area A: 18kHz-4.47 MHz range",
    },
    {
      id: "b",
      label: "B",
      min_mhz: 24.72,
      max_mhz: 29.88,
      description: "Area B: 24.72-29.88 MHz range",
    },
  ],
  sdr_settings: {
    sample_rate: 3200000,
    center_frequency: 1600000,
    gain: {
      tuner_gain: 49.6,
      rtl_agc: false,
      tuner_agc: false,
    },
    ppm: 1.0,
    fft: {
      default_size: 262144,
      default_frame_rate: 12,
      max_size: 262144,
      max_frame_rate: 60,
      size_to_frame_rate: {
        8192: 60,
        16384: 60,
        32768: 60,
        65536: 48,
        131072: 24,
        262144: 12,
      },
    },
    display: {
      min_db: -120,
      max_db: 0,
      padding: 20,
    },
    limits: {
      lower_limit_mhz: 0.5,
      upper_limit_mhz: 28.8,
      lower_limit_label: "RTL-SDR v4 lower limit",
      upper_limit_label: "Potential hardware spur",
    },
  },
  device: "mock_apt",
};

const routeToTab = (route: string) => {
  if (route.includes("draw")) return "draw";
  if (route.includes("demod")) return "analysis";
  if (route.includes("3d-model")) return "3d-model";
  if (route.includes("map")) return "map-endpoints";
  return "visualizer";
};

const tabToStory = (tab: string) => {
  if (tab.includes("draw")) return "3d-model--draw-signal";
  if (tab.includes("demod")) return "sidebar-demodulate--default";
  if (tab.includes("3d-model")) return "layout--human-model-viewer-simple";
  if (tab.includes("map")) return "sidebar-map-endpoints--default";
  return "layout--fft-canvas";
};

const LocationSync = () => {
  const location = useLocation();
  const linkTo = useLink();
  const { globalState } = useLadleContext();

  React.useEffect(() => {
    const targetStory = tabToStory(location.pathname);
    if (globalState.story !== targetStory) {
      linkTo(targetStory);
    }
  }, [location.pathname, linkTo, globalState.story]);

  return null;
};

const SidebarShell = ({ activeTab }: { activeTab: string }) => {
  const [sourceMode, setSourceMode] = React.useState<SourceMode>("live");
  const [activeSignalArea, setActiveSignalArea] = React.useState(
    statusPayload.channels[0]?.label ?? "A",
  );
  const [frequencyRange, setFrequencyRange] = React.useState<FrequencyRange | null>({
    min: statusPayload.channels[0]?.min_mhz ?? 0,
    max: statusPayload.channels[0]?.max_mhz ?? 0,
  });
  const [drawParams, setDrawParams] = React.useState<DrawParams[]>([]);
  const [selectedFiles, setSelectedFiles] = React.useState<{ name: string; file: File }[]>([]);
  const [stitchStatus, setStitchStatus] = React.useState("Idle");
  const [stitchSourceSettings, setStitchSourceSettings] = React.useState({
    gain: statusPayload.sdr_settings.gain.tuner_gain,
    ppm: statusPayload.sdr_settings.ppm,
  });
  const [isPaused, setIsPaused] = React.useState(statusPayload.paused);
  const [isStitchPaused, setIsStitchPaused] = React.useState(false);
  const [captureStatus, setCaptureStatus] = React.useState<CaptureStatus>(null);

  return (
    <SidebarNew
      isConnected={statusPayload.device_connected}
      deviceState={statusPayload.device_state}
      deviceLoadingReason={statusPayload.device_loading_reason}
      isPaused={isPaused}
      backend={statusPayload.device}
      maxSampleRateHz={statusPayload.max_sample_rate}
      sampleRateHz={statusPayload.sdr_settings.sample_rate}
      sdrSettings={statusPayload.sdr_settings}
      captureStatus={captureStatus}
      autoFftOptions={null}
      onCaptureCommand={(req: CaptureRequest) => {
        setCaptureStatus({
          status: "started",
          jobId: req.jobId ?? "ladle-capture",
        });
      }}
      spectrumFrames={statusPayload.channels}
      activeTab={activeTab}
      drawParams={drawParams}
      onDrawParamsChange={setDrawParams}
      sourceMode={sourceMode}
      onSourceModeChange={setSourceMode}
      stitchStatus={stitchStatus}
      activeSignalArea={activeSignalArea}
      onSignalAreaChange={setActiveSignalArea}
      onFrequencyRangeChange={setFrequencyRange}
      frequencyRange={frequencyRange ?? undefined}
      onPauseToggle={() => setIsPaused((value) => !value)}
      onSettingsChange={() => { }}
      displayTemporalResolution="medium"
      onDisplayTemporalResolutionChange={() => { }}
      selectedFiles={selectedFiles}
      onSelectedFilesChange={setSelectedFiles}
      stitchSourceSettings={stitchSourceSettings}
      onStitchSourceSettingsChange={setStitchSourceSettings}
      isStitchPaused={isStitchPaused}
      onStitchPauseToggle={() => setIsStitchPaused((value) => !value)}
      onStitch={() => setStitchStatus("Stitch requested")}
      onClear={() => {
        setSelectedFiles([]);
        setStitchStatus("Cleared");
      }}
      onRestartDevice={() => { }}
      snapshotGridPreference={true}
      onSnapshotGridPreferenceChange={() => { }}
      onSnapshot={() => { }}
      vizZoom={1}
      vizPanOffset={0}
      onVizPanChange={() => { }}
    />
  );
};

const ContentPanel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div
    style={{
      height: "100%",
      overflow: "auto",
      padding: "32px",
      backgroundColor: "#0a0a0a",
      color: "#e0e0e0",
      fontFamily: "JetBrains Mono, monospace",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        minHeight: "100%",
      }}
    >
      <div>
        <div style={{ fontSize: "24px", color: "#00d4ff", marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "13px", color: "#777" }}>Ladle story rendered inside the real app shell.</div>
      </div>
      {children}
    </div>
  </div>
);

export const LadleAppShell = ({ children, route, title = "N-APT Shell" }: LadleAppShellProps) => {
  const { globalState } = useLadleContext();
  const storyId = globalState.story || "";

  const [isSidebarOpen, setIsSidebarOpen] = React.useState(() => {
    const saved = localStorage.getItem("n-apt-sidebar-open");
    return saved === null ? true : saved === "true";
  });

  const handleSidebarChange = (open: boolean) => {
    setIsSidebarOpen(open);
    localStorage.setItem("n-apt-sidebar-open", String(open));
  };

  // Use the provided route prop if present, otherwise infer from story ID
  const activeRoute = route || (
    storyId.includes("draw") ? "/draw-signal" :
      storyId.includes("demod") ? "/demodulate" :
        (storyId.includes("3d-model") || storyId.includes("human-model")) ? "/3d-model" :
          storyId.includes("map") ? "/map-endpoints" :
            "/visualizer"
  );

  return (
    <MainLayout
      sidebar={<SidebarShell activeTab={routeToTab(activeRoute)} />}
      isSidebarOpen={isSidebarOpen}
      onSidebarOpenChange={handleSidebarChange}
    >
      <LocationSync />
      <ContentPanel title={title}>{children}</ContentPanel>
    </MainLayout>
  );
};
