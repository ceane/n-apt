import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_FFT_SIZE,
  DEFAULT_GAIN_DB,
  DEFAULT_PPM,
  DEFAULT_SAMPLE_RATE_HZ,
  MAX_GAIN_DB,
  MAX_SAMPLE_RATE_HZ,
  normalizeFftSize,
  normalizeGainDb,
  normalizePpm,
  normalizeSampleRateHz,
  type RtlSdrConnection,
  RtlSdrWebUsbSession,
  drawSpectrum,
  processRtlSdrFrame,
} from "./rtlSdrWebUsb";
import {
  FrequencyUnit,
  formatFrequency,
  formatFrequencyInputValue,
  getOptimalFrequencyScale,
  parseFrequencyInputValue,
} from "./frequency";
import {
  getSpectrumLoadingPlaceholder,
  getSpectrumPlaceholderState,
  type SpectrumPlaceholderState,
} from "./spectrumPlaceholder";
import {
  getOptionSyncIndicator,
  type OptionSyncState,
  type RtlOptionKey,
} from "./optionSync";

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  boxSizing: "border-box",
  padding: "clamp(16px, 4vw, 42px)",
  background: "#07111f",
  color: "#e5edf8",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const cardStyle: React.CSSProperties = {
  width: "min(100%, 980px)",
  margin: "0 auto",
  padding: "clamp(16px, 3vw, 28px)",
  border: "1px solid #243b5a",
  borderRadius: 16,
  background: "#0c1b2e",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid #345070",
  borderRadius: 8,
  background: "#07111f",
  color: "#e5edf8",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  padding: "11px 16px",
  border: 0,
  borderRadius: 8,
  background: "#2563eb",
  color: "white",
  font: "600 14px inherit",
  cursor: "pointer",
};

const optionPillsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  margin: "8px 0 4px",
};

const optionPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 30,
  padding: "5px 9px",
  border: "1px solid #345070",
  borderRadius: 999,
  background: "rgba(7, 17, 31, .72)",
  fontSize: 11,
};

const optionSyncStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 30,
  padding: "5px 10px",
  border: "1px solid #345070",
  borderRadius: 999,
  fontSize: 11,
};

const canvasFrameStyle: React.CSSProperties = {
  position: "relative",
};

const placeholderOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 1,
  zIndex: 2,
  display: "grid",
  placeItems: "center",
  padding: 16,
  borderRadius: 9,
  background:
    "radial-gradient(circle at top, rgba(255, 255, 255, .04), transparent 55%), linear-gradient(180deg, rgba(8, 11, 18, .86), rgba(3, 5, 10, .96))",
  pointerEvents: "none",
};

const placeholderCardStyle: React.CSSProperties = {
  width: "min(100%, 420px)",
  boxSizing: "border-box",
  padding: "16px 18px",
  border: "1px solid rgba(255, 255, 255, .12)",
  borderRadius: 14,
  background: "rgba(6, 9, 15, .9)",
  boxShadow: "0 16px 42px rgba(0, 0, 0, .35)",
  color: "rgba(244, 247, 252, .94)",
  textAlign: "center",
  backdropFilter: "blur(10px)",
};

