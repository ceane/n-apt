import React, { useState, useRef, useEffect, useCallback } from "react";
import styled, { useTheme } from "styled-components";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { type AppStyledTheme } from "@n-apt/ui/Theme";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { FFTDiagnosticCanvas } from "@n-apt/spectrum/FFTDiagnosticCanvas";
import { CaptureStitchingGuide } from "@n-apt/spectrum/CaptureStitchingGuide";
import {
  stitchWholeChannelWaveform,
  getAntiAliasingParams,
} from "@n-apt/math/antiAliasing";
import {
  setDiagnosticRunning,
  setDiagnosticStatus,
  useAppDispatch,
  useAppSelector,
} from "@n-apt/redux";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overscroll-behavior: contain;
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ theme }) => theme.colors.background};
  font-family: ${({ theme }) => theme.typography.body};
  padding: 20px;
  overflow-y: auto;

  /* Custom Scrollbar */
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.borderHover};
    border-radius: 10px;
  }
`;

const VisualizerGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-right: 8px;
  overscroll-behavior: none;
`;

const Accordion = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const AccordionItem = styled.section`
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
`;

const AccordionTrigger = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 16px 20px;
  border: 0;
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ theme }) => theme.colors.surfaceHover};
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: -2px;
  }
`;

const AccordionTriggerText = styled.span`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const AccordionTitle = styled.span`
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const AccordionSummary = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 1.4;
`;

const AccordionChevron = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 20px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 0.2s ease;

  ${AccordionTrigger}[aria-expanded="true"] & {
    transform: rotate(180deg);
  }
`;

const AccordionContent = styled.div`
  padding: 16px;
  background: ${({ theme }) => theme.colors.background};
`;

const GuideAccordionContent = styled(AccordionContent)`
  padding-top: 26px;
`;

const Card = styled.div`
  padding: 0;
  margin-bottom: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};

  &:first-child {
    border-radius: 8px 8px 0 0;
  }

  &:last-child {
    border-radius: 0 0 8px 8px;
  }

  &:not(:first-child) {
    border-top: none;
  }
`;

const SegmentedSliderHandle = styled.div<{ $left: number }>`
  position: absolute;
  top: 50%;
  left: ${({ $left }) => $left}%;
  transform: translate(-50%, -50%) scaleX(0.5);
  width: 8px;
  height: 24px;
  background: #ffffff;
  border-radius: 12px;
  z-index: 10;
  opacity: 0;
  transition:
    all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    left 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
  pointer-events: none;
`;

const SegmentedSliderContainer = styled.div`
  display: flex;
  position: relative;
  height: 44px;
  background: ${({ theme }) =>
    theme.mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "#e0e0e0"};
  border-radius: 12px;
  overflow: visible;
  cursor: pointer;
  user-select: none;
  width: 100%;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);

  &:hover ${SegmentedSliderHandle} {
    opacity: 1;
    transform: translate(-50%, -50%) scaleX(1);
  }
`;

const SegmentedSliderTrackWrapper = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
  overflow: hidden;
  z-index: 1;
`;

const SegmentedSliderFill = styled.div<{ $width: number }>`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: ${({ $width }) => $width}%;
  background: ${({ theme }) => theme.colors.primary};
  transition: width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  border-radius: 0;
`;

const SegmentedSliderLabels = styled.div`
  display: flex;
  position: relative;
  width: 100%;
  height: 100%;
  z-index: 2;
`;

const MetadataRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-bottom: 24px;
  padding: 16px 24px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-family: ${({ theme }) => theme.typography.mono};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`;

const MetadataItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MetadataLabel = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.8px;
  font-weight: 600;
`;

const MetadataValue = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: bold;
  font-size: 32px;
  line-height: 1;
`;

const BusyOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: none;
  z-index: 40;
  background: linear-gradient(
    180deg,
    rgba(8, 10, 16, 0.12) 0%,
    rgba(8, 10, 16, 0.56) 100%
  );
  backdrop-filter: blur(5px);
`;

const BusyPanel = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 280px;
  max-width: 460px;
  padding: 18px 22px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(8, 10, 16, 0.78);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
  text-align: center;
`;

const Spinner = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: ${({ theme }) => theme.colors.primary};
  animation: spin 0.8s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const BusyTitle = styled.div`
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const BusyText = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SegmentedSliderLabel = styled.div<{
  $active: boolean;
  $selected: boolean;
}>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 18px;
  font-weight: ${({ $selected }) => ($selected ? "600" : "400")};
  color: ${({ $active, $selected, theme }) => {
    if ($selected) return "#ffffff";
    if ($active) return "rgba(255, 255, 255, 0.45)";
    return theme.mode === "dark" ? "rgba(255, 255, 255, 0.3)" : "#9e9e9e";
  }};
  transition: all 0.2s ease;
  pointer-events: none;
