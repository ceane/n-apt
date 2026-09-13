import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { DemodProvider, useDemod } from "@n-apt/demodulation/public/context/DemodContext";
import { DemodulateSidebar } from "@n-apt/demodulation/sidebar/DemodulateSidebar";

export const DemodSidebarAdapter: React.FC = () => {
  const {
    windowSizeHz,
    setWindowSizeHz,
    stepSizeHz,
    setStepSizeHz,
    audioThreshold,
    setAudioThreshold,
    scanner,
    currentFreq,
    scanRange,
    startScan,
    stopScan,
  } = useDemod();

  return (
    <DemodulateSidebar
      windowSizeHz={windowSizeHz}
      stepSizeHz={stepSizeHz}
      audioThreshold={audioThreshold}
      onWindowSizeChange={setWindowSizeHz}
      onStepSizeChange={setStepSizeHz}
      onAudioThresholdChange={setAudioThreshold}
      isScanning={scanner.isScanning}
      scanProgress={scanner.scanProgress}
      scanCurrentFreq={currentFreq}
      scanRange={scanRange}
      detectedRegions={scanner.detectedRegions.length}
      onScanStart={startScan}
      onScanStop={stopScan}
    />
  );
};

export const DemodRouteProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <DemodProvider>
    <ReactFlowProvider>{children}</ReactFlowProvider>
  </DemodProvider>
);