export const WebUsbLiteApp: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<RtlSdrWebUsbSession | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const latestBinsRef = useRef<Float32Array | null>(null);
  const initialSampleRateScale = getOptimalFrequencyScale(DEFAULT_SAMPLE_RATE_HZ);
  const [sampleRate, setSampleRate] = useState(
    formatFrequencyInputValue(
      DEFAULT_SAMPLE_RATE_HZ,
      initialSampleRateScale.unit,
    ),
  );
  const [sampleRateUnit, setSampleRateUnit] = useState<FrequencyUnit>(
    initialSampleRateScale.unit,
  );
  const [centerFrequencyHz, setCenterFrequencyHz] = useState(1_600_000);
  const [centerFrequencyUnit, setCenterFrequencyUnit] =
    useState<FrequencyUnit>("MHz");
  const [centerFrequencyValue, setCenterFrequencyValue] = useState("1.6");
  const [fftSize, setFftSize] = useState(String(DEFAULT_FFT_SIZE));
  const [gainDb, setGainDb] = useState(String(DEFAULT_GAIN_DB));
  const [ppm, setPpm] = useState(String(DEFAULT_PPM));
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState(
    "This Lite page owns one USB device and one sample loop; the app backend is not loaded.",
  );
  const [placeholderState, setPlaceholderState] =
    useState<SpectrumPlaceholderState | null>(() =>
      getSpectrumPlaceholderState(false),
    );
  const [optionSyncState, setOptionSyncState] =
    useState<OptionSyncState>("idle");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [frameCount, setFrameCount] = useState(0);
  const optionDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeviceOptionsRef = useRef<{
    sampleRateHz?: number;
    fftSize?: number;
    gainDb?: number;
    ppm?: number;
  }>({});
  const pendingOptionKeysRef = useRef(new Set<RtlOptionKey>());

  const reportError = useCallback((error: unknown): void => {
    setStatus(error instanceof Error ? error.message : String(error));
    setPlaceholderState(getSpectrumPlaceholderState(false, error));
    setOptionSyncState("error");
  }, []);

  const updateDeviceOptions = useCallback(
    async (options: {
      centerFrequencyHz?: number;
      sampleRateHz?: number;
      fftSize?: number;
      gainDb?: number;
      ppm?: number;
    }): Promise<RtlSdrConnection | null> => {
      const session = sessionRef.current;
      if (!session) return null;
      setStatus("Applying RTL-SDR options…");
      const connection = await session.updateOptions(options);
      setStatus(
        "RTL-SDR options updated.",
      );
      return connection;
    },
    [],
  );

  const scheduleDeviceOptions = useCallback(
    (options: {
      centerFrequencyHz?: number;
      sampleRateHz?: number;
      fftSize?: number;
      gainDb?: number;
      ppm?: number;
    }, keys: RtlOptionKey[]): void => {
      if (!sessionRef.current) {
        setOptionSyncState("idle");
        return;
      }
      Object.assign(pendingDeviceOptionsRef.current, options);
      for (const key of keys) pendingOptionKeysRef.current.add(key);
      setOptionSyncState("pending");
      if (optionDebounceTimerRef.current !== null) {
        clearTimeout(optionDebounceTimerRef.current);
      }
      optionDebounceTimerRef.current = setTimeout(() => {
        optionDebounceTimerRef.current = null;
        const nextOptions = pendingDeviceOptionsRef.current;
        pendingDeviceOptionsRef.current = {};
        pendingOptionKeysRef.current.clear();
        void updateDeviceOptions(nextOptions)
          .then((connection) => {
            if (!connection) return;
            setOptionSyncState("sent");
          })
          .catch(reportError);
      }, 350);
    },
    [reportError, updateDeviceOptions],
  );

  const updateCenterFrequencyFromInput = (value: string): void => {
    setCenterFrequencyValue(value);
    const parsed = parseFrequencyInputValue(
      value,
      centerFrequencyUnit,
      0,
      30_000_000_000,
    );
    if (parsed !== null) {
      setCenterFrequencyHz(parsed);
      scheduleDeviceOptions({ centerFrequencyHz: parsed }, ["centerFrequency"]);
    }
  };

  const commitCenterFrequency = (): void => {
    const parsed = parseFrequencyInputValue(
      centerFrequencyValue,
      centerFrequencyUnit,
      0,
      30_000_000_000,
    );
    if (parsed !== null) setCenterFrequencyHz(parsed);
    const nextHz = parsed ?? centerFrequencyHz;
    const nextScale = getOptimalFrequencyScale(nextHz);
    setCenterFrequencyUnit(nextScale.unit);
    setCenterFrequencyValue(formatFrequencyInputValue(nextHz, nextScale.unit));
    scheduleDeviceOptions({ centerFrequencyHz: nextHz }, ["centerFrequency"]);
  };

  const changeCenterFrequencyUnit = (unit: FrequencyUnit): void => {
    const parsed = parseFrequencyInputValue(
      centerFrequencyValue,
      centerFrequencyUnit,
      0,
      30_000_000_000,
    );
    const nextHz = parsed ?? centerFrequencyHz;
    setCenterFrequencyHz(nextHz);
    setCenterFrequencyUnit(unit);
    setCenterFrequencyValue(formatFrequencyInputValue(nextHz, unit));
    scheduleDeviceOptions({ centerFrequencyHz: nextHz }, ["centerFrequency"]);
  };

  const commitSampleRate = (): void => {
    const parsed = parseFrequencyInputValue(
      sampleRate,
      sampleRateUnit,
      1,
      MAX_SAMPLE_RATE_HZ,
    );
    const nextHz = parsed ?? DEFAULT_SAMPLE_RATE_HZ;
    const nextScale = getOptimalFrequencyScale(nextHz);
    setSampleRateUnit(nextScale.unit);
    setSampleRate(formatFrequencyInputValue(nextHz, nextScale.unit));
    scheduleDeviceOptions({ sampleRateHz: nextHz }, ["sampleRate"]);
  };

  const changeSampleRateUnit = (unit: FrequencyUnit): void => {
    const parsed = parseFrequencyInputValue(
      sampleRate,
      sampleRateUnit,
      1,
      MAX_SAMPLE_RATE_HZ,
    );
    const nextHz = parsed ?? DEFAULT_SAMPLE_RATE_HZ;
    setSampleRateUnit(unit);
    setSampleRate(formatFrequencyInputValue(nextHz, unit));
    scheduleDeviceOptions({ sampleRateHz: nextHz }, ["sampleRate"]);
  };

  const paintLatestFrame = useCallback(() => {
    animationFrameRef.current = null;
    if (canvasRef.current && latestBinsRef.current) {
      drawSpectrum(canvasRef.current, latestBinsRef.current, {
        centerFrequencyHz,
        sampleRateHz: sessionRef.current?.getConnection()?.sampleRateHz,
      });
    }
  }, [centerFrequencyHz]);

  const queuePaint = useCallback(() => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(paintLatestFrame);
    }
  }, [paintLatestFrame]);

  const disconnect = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await session.disconnect();
    setConnected(false);
    setStatus("Disconnected.");
    setPlaceholderState(getSpectrumPlaceholderState(false));
  }, []);

  const connect = useCallback(async () => {
    if (sessionRef.current) {
      await disconnect();
      return;
    }

    setStatus("Requesting the RTL-SDR and starting its direct USB stream…");
    setPlaceholderState(getSpectrumLoadingPlaceholder());
    setOptionSyncState("pending");
    try {
      const session = new RtlSdrWebUsbSession();
      const connection = await session.connect({
        centerFrequencyHz,
        sampleRateHz: normalizeSampleRateHz(
          parseFrequencyInputValue(
            sampleRate,
            sampleRateUnit,
            1,
            MAX_SAMPLE_RATE_HZ,
          ) ?? DEFAULT_SAMPLE_RATE_HZ,
        ),
        fftSize: normalizeFftSize(Number(fftSize)),
        gainDb: normalizeGainDb(Number(gainDb)),
        ppm: normalizePpm(Number(ppm)),
      });
      sessionRef.current = session;
      setConnected(true);
      setDeviceLabel(connection.deviceLabel);
      setOptionSyncState("sent");
      setStatus(
        "Streaming the latest RTL-SDR frame.",
      );
      void session
        .start((frame) => {
          latestBinsRef.current = processRtlSdrFrame(frame);
          setPlaceholderState(null);
          setFrameCount((count) => count + 1);
          queuePaint();
        })
        .catch(async (error: unknown) => {
          if (sessionRef.current !== session) return;
          await disconnect();
          reportError(error);
        });
    } catch (error: unknown) {
      reportError(error);
    }
  }, [
    disconnect,
    fftSize,
    gainDb,
    ppm,
    queuePaint,
    reportError,
    sampleRate,
    sampleRateUnit,
  ]);

  useEffect(
    () => () => {
      void sessionRef.current?.disconnect();
      if (optionDebounceTimerRef.current !== null) {
        clearTimeout(optionDebounceTimerRef.current);
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  const optionSyncIndicator = getOptionSyncIndicator(optionSyncState);
  const optionPills = [
    { key: "center", name: "Center", value: formatFrequency(centerFrequencyHz, {
      precisionMHz: 4,
      precisionKHz: 2,
      trimTrailingZeros: true,
    }) },
    { key: "sampleRate", name: "Sample rate", value: formatFrequency(
      parseFrequencyInputValue(sampleRate, sampleRateUnit, 1, MAX_SAMPLE_RATE_HZ) ??
        DEFAULT_SAMPLE_RATE_HZ,
      { precisionMHz: 3, trimTrailingZeros: true },
    ) },
    { key: "fftSize", name: "FFT", value: normalizeFftSize(Number(fftSize)).toLocaleString() },
    { key: "gain", name: "Gain", value: `${normalizeGainDb(Number(gainDb)).toFixed(1)} dB` },
    { key: "ppm", name: "PPM", value: String(normalizePpm(Number(ppm))) },
  ];

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <p style={{ color: "#60a5fa", letterSpacing: "0.12em", fontSize: 11 }}>
          N-APT / LITE / WEBUSB
        </p>
        <h1 style={{ fontSize: "clamp(26px, 6vw, 48px)", margin: "10px 0" }}>
          Direct SDR visualizer
        </h1>
        <p style={{ maxWidth: 720, color: "#a8bdd8", lineHeight: 1.55 }}>
          A standalone app-shaped experiment. WebUSB owns the RTL-SDR, a
          local processor turns IQ into power bins, and one animation frame
          paints the newest result. No Rust backend, auth, Redux, or shared
          subscribers are involved.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12,
            margin: "24px 0 16px",
          }}
        >
          <label>
            <span style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
              Center frequency
            </span>
            <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <input
                style={{ ...inputStyle, borderRadius: "8px 0 0 8px" }}
                type="text"
                inputMode="decimal"
                value={centerFrequencyValue}
                onChange={(event) => updateCenterFrequencyFromInput(event.target.value)}
                onBlur={commitCenterFrequency}
              />
              <select
                aria-label="Center frequency unit"
                style={{ ...inputStyle, width: "auto", borderLeft: 0, borderRadius: "0 8px 8px 0" }}
                value={centerFrequencyUnit}
                onChange={(event) =>
                  changeCenterFrequencyUnit(event.target.value as FrequencyUnit)
                }
              >
                <option>Hz</option>
                <option>kHz</option>
                <option>MHz</option>
                <option>GHz</option>
              </select>
            </span>
          </label>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
              Sample rate (max 3.2 MHz)
            </span>
            <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <input
                style={{ ...inputStyle, borderRadius: "8px 0 0 8px" }}
                type="text"
                inputMode="decimal"
                value={sampleRate}
                onChange={(event) => {
                  const value = event.target.value;
                  const parsed = parseFrequencyInputValue(
                    value,
                    sampleRateUnit,
                    1,
                    MAX_SAMPLE_RATE_HZ,
                  );
                  setSampleRate(
                    parsed === MAX_SAMPLE_RATE_HZ
                      ? formatFrequencyInputValue(MAX_SAMPLE_RATE_HZ, sampleRateUnit)
                      : value,
                  );
                  if (parsed !== null) {
                    scheduleDeviceOptions(
                      { sampleRateHz: parsed },
                      ["sampleRate"],
                    );
                  }
                }}
                onBlur={commitSampleRate}
              />
              <select
                aria-label="Sample rate unit"
                style={{ ...inputStyle, width: "auto", borderLeft: 0, borderRadius: "0 8px 8px 0" }}
                value={sampleRateUnit}
                onChange={(event) =>
                  changeSampleRateUnit(event.target.value as FrequencyUnit)
                }
              >
                <option>Hz</option>
                <option>kHz</option>
                <option>MHz</option>
                <option>GHz</option>
              </select>
            </span>
          </label>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
              FFT size
            </span>
            <input
              style={inputStyle}
              type="number"
              min={256}
              step={1024}
              value={fftSize}
                onChange={(event) => {
                  const value = event.target.value;
                  setFftSize(value);
                  const numericValue = Number(value);
                  if (Number.isFinite(numericValue)) {
                    scheduleDeviceOptions(
                      { fftSize: numericValue },
                      ["fftSize"],
                    );
                  }
                }}
            />
          </label>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
              Gain (dB, max 49.6)
            </span>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={MAX_GAIN_DB}
              step={0.1}
              value={gainDb}
              onChange={(event) => {
                const value = event.target.value;
                const numericValue = Number(value);
                const nextValue =
                  Number.isFinite(numericValue) && numericValue > MAX_GAIN_DB
                    ? String(MAX_GAIN_DB)
                    : value;
                setGainDb(nextValue);
                if (Number.isFinite(numericValue)) {
                  scheduleDeviceOptions(
                    { gainDb: Number(nextValue) },
                    ["gain"],
                  );
                }
              }}
              onBlur={() => {
                const nextValue = normalizeGainDb(Number(gainDb));
                setGainDb(String(nextValue));
                scheduleDeviceOptions({ gainDb: nextValue }, ["gain"]);
              }}
            />
          </label>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
              PPM
            </span>
            <input
              style={inputStyle}
              type="number"
              min={0}
              step={1}
              value={ppm}
              onChange={(event) => {
                const value = event.target.value;
                setPpm(value);
                if (Number.isFinite(Number(value))) {
                  scheduleDeviceOptions(
                    { ppm: Number(value) },
                    ["ppm"],
                  );
                }
              }}
            />
          </label>
          <button
            style={{ ...buttonStyle, alignSelf: "end" }}
            type="button"
            onClick={() => void connect()}
          >
            {connected ? "Disconnect" : "Connect and stream"}
          </button>
        </div>

        <div style={optionPillsStyle} aria-label="RTL-SDR options">
          {optionPills.map((option) => (
            <div key={option.key} style={optionPillStyle}>
              <span style={{ color: "#8fa8c4" }}>{option.name}</span>
              <span style={{ color: "#f3f7ff" }}>{option.value}</span>
            </div>
          ))}
          <div
            data-state={optionSyncState}
            role={optionSyncState === "error" ? "alert" : "status"}
            aria-live={optionSyncState === "error" ? "assertive" : "polite"}
            title={optionSyncIndicator.label}
            style={{
              ...optionSyncStyle,
              color:
                optionSyncState === "error"
                  ? "#ff9a9a"
                  : optionSyncState === "sent"
                    ? "#4ade80"
                    : optionSyncState === "pending"
                      ? "#ffd76a"
                      : "#7188a5",
            }}
          >
            <span
              aria-label={optionSyncIndicator.label}
              style={{
                display: "inline-grid",
                width: 16,
                height: 16,
                placeItems: "center",
                fontSize: 14,
                fontWeight: 700,
                animation:
                  optionSyncState === "pending"
                    ? "webusb-option-spin 1s linear infinite"
                    : undefined,
              }}
            >
              {optionSyncIndicator.symbol}
            </span>
            <span>{optionSyncIndicator.label}</span>
          </div>
        </div>
        <style>{"@keyframes webusb-option-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"}</style>
        <p role="status" aria-live="polite" style={{ minHeight: 42, color: "#a8bdd8" }}>
          {status}
        </p>
        <div style={canvasFrameStyle}>
          <canvas
            ref={canvasRef}
            width={1024}
            height={360}
            aria-label="Live RTL-SDR spectrum"
            style={{
              display: "block",
              width: "100%",
              height: "min(54vw, 360px)",
              border: "1px solid #243b5a",
              borderRadius: 10,
            }}
          />
          {placeholderState && (
            <div
              style={placeholderOverlayStyle}
              data-kind={placeholderState.kind}
              role={placeholderState.kind === "error" ? "alert" : "status"}
              aria-live={placeholderState.kind === "error" ? "assertive" : "polite"}
            >
              <div style={placeholderCardStyle}>
                <div
                  style={{
                    marginBottom: 8,
                    color: placeholderState.kind === "error" ? "#ff9a9a" : "#ffd76a",
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}
                >
                  {placeholderState.kicker}
                </div>
                <div
                  style={{
                    color: placeholderState.kind === "error" ? "#ffd6d6" : "#f3f7ff",
                    fontSize: 16,
                    fontWeight: 700,
                    lineHeight: 1.35,
                  }}
                >
                  {placeholderState.title}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    color: "rgba(219, 225, 235, .9)",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  from {placeholderState.source}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color: "rgba(219, 225, 235, .82)",
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  {placeholderState.message}
                </div>
              </div>
            </div>
          )}
        </div>
        <p style={{ color: "#7188a5", fontSize: 11 }}>
          {deviceLabel || "No device"} · {frameCount.toLocaleString()} frames processed
        </p>
        <p style={{ color: "#7188a5", fontSize: 11, lineHeight: 1.5 }}>
          The direct adapter configures the RTL2832U demodulator and FIFO, and
          the R82xx adapter applies RTL-SDR tuner frequency, gain, and PPM.
          HackRF remains a separate adapter because it uses a different USB
          protocol.
        </p>
      </section>
    </main>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("The WebUSB Lite page is missing #root.");
createRoot(root).render(<WebUsbLiteApp />);