`;

const SegmentedSlider: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}> = ({ value, min, max, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleInteraction = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(
      0,
      Math.min(0.999, (clientX - rect.left) / rect.width),
    );
    const count = max - min + 1;
    const val = Math.floor(pct * count) + min;
    onChange(val);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleInteraction(e.clientX);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        handleInteraction(e.clientX);
      }
    },
    [isDragging, min, max, onChange],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    } else {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const segments = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  const fillWidth = ((value - min + 1) / (max - min + 1)) * 100;

  return (
    <SegmentedSliderContainer ref={containerRef} onMouseDown={handleMouseDown}>
      <SegmentedSliderTrackWrapper>
        <SegmentedSliderFill $width={fillWidth} />
      </SegmentedSliderTrackWrapper>
      <SegmentedSliderHandle $left={fillWidth} />
      <SegmentedSliderLabels>
        {segments.map((s) => (
          <SegmentedSliderLabel
            key={s}
            $active={s <= value}
            $selected={s === value}
          >
            {s}
          </SegmentedSliderLabel>
        ))}
      </SegmentedSliderLabels>
    </SegmentedSliderContainer>
  );
};

export const AntiAliasingDiagnostics: React.FC = () => {
  const theme = useTheme() as AppStyledTheme;
  const { state } = useSpectrumStore();
  const reduxDispatch = useAppDispatch();
  const diagnosticTrigger = useAppSelector(
    (reduxState) => reduxState.spectrum.diagnosticTrigger,
  );
  const diagnosticStatus = useAppSelector(
    (reduxState) => reduxState.spectrum.diagnosticStatus,
  );
  const diagnosticRunning = useAppSelector(
    (reduxState) => reduxState.spectrum.isDiagnosticRunning,
  );
  const [result, setResult] = useState<any>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frontendStitchedFrame, setFrontendStitchedFrame] =
    useState<Float32Array | null>(null);
  const [isWasmProcessing, setIsWasmProcessing] = useState(false);
  const [openPanel, setOpenPanel] = useState<"guide" | "canvases">("guide");

  // Zoom / Interaction
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef(0);

  const { sessionToken } = useAuthentication();
  const isRequestingRef = useRef(false);
  const isCaptureBusy = diagnosticRunning;

  const runDiagnostic = async () => {
    if (isRequestingRef.current) return;
    isRequestingRef.current = true;

    reduxDispatch(setDiagnosticRunning(true));
    reduxDispatch(setDiagnosticStatus("Capturing 10 I/Q frames..."));

    const range = state.frequencyRange;
    const center_hz = range
      ? Math.round((range.min + range.max) / 2)
      : undefined;

    try {
      const response = await fetch("/api/debug/stitch-diagnostic", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          center_hz,
          signal_area: state.activeSignalArea,
          stitch_options: state.stitchOptions,
          fft_size: state.fftSize,
          frames_to_average: 10,
        }),
      });
      if (!response.ok) {
        if (response.status === 401)
          throw new Error("Unauthorized: Please log in again.");
        const errText = await response.text();
        throw new Error(errText || "Failed to run diagnostic");
      }

      const arrayBuffer = await response.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // Check magic "NAPT"
      const magic = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      );
      if (magic !== "NAPT")
        throw new Error("Invalid response format from server");

      const headerLen = view.getUint32(4, true);
      const headerBytes = new Uint8Array(arrayBuffer, 8, headerLen);
      const metadata = JSON.parse(new TextDecoder().decode(headerBytes));

      const binaryStart = 8 + headerLen;
      // Use Uint8Array to read the binary section
      const { fft_size, num_frames } = metadata;
      const u8Data = new Uint8Array(arrayBuffer, binaryStart);
      const frameSpan = fft_size * num_frames;

      const decodeFrame = (offset: number) => {
        const frame = new Float32Array(fft_size);
        const sub = u8Data.subarray(offset, offset + fft_size);
        for (let j = 0; j < fft_size; j++) {
          frame[j] = sub[j] * (150.0 / 255.0) - 150.0;
        }
        return frame;
      };

      const getFrame = (
        section: "hop1" | "hop2" | "stitched",
        index: number,
      ) => {
        const baseOffset =
          section === "hop1"
            ? 0
            : section === "hop2"
              ? frameSpan
              : frameSpan * 2;
        return decodeFrame(baseOffset + index * fft_size);
      };

      setResult({
        ...metadata,
        fft_size,
        num_frames,
        u8Data,
        frameSpan,
        decodeFrame,
        getFrame,
      });
      setFrameIndex(0);
      reduxDispatch(setDiagnosticStatus("I/Q capture complete"));
    } catch (e: any) {
      reduxDispatch(setDiagnosticStatus(`Error: ${e.message}`));
    } finally {
      reduxDispatch(setDiagnosticRunning(false));
      isRequestingRef.current = false;
    }
  };

  useEffect(() => {
    if (diagnosticTrigger > lastTriggerRef.current) {
      lastTriggerRef.current = diagnosticTrigger;
      runDiagnostic();
    }
  }, [diagnosticTrigger]);

  // Handle global wheel event for frame scrubbing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastScrollTime = 0;
    const LOCKOUT_MS = 40;

    const onWheel = (e: WheelEvent) => {
      if (!result) return;
      const scrubber = scrubberRef.current;
      if (!scrubber || !scrubber.contains(e.target as Node)) return;

      e.preventDefault();
      const delta = e.deltaY || e.deltaX;
      const now = Date.now();
      if (now - lastScrollTime < LOCKOUT_MS) return;

      setFrameIndex((prev) => {
        const next = prev + (delta > 0 ? 1 : -1);
        const clamped = Math.max(0, Math.min(result.num_frames - 1, next));
        if (clamped !== prev) lastScrollTime = now;
        return clamped;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [result?.num_frames]);

  // Frontend WASM Processing
  useEffect(() => {
    if (!result || !result.getFrame) return;

    const processFrontendWasm = async () => {
      setIsWasmProcessing(true);
      try {
        const hop1 = result.getFrame("hop1", frameIndex);
        const hop2 = result.getFrame("hop2", frameIndex);
        const h1_range =
          result.hop1_freq_hz ||
          (result.hop1_freq_mhz || []).map((v: number) => v * 1e6);
        const h2_range =
          result.hop2_freq_hz ||
          (result.hop2_freq_mhz || []).map((v: number) => v * 1e6);
        const stitched_range =
          result.stitched_freq_hz ||
          (result.stitched_freq_mhz || []).map((v: number) => v * 1e6);

        const segments = [
          {
            waveform: hop1,
            visualRange: { min: h1_range[0], max: h1_range[1] },
          },
          {
            waveform: hop2,
            visualRange: { min: h2_range[0], max: h2_range[1] },
          },
        ];

        const fullRange = { min: stitched_range[0], max: stitched_range[1] };
        const params = getAntiAliasingParams(state.stitchOptions);

        const stitched = await stitchWholeChannelWaveform(
          segments,
          fullRange,
          params,
        );
        setFrontendStitchedFrame(stitched);
      } catch (e) {
        console.error("Frontend WASM processing failed:", e);
      } finally {
        setIsWasmProcessing(false);
      }
    };

    processFrontendWasm();
  }, [result, frameIndex, state.stitchOptions]);

  return (
    <Container ref={containerRef}>
      <header style={{ marginBottom: theme.spacing.xl }}>
        <h1 style={{ margin: "0", fontSize: theme.typography.headingSize }}>
          I/Q Capture Stitching &amp; Anti-Aliasing Diagnostics
        </h1>
      </header>

      {!isCaptureBusy && diagnosticStatus !== "Ready" && (
        <BusyText role="status" style={{ marginBottom: theme.spacing.md }}>
          {diagnosticStatus}
        </BusyText>
      )}

      <Accordion>
        <AccordionItem>
          <AccordionTrigger
            type="button"
            aria-expanded={openPanel === "guide"}
            aria-controls="capture-stitching-guide-panel"
            onClick={() => setOpenPanel("guide")}
          >
            <AccordionTriggerText>
              <AccordionTitle>
                How it Works / What is being worked on
              </AccordionTitle>
              {openPanel === "guide" && (
                <AccordionSummary>
                  Test how N-APT pieces together a waveform that is wider than
                  the device sample rate. Compare Stepwise and Interleaved
                  (TDMS) I/Q capture stitching, then verify the frontend WASM
                  result against backend ground truth.
                </AccordionSummary>
              )}
            </AccordionTriggerText>
            <AccordionChevron aria-hidden="true">⌄</AccordionChevron>
          </AccordionTrigger>
          {openPanel === "guide" && (
            <GuideAccordionContent id="capture-stitching-guide-panel">
              <CaptureStitchingGuide />
            </GuideAccordionContent>
          )}
        </AccordionItem>

        <AccordionItem>
          <AccordionTrigger
            type="button"
            aria-expanded={openPanel === "canvases"}
            aria-controls="diagnostic-canvases-panel"
            onClick={() => setOpenPanel("canvases")}
          >
            <AccordionTriggerText>
              <AccordionTitle>Stitching Diagnostics</AccordionTitle>
              {openPanel === "canvases" && (
                <AccordionSummary>
                  Compare raw hops and stitched output from the backend and
                  frontend WASM pipeline.
                  <br />
                  Note: FFT size changes apply to the <strong>next</strong> I/Q
                  capture request.
                </AccordionSummary>
              )}
            </AccordionTriggerText>
            <AccordionChevron aria-hidden="true">⌄</AccordionChevron>
          </AccordionTrigger>
          {openPanel === "canvases" && (
            <AccordionContent id="diagnostic-canvases-panel">
              {result && (
                <MetadataRow
                  style={{ justifyContent: "center", padding: "24px" }}
                >
                  <MetadataItem style={{ alignItems: "center" }}>
                    <MetadataLabel>FFT SIZE (SERVER)</MetadataLabel>
                    <MetadataValue>
                      {result.fft_size || state.fftSize}
                    </MetadataValue>
                  </MetadataItem>
                </MetadataRow>
              )}

              <VisualizerGrid
                ref={scrubberRef}
                style={{ position: "relative" }}
              >
                {isCaptureBusy && (
                  <BusyOverlay>
                    <BusyPanel>
                      <Spinner />
                      <BusyTitle>Capturing I/Q diagnostics</BusyTitle>
                      <BusyText>
                        Collecting 10 frames from the server and preparing the
                        response. The previous I/Q capture stays visible until
                        the new one arrives.
                      </BusyText>
                      <BusyText>{diagnosticStatus}</BusyText>
                    </BusyPanel>
                  </BusyOverlay>
                )}

                <FFTDiagnosticCanvas
                  title="Raw Hops (A/B Overlap)"
                  tooltip="Sub-sample fractional delay tracking. We precisely offset time differences in the overlap, align their sine waves smoothly, and perform a hard midpoint cut to eliminate spectral artifacts."
                  badgeText={
                    result?.acquisition_mode === "stepwise"
                      ? "Stepwise I/Q Capture"
                      : result
                        ? "Interleaved (TDMS) I/Q Capture"
                        : undefined
                  }
                  data={result}
                  frameIndex={frameIndex}
                  type="raw"
                  zoomRange={zoomRange}
                  onZoomChange={setZoomRange}
                />

                <FFTDiagnosticCanvas
                  title="Stitched Magnitude Output (Backend)"
                  tooltip="Final product after phase alignment and midpoint cutting (Rust Backend)."
                  data={result}
                  frameIndex={frameIndex}
                  type="stitched"
                  zoomRange={zoomRange}
                  onZoomChange={setZoomRange}
                />

                <FFTDiagnosticCanvas
                  title="Stitched Magnitude Output (Frontend WASM)"
                  tooltip="Final product processed in-browser via WASM (Identical to Production Pipeline)."
                  data={
                    result
                      ? {
                          ...result,
                          stitched_frames: [
                            frontendStitchedFrame || new Float32Array(),
                          ],
                        }
                      : null
                  }
                  frameIndex={frameIndex}
                  type="stitched"
                  badgeText={
                    isWasmProcessing ? "Processing..." : "WASM Verified"
                  }
                  zoomRange={zoomRange}
                  onZoomChange={setZoomRange}
                />
                {isWasmProcessing && (
                  <BusyOverlay
                    style={{ inset: "auto 0 0 0", minHeight: "220px" }}
                  >
                    <BusyPanel>
                      <Spinner />
                      <BusyTitle>Stitching in browser</BusyTitle>
                      <BusyText>
                        Running the frontend WASM stitch for the current slider
                        frame.
                      </BusyText>
                    </BusyPanel>
                  </BusyOverlay>
                )}
              </VisualizerGrid>
              {result && (
                <Card
                  style={{
                    position: "sticky",
                    bottom: "0",
                    zIndex: 25,
                    marginTop: "20px",
                    padding: "16px 24px",
                    display: "flex",
                    alignItems: "center",
                    gap: "24px",
                    cursor: "ew-resize",
                    touchAction: "none",
                    boxShadow: "0 -12px 24px rgba(0,0,0,0.12)",
                  }}
                >
                  <div style={{ flex: 1, padding: "0" }}>
                    <SegmentedSlider
                      value={frameIndex + 1}
                      min={1}
                      max={result.num_frames || 10}
                      onChange={(v) => setFrameIndex(v - 1)}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: theme.typography.mono,
                      fontSize: "13px",
                      color: theme.colors.primary,
                      whiteSpace: "nowrap",
                      fontWeight: "bold",
                      background: theme.colors.activeBackground,
                      padding: "4px 10px",
                      borderRadius: "6px",
                      minWidth: "120px",
                      textAlign: "center",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)",
                    }}
                  >
                    FRAME {String(frameIndex + 1).padStart(2, "0")} /{" "}
                    {String(result.num_frames).padStart(2, "0")}
                  </span>
                </Card>
              )}
            </AccordionContent>
          )}
        </AccordionItem>
      </Accordion>
    </Container>
  );
};

export default AntiAliasingDiagnostics;
