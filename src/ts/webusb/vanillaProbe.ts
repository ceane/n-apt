import {
  DEFAULT_FFT_SIZE,
  DEFAULT_GAIN_DB,
  DEFAULT_PPM,
  DEFAULT_SAMPLE_RATE_HZ,
  MAX_GAIN_DB,
  MAX_SAMPLE_RATE_HZ,
  RtlSdrWebUsbSession,
  drawSpectrum,
  normalizeFftSize,
  normalizeGainDb,
  normalizePpm,
  normalizeSampleRateHz,
  processRtlSdrFrame,
} from "./rtlSdrWebUsb";
import {
  clampFrequencyHz,
  FrequencyUnit,
  formatFrequency,
  formatFrequencyInputValue,
  getFrequencyArrowStepHz,
  getOptimalFrequencyScale,
  parseFrequencyInputValue,
  trimNumericString,
} from "./frequency";
import {
  getSpectrumLoadingPlaceholder,
  getSpectrumPlaceholderState,
  type SpectrumPlaceholderState,
} from "./spectrumPlaceholder";
import {
  getOptionSyncIndicator,
  type OptionSyncState,
} from "./optionSync";
import {
  getRtlSdrOptionState,
  haveRtlSdrOptionsChanged,
  type RtlSdrOptionState,
} from "./rtlSdrOptionState";
import {
  getValidChannelCenterRange,
  parseCanonicalNaptChannels,
  resolveNaptChannelCenter,
} from "./naptChannels";
import {
  getWebUsbSnapshotFilename,
  renderWebUsbSnapshot,
  type WebUsbSnapshotData,
  type WebUsbSnapshotFormat,
} from "./webUsbSnapshots";
import {
  IqCaptureRecorder,
  type IqCaptureFormat,
  type IqCaptureOptions,
} from "./iqCapture";
import { reverseGeocodeSnapshotLocation } from "@n-apt/capture/snapshotLocation";
import signalsYaml from "../../../signals.yaml?raw";

const MOBILE_FIRST_VISIT_NOTICE_KEY =
  "n-apt.webusb-probe.mobile-notice-seen";

function showMobileFirstVisitNotice(): void {
  if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;

  let alreadySeen = false;
  try {
    alreadySeen =
      window.localStorage.getItem(MOBILE_FIRST_VISIT_NOTICE_KEY) === "1";
  } catch {
    // Continue without persistence when storage is unavailable.
  }
  if (alreadySeen) return;

  try {
    window.localStorage.setItem(MOBILE_FIRST_VISIT_NOTICE_KEY, "1");
  } catch {
    // The notice is still useful even when private browsing blocks storage.
  }

  window.alert(
    "If this page is blank in Chrome for Android, close the browser completely and reopen it. The page should then appear normally.",
  );
}

const centerFrequencyInputElement =
  document.querySelector<HTMLInputElement>("#center-frequency");
const centerFrequencyUnitElement =
  document.querySelector<HTMLSelectElement>("#center-frequency-unit");
const sampleRateInputElement =
  document.querySelector<HTMLInputElement>("#sample-rate");
const sampleRateUnitElement =
  document.querySelector<HTMLSelectElement>("#sample-rate-unit");
const fftSizeInputElement = document.querySelector<HTMLSelectElement>("#fft-size");
const gainInputElement = document.querySelector<HTMLInputElement>("#gain-db");
const ppmInputElement = document.querySelector<HTMLInputElement>("#ppm");
const naptChannelButtonsElement = document.querySelector<HTMLElement>(
  "#napt-channel-buttons",
);
const connectButtonElement =
  document.querySelector<HTMLButtonElement>("#connect");
const streamToggleButtonElement =
  document.querySelector<HTMLButtonElement>("#stream-toggle");
const disconnectSourceButtonElement =
  document.querySelector<HTMLButtonElement>("#disconnect-source");
const cardElement = document.querySelector<HTMLElement>(".card");
const mobileLandscapeToggleElement =
  document.querySelector<HTMLButtonElement>("#mobile-landscape-controls-toggle");
const mobileLandscapePanelElement =
  document.querySelector<HTMLElement>(".mobile-landscape-panel");
const sourcePillElement = document.querySelector<HTMLElement>("#source-pill");
const statusElementElement = document.querySelector<HTMLElement>("#status");
const canvasElement = document.querySelector<HTMLCanvasElement>("#spectrum");
const canvasFrameElement = document.querySelector<HTMLElement>(".canvas-frame");
const deviceElementElement = document.querySelector<HTMLElement>("#device");
const spectrumPlaceholderElement =
  document.querySelector<HTMLElement>("#spectrum-placeholder");
const placeholderKickerElement =
  document.querySelector<HTMLElement>("#placeholder-kicker");
const placeholderTitleElement =
  document.querySelector<HTMLElement>("#placeholder-title");
const placeholderSourceElement =
  document.querySelector<HTMLElement>("#placeholder-source");
const placeholderBodyElement =
  document.querySelector<HTMLElement>("#placeholder-body");
const optionSyncElement = document.querySelector<HTMLElement>("#option-sync");
const optionSyncIndicatorElement = document.querySelector<HTMLElement>(
  "#option-sync-indicator",
);
const optionSyncLabelElement = document.querySelector<HTMLElement>(
  "#option-sync-label",
);
const snapshotImageButtonElement =
  document.querySelector<HTMLButtonElement>("#snapshot-image");
const snapshotPillElement =
  document.querySelector<HTMLElement>(".snapshot-pill");
const snapshotSvgButtonElement =
  document.querySelector<HTMLButtonElement>("#snapshot-svg");
const snapshotVideoButtonElement =
  document.querySelector<HTMLButtonElement>("#snapshot-video");
const snapshotStatsToggleElement =
  document.querySelector<HTMLButtonElement>("#snapshot-stats-toggle");
const snapshotStatusElement =
  document.querySelector<HTMLElement>("#snapshot-status");
const iqCaptureFormatElement =
  document.querySelector<HTMLSelectElement>("#iq-capture-format");
const iqCapturePassphraseElement =
  document.querySelector<HTMLInputElement>("#iq-capture-passphrase");
const iqCaptureToggleElement =
  document.querySelector<HTMLButtonElement>("#iq-capture-toggle");
const iqCaptureStatusElement =
  document.querySelector<HTMLElement>("#iq-capture-status");

if (
  !centerFrequencyInputElement ||
  !centerFrequencyUnitElement ||
  !sampleRateInputElement ||
  !sampleRateUnitElement ||
  !fftSizeInputElement ||
  !gainInputElement ||
  !ppmInputElement ||
  !naptChannelButtonsElement ||
  !connectButtonElement ||
  !streamToggleButtonElement ||
  !disconnectSourceButtonElement ||
  !cardElement ||
  !mobileLandscapeToggleElement ||
  !mobileLandscapePanelElement ||
  !sourcePillElement ||
  !statusElementElement ||
  !canvasElement ||
  !canvasFrameElement ||
  !deviceElementElement ||
  !spectrumPlaceholderElement ||
  !placeholderKickerElement ||
  !placeholderTitleElement ||
  !placeholderSourceElement ||
  !placeholderBodyElement ||
  !optionSyncElement ||
  !optionSyncIndicatorElement ||
  !optionSyncLabelElement ||
  !snapshotImageButtonElement ||
  !snapshotPillElement ||
  !snapshotSvgButtonElement ||
  !snapshotVideoButtonElement ||
  !snapshotStatsToggleElement ||
  !snapshotStatusElement ||
  !iqCaptureFormatElement ||
  !iqCapturePassphraseElement ||
  !iqCaptureToggleElement ||
  !iqCaptureStatusElement
) {
  throw new Error("The standalone WebUSB probe markup is incomplete.");
}

const centerFrequencyInput = centerFrequencyInputElement;
const centerFrequencyUnit = centerFrequencyUnitElement;
const sampleRateInput = sampleRateInputElement;
const sampleRateUnit = sampleRateUnitElement;
const fftSizeInput = fftSizeInputElement;
const gainInput = gainInputElement;
const ppmInput = ppmInputElement;
const naptChannelButtons = naptChannelButtonsElement;
const connectButton = connectButtonElement;
const streamToggleButton = streamToggleButtonElement;
const disconnectSourceButton = disconnectSourceButtonElement;
const card = cardElement;
const mobileLandscapeToggle = mobileLandscapeToggleElement;
const mobileLandscapePanel = mobileLandscapePanelElement;
const sourcePill = sourcePillElement;
const statusElement = statusElementElement;
const canvas = canvasElement;
const canvasFrame = canvasFrameElement;
const deviceElement = deviceElementElement;
const spectrumPlaceholder = spectrumPlaceholderElement;
const placeholderKicker = placeholderKickerElement;
const placeholderTitle = placeholderTitleElement;
const placeholderSource = placeholderSourceElement;
const placeholderBody = placeholderBodyElement;
const optionSync = optionSyncElement;
const optionSyncIndicator = optionSyncIndicatorElement;
const optionSyncLabel = optionSyncLabelElement;
const snapshotImageButton = snapshotImageButtonElement;
const snapshotPill = snapshotPillElement;
const snapshotSvgButton = snapshotSvgButtonElement;
const snapshotVideoButton = snapshotVideoButtonElement;
const snapshotStatsToggle = snapshotStatsToggleElement;
const snapshotStatus = snapshotStatusElement;
const iqCaptureFormat = iqCaptureFormatElement;
const iqCapturePassphrase = iqCapturePassphraseElement;
const iqCaptureToggle = iqCaptureToggleElement;
const iqCaptureStatus = iqCaptureStatusElement;
const iqCapturePill = iqCaptureToggle.closest<HTMLElement>(".iq-capture-pill");

const mobileLandscapeQuery = window.matchMedia(
  "(orientation: landscape) and (max-width: 960px)",
);
let landscapeControlsOpen = false;

let centerFrequencyHz = 1_600_000;
const naptChannels = parseCanonicalNaptChannels(signalsYaml);
let activeNaptChannelId: string | null =
  naptChannels.find(
    (channel) =>
      centerFrequencyHz >= channel.minHz && centerFrequencyHz <= channel.maxHz,
  )?.id ?? null;
const lastNaptChannelCenters = new Map<string, number>();
const naptChannelPanDirections = new Map<string, 1 | -1>();
const initialFrequencyScale = getOptimalFrequencyScale(centerFrequencyHz);
let centerFrequencyUnitValue = initialFrequencyScale.unit;
centerFrequencyUnit.value = initialFrequencyScale.unit;
centerFrequencyInput.value = trimNumericString(
  formatFrequencyInputValue(centerFrequencyHz, initialFrequencyScale.unit),
);
const initialSampleRateScale = getOptimalFrequencyScale(DEFAULT_SAMPLE_RATE_HZ);
let sampleRateUnitValue = initialSampleRateScale.unit;
sampleRateUnit.value = initialSampleRateScale.unit;
sampleRateInput.value = trimNumericString(
  formatFrequencyInputValue(DEFAULT_SAMPLE_RATE_HZ, initialSampleRateScale.unit),
);
fftSizeInput.value = String(DEFAULT_FFT_SIZE);
gainInput.value = String(DEFAULT_GAIN_DB);
ppmInput.value = String(DEFAULT_PPM);

gainInput.max = String(MAX_GAIN_DB);
gainInput.addEventListener("input", () => {
  const value = Number(gainInput.value);
  if (Number.isFinite(value) && value > MAX_GAIN_DB) {
    gainInput.value = String(MAX_GAIN_DB);
  }
});

let session: RtlSdrWebUsbSession | null = null;
let streamPaused = false;
let animationFrame: number | null = null;
let latestBins: Float32Array | null = null;
let optionDebounceTimer: number | null = null;
let deviceOptionUpdateQueue: Promise<void> = Promise.resolve();
let mediaRecorder: MediaRecorder | null = null;
let videoCanvas: HTMLCanvasElement | null = null;
let videoAnimationFrame: number | null = null;
let videoChunks: Blob[] = [];
let snapshotMode: 0 | 1 | 2 = 0;
let snapshotGeolocation: { lat: string; lon: string } | null = null;
let snapshotLocationLabel: string | null = null;
let snapshotGeolocationUnavailable = false;
let snapshotGeolocationRequestId = 0;
const snapshotSuccessTimers = new Map<HTMLButtonElement, number>();
let iqCaptureRecorder: IqCaptureRecorder | null = null;
let naptCaptureAvailable = false;
let iqCaptureStatusTimer: number | null = null;

function optionValueElement(key: "centerFrequency" | "sampleRate" | "fftSize" | "gain" | "ppm"): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-option-value="${key}"]`,
  );
}

function setOptionValue(key: "centerFrequency" | "sampleRate" | "fftSize" | "gain" | "ppm", value: string): void {
  const element = optionValueElement(key);
  if (element) element.textContent = value;
}

function formatCenterFrequencyValue(): string {
  return formatFrequency(centerFrequencyHz, {
    precisionMHz: 4,
    precisionKHz: 2,
    trimTrailingZeros: true,
  });
}

function rememberActiveNaptChannelCenter(): void {
  if (!activeNaptChannelId) return;
  const channel = naptChannels.find(
    (candidate) => candidate.id === activeNaptChannelId,
  );
  if (!channel) return;
  const validRange = getValidChannelCenterRange(
    channel,
    getSampleRateFromInput(),
  );
  if (
    centerFrequencyHz >= validRange.minHz &&
    centerFrequencyHz <= validRange.maxHz
  ) {
    lastNaptChannelCenters.set(channel.id, centerFrequencyHz);
  }
}

function setCenterFrequencyFromChannel(centerHz: number): void {
  centerFrequencyHz = Math.max(1, Math.floor(centerHz));
  formatCenterFrequency();
  rememberActiveNaptChannelCenter();
  scheduleDeviceOptions();
  queuePaint();
}

function refreshNaptChannelButtons(): void {
  naptChannelButtons.replaceChildren(
    ...naptChannels.map((channel) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "napt-channel-button";
      button.dataset.channelId = channel.id;
      button.dataset.active = String(channel.id === activeNaptChannelId);
      button.ariaPressed = String(channel.id === activeNaptChannelId);
      button.textContent = `Channel ${channel.label} / ${formatFrequency(channel.minHz)} - ${formatFrequency(channel.maxHz)}`;
      button.addEventListener("click", () => {
        rememberActiveNaptChannelCenter();
        const isActive = channel.id === activeNaptChannelId;
        activeNaptChannelId = channel.id;
        const targetCenterHz = resolveNaptChannelCenter({
          channel,
          sampleRateHz: getSampleRateFromInput(),
          currentCenterHz: centerFrequencyHz,
          rememberedCenterHz: lastNaptChannelCenters.get(channel.id) ?? null,
          isActive,
          panDirection: naptChannelPanDirections.get(channel.id) ?? 1,
        });
        if (isActive) {
          const sampleRateHz = getSampleRateFromInput();
          const validRange = getValidChannelCenterRange(channel, sampleRateHz);
          const currentDirection =
            naptChannelPanDirections.get(channel.id) ?? 1;
          if (
            (currentDirection === 1 && targetCenterHz >= validRange.maxHz) ||
            (currentDirection === -1 && targetCenterHz <= validRange.minHz)
          ) {
            naptChannelPanDirections.set(
              channel.id,
              currentDirection === 1 ? -1 : 1,
            );
          }
        }
        lastNaptChannelCenters.set(channel.id, targetCenterHz);
        setCenterFrequencyFromChannel(targetCenterHz);
        refreshNaptChannelButtons();
      });
      return button;
    }),
  );
}

function setOptionSyncState(state: OptionSyncState): void {
  const indicator = getOptionSyncIndicator(state);
  optionSync.dataset.state = state;
  optionSyncIndicator.textContent = indicator.symbol;
  optionSyncIndicator.title = indicator.label;
  optionSyncIndicator.ariaLabel = indicator.label;
  optionSyncLabel.textContent = indicator.label;
}

function refreshOptionValues(connection?: {
  centerFrequencyHz?: number;
  sampleRateHz: number;
  fftSize: number;
  gainDb: number;
  ppm: number;
}): void {
  if (connection?.centerFrequencyHz !== undefined) {
    centerFrequencyHz = connection.centerFrequencyHz;
  }
  setOptionValue("centerFrequency", formatCenterFrequencyValue());
  setOptionValue(
    "sampleRate",
    formatFrequency(connection?.sampleRateHz ?? getSampleRateFromInput(), {
      precisionMHz: 3,
      trimTrailingZeros: true,
    }),
  );
  setOptionValue(
    "fftSize",
    (connection?.fftSize ?? normalizeFftSize(Number(fftSizeInput.value))).toLocaleString(),
  );
  setOptionValue(
    "gain",
    `${(connection?.gainDb ?? normalizeGainDb(Number(gainInput.value))).toFixed(1)} dB`,
  );
  setOptionValue(
    "ppm",
    String(connection?.ppm ?? normalizePpm(Number(ppmInput.value))),
  );
}

function markConnectedOptionStates(): void {
  setOptionSyncState("sent");
}

function setStatus(message: string, isError = false): void {
  statusElement.textContent = message;
  statusElement.dataset.error = String(isError);
  statusElement.title = message;
  const isPending = message.includes("Applying") || message.includes("Requesting");
  sourcePill.dataset.state = isError
    ? "error"
    : isPending
      ? "pending"
      : session
        ? "connected"
        : "idle";
}

function refreshStreamToggle(): void {
  const connected = session !== null;
  streamToggleButton.disabled = !connected;
  streamToggleButton.textContent = streamPaused ? "Resume" : "Pause";
  streamToggleButton.ariaPressed = String(streamPaused);
}

function refreshMobileLandscapeControls(): void {
  const isMobileLandscape = mobileLandscapeQuery.matches;
  if (!isMobileLandscape) landscapeControlsOpen = false;
  card.dataset.landscapeControls = landscapeControlsOpen ? "open" : "closed";
  if (isMobileLandscape && landscapeControlsOpen) {
    const cardRect = card.getBoundingClientRect();
    const canvasRect = canvasFrame.getBoundingClientRect();
    mobileLandscapePanel.style.setProperty(
      "--landscape-panel-center-x",
      `${canvasRect.left - cardRect.left + canvasRect.width / 2}px`,
    );
    mobileLandscapePanel.style.setProperty(
      "--landscape-panel-center-y",
      `${canvasRect.top - cardRect.top + canvasRect.height / 2}px`,
    );
  } else {
    mobileLandscapePanel.style.removeProperty("--landscape-panel-center-x");
    mobileLandscapePanel.style.removeProperty("--landscape-panel-center-y");
  }
  mobileLandscapeToggle.hidden = !isMobileLandscape;
  mobileLandscapeToggle.ariaExpanded = String(landscapeControlsOpen);
  mobileLandscapeToggle.textContent = landscapeControlsOpen ? "Close" : "Options";
}

function refreshSourceActions(): void {
  const connected = session !== null;
  connectButton.hidden = connected;
  disconnectSourceButton.hidden = !connected;
  disconnectSourceButton.disabled = !connected;
}

function setSnapshotStatus(message: string, isError = false): void {
  snapshotStatus.textContent = message;
  snapshotStatus.dataset.error = String(isError);
  if (message) setStatus(message, isError);
}

function setIqCaptureStatus(message: string, isError = false): void {
  if (iqCaptureStatusTimer !== null) {
    window.clearTimeout(iqCaptureStatusTimer);
    iqCaptureStatusTimer = null;
  }
  iqCaptureStatus.textContent = message;
  iqCaptureStatus.dataset.error = String(isError);
  delete iqCaptureStatus.dataset.success;
  if (message) setStatus(message, isError);
}

function getIqCaptureOptions(
  connection = session?.getConnection(),
): IqCaptureOptions | null {
  if (!connection) return null;
  return {
    centerFrequencyHz: connection.centerFrequencyHz,
    sampleRateHz: connection.sampleRateHz,
    fftSize: connection.fftSize,
    fftWindow: "Hanning",
    gainDb: connection.gainDb,
    ppm: connection.ppm,
  };
}

function getIqCaptureFilename(format: IqCaptureFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `n-apt_capture_${timestamp}${format}`;
}

function getIqCaptureMetadata(
  connection: NonNullable<ReturnType<RtlSdrWebUsbSession["getConnection"]>>,
): Record<string, unknown> {
  return {
    center_frequency_hz: connection.centerFrequencyHz,
    capture_sample_rate_hz: connection.sampleRateHz,
    hardware_sample_rate_hz: connection.sampleRateHz,
    encrypted: false,
    timestamp_utc: new Date().toISOString(),
    frame_rate: 0,
    fft_size: connection.fftSize,
    fft_window: "Hanning",
    duration_s: 0,
    acquisition_mode: "interleaved",
    source_device: connection.deviceLabel,
    gain: connection.gainDb,
    ppm: connection.ppm,
    tuner_agc: false,
    rtl_agc: false,
    data_format: "iq_u8",
    spectrum_shifted: true,
    device_profile: {
      kind: connection.deviceLabel,
      firmware_version: null,
    },
  };
}

function refreshIqCaptureControls(): void {
  const recording = iqCaptureRecorder?.isRecording() ?? false;
  const connected = session !== null;
  if (iqCapturePill) {
    iqCapturePill.dataset.state = connected || recording ? "ready" : "unavailable";
  }
  const naptOption = iqCaptureFormat.querySelector<HTMLOptionElement>(
    'option[value=".napt"]',
  );
  if (naptOption) {
    naptOption.disabled = !naptCaptureAvailable;
    naptOption.title = naptCaptureAvailable
      ? "Encrypt an app-compatible .napt capture with a passphrase."
      : "Encrypted captures are unavailable in this browser.";
  }
  if (!naptCaptureAvailable && iqCaptureFormat.value === ".napt") {
    iqCaptureFormat.value = ".iq";
  }
  if (iqCapturePill) iqCapturePill.dataset.format = iqCaptureFormat.value;
  iqCaptureFormat.disabled = recording;
  iqCapturePassphrase.disabled = recording || iqCaptureFormat.value !== ".napt";
  iqCaptureToggle.disabled = !connected && !recording;
  iqCaptureToggle.textContent = recording ? "Stop & Save" : "Record";
  iqCaptureToggle.ariaPressed = String(recording);
}

function showSnapshotSuccess(button: HTMLButtonElement, label: string): void {
  const existingTimer = snapshotSuccessTimers.get(button);
  if (existingTimer !== undefined) window.clearTimeout(existingTimer);
  button.textContent = "✓";
  button.dataset.success = "true";
  const timer = window.setTimeout(() => {
    button.textContent = label;
    delete button.dataset.success;
    snapshotSuccessTimers.delete(button);
  }, 1200);
  snapshotSuccessTimers.set(button, timer);
}

function refreshSnapshotStatsToggle(): void {
  const label = snapshotMode === 0
    ? "Stats: Off"
    : snapshotMode === 1
      ? snapshotGeolocationUnavailable
        ? "Stats: On (no geolocation / denied)"
        : "Stats: On"
      : "Stats + Geo";
  snapshotStatsToggle.textContent = label;
  snapshotStatsToggle.ariaPressed = String(snapshotMode > 0);
  snapshotStatsToggle.title = "Cycle stats: off, stats, or stats plus geolocation";
}

function getCurrentSnapshotData(): WebUsbSnapshotData | null {
  const connection = session?.getConnection();
  if (!latestBins || !connection) return null;
  return {
    waveform: latestBins,
    centerFrequencyHz: connection.centerFrequencyHz,
    sampleRateHz: connection.sampleRateHz,
    fftSize: connection.fftSize,
    gainDb: connection.gainDb,
    ppm: connection.ppm,
    deviceName: connection.deviceLabel,
    geolocation: snapshotMode === 2 ? snapshotGeolocation : null,
    locationLabel: snapshotMode === 2 ? snapshotLocationLabel : null,
  };
}

function getSnapshotDimensions(): { width: number; height: number } {
  return {
    width: Math.max(320, canvas.clientWidth || 1200),
    height: Math.max(240, canvas.clientHeight || 400),
  };
}

function refreshSnapshotButtons(): void {
  const available = getCurrentSnapshotData() !== null;
  snapshotPill.dataset.state = available ? "ready" : "unavailable";
  snapshotImageButton.disabled = !available;
  snapshotSvgButton.disabled = !available;
  snapshotVideoButton.disabled = !available && mediaRecorder === null;
  snapshotStatsToggle.disabled = !available && mediaRecorder === null;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function finishIqCapture(save: boolean): Promise<void> {
  if (!iqCaptureRecorder?.isRecording()) return;
  try {
    const result = await iqCaptureRecorder.stop();
    if (save) {
      downloadBlob(
        new Blob([result.data], {
          type: result.filename.endsWith(".napt")
            ? "application/octet-stream"
            : "application/octet-stream",
        }),
        result.filename,
      );
      setIqCaptureStatus(
        `${result.filename} saved (${result.frameCount.toLocaleString()} frames).`,
      );
      iqCaptureStatus.dataset.success = "true";
      iqCaptureStatusTimer = window.setTimeout(() => {
        iqCaptureStatus.textContent = "";
        delete iqCaptureStatus.dataset.success;
        iqCaptureStatusTimer = null;
        setStatus(
          session ? "Streaming the latest RTL-SDR frame." : "Disconnected.",
        );
      }, 1800);
    } else {
      setIqCaptureStatus("I/Q capture discarded.");
    }
  } catch (error: unknown) {
    iqCaptureRecorder.abort();
    setIqCaptureStatus(
      error instanceof Error ? error.message : String(error),
      true,
    );
  } finally {
    refreshIqCaptureControls();
  }
}

async function toggleIqCapture(): Promise<void> {
  if (iqCaptureRecorder?.isRecording()) {
    iqCaptureToggle.disabled = true;
    setIqCaptureStatus("Finalizing capture in the worker…");
    await finishIqCapture(true);
    return;
  }
  const connection = session?.getConnection();
  const options = getIqCaptureOptions(connection);
  if (!connection || !options || !iqCaptureRecorder) {
    setIqCaptureStatus("Connect an RTL-SDR before recording I/Q.", true);
    return;
  }

  const format = iqCaptureFormat.value as IqCaptureFormat;
  const passphrase = format === ".napt" ? iqCapturePassphrase.value.trim() : undefined;
  if (format === ".napt" && !passphrase) {
    setIqCaptureStatus("Enter a passphrase before recording an encrypted capture.", true);
    iqCapturePassphrase.focus();
    return;
  }

  try {
    await iqCaptureRecorder.start({
      format,
      filename: getIqCaptureFilename(format),
      metadata: getIqCaptureMetadata(connection),
      channel: {
        center_freq_hz: connection.centerFrequencyHz,
        sample_rate_hz: connection.sampleRateHz,
        requested_min_freq_hz:
          connection.centerFrequencyHz - connection.sampleRateHz / 2,
        requested_max_freq_hz:
          connection.centerFrequencyHz + connection.sampleRateHz / 2,
        bins_per_frame: connection.fftSize,
        label: null,
      },
      options,
      passphrase,
    });
    setIqCaptureStatus(`Recording ${format} in the worker…`);
    refreshIqCaptureControls();
  } catch (error: unknown) {
    setIqCaptureStatus(
      error instanceof Error ? error.message : String(error),
      true,
    );
    refreshIqCaptureControls();
  }
}

function initializeIqCapture(): void {
  try {
    iqCaptureRecorder = new IqCaptureRecorder({
      onProgress: ({ bytes, frameCount }) => {
        if (iqCaptureRecorder?.isRecording()) {
          setIqCaptureStatus(
            `Recording ${frameCount.toLocaleString()} frames (${bytes.toLocaleString()} bytes)…`,
          );
        }
      },
      onError: (error) => {
        setIqCaptureStatus(error.message, true);
        refreshIqCaptureControls();
      },
    });
    refreshIqCaptureControls();
    void IqCaptureRecorder.supportsEncryptedNapt().then((supported) => {
      naptCaptureAvailable = supported;
      refreshIqCaptureControls();
      if (!supported && iqCaptureFormat.value === ".napt") {
        setIqCaptureStatus("Encrypted .napt is unavailable; using .iq.");
      }
    });
  } catch {
    iqCaptureRecorder = null;
    setIqCaptureStatus("I/Q recording is unavailable in this browser.", true);
  }
}

async function downloadRenderedSnapshot(
  rendered: HTMLCanvasElement | string,
  format: WebUsbSnapshotFormat,
): Promise<void> {
  const filename = getWebUsbSnapshotFilename(format);
  if (typeof rendered === "string") {
    downloadBlob(new Blob([rendered], { type: "image/svg+xml" }), filename);
    return;
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    rendered.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Unable to encode the PNG snapshot."));
    }, "image/png");
  });
  downloadBlob(blob, filename);
}

async function saveSnapshot(format: WebUsbSnapshotFormat): Promise<void> {
  const data = getCurrentSnapshotData();
  if (!data) {
    setSnapshotStatus("Connect and receive a frame before saving a snapshot.", true);
    return;
  }
  try {
    const dimensions = getSnapshotDimensions();
    const rendered = renderWebUsbSnapshot(data, {
      format,
      ...dimensions,
      showStats: snapshotMode > 0,
    });
    await downloadRenderedSnapshot(rendered, format);
    showSnapshotSuccess(
      format === "png" ? snapshotImageButton : snapshotSvgButton,
      format === "png" ? "Image" : "SVG",
    );
    setSnapshotStatus("");
  } catch (error: unknown) {
    setSnapshotStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function drawVideoFrame(): void {
  if (!mediaRecorder || mediaRecorder.state !== "recording" || !videoCanvas) return;
  const data = getCurrentSnapshotData();
  if (data) {
    const rendered = renderWebUsbSnapshot(data, {
      format: "png",
      ...getSnapshotDimensions(),
      showStats: snapshotMode > 0,
    });
    if (typeof rendered !== "string") {
      videoCanvas.width = rendered.width;
      videoCanvas.height = rendered.height;
      const context = videoCanvas.getContext("2d");
      context?.drawImage(rendered, 0, 0);
    }
  }
  videoAnimationFrame = requestAnimationFrame(drawVideoFrame);
}

function stopVideoRecording(): void {
  if (videoAnimationFrame !== null) {
    cancelAnimationFrame(videoAnimationFrame);
    videoAnimationFrame = null;
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function startVideoRecording(): void {
  const data = getCurrentSnapshotData();
  if (!data) {
    setSnapshotStatus("Connect and receive a frame before recording video.", true);
    return;
  }
  if (mediaRecorder) {
    stopVideoRecording();
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    setSnapshotStatus("Video recording is unavailable in this browser.", true);
    return;
  }

  try {
    const dimensions = getSnapshotDimensions();
    const firstFrame = renderWebUsbSnapshot(data, {
      format: "png",
      ...dimensions,
      showStats: snapshotMode > 0,
    });
    if (typeof firstFrame === "string") throw new Error("Unable to initialize video canvas.");
    videoCanvas = document.createElement("canvas");
    videoCanvas.width = firstFrame.width;
    videoCanvas.height = firstFrame.height;
    videoCanvas.getContext("2d")?.drawImage(firstFrame, 0, 0);
    if (typeof videoCanvas.captureStream !== "function") {
      throw new Error("Canvas video capture is unavailable in this browser.");
    }
    const stream = videoCanvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    videoChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) videoChunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(videoChunks, { type: mimeType });
      downloadBlob(
        blob,
        getWebUsbSnapshotFilename("png").replace(/\.png$/, ".webm"),
      );
      stream.getTracks().forEach((track) => track.stop());
      mediaRecorder = null;
      videoCanvas = null;
      videoChunks = [];
      snapshotVideoButton.textContent = "Video";
      showSnapshotSuccess(snapshotVideoButton, "Video");
      refreshSnapshotButtons();
      setSnapshotStatus("");
      setStatus(
        session ? "Streaming the latest RTL-SDR frame." : "Disconnected.",
      );
    };
    recorder.start(250);
    mediaRecorder = recorder;
    snapshotVideoButton.textContent = "Stop and save video";
    setSnapshotStatus(
      `Recording WebM video${snapshotMode > 0 ? " with stats" : ""}…`,
    );
    drawVideoFrame();
    refreshSnapshotButtons();
  } catch (error: unknown) {
    setSnapshotStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function renderPlaceholder(state: SpectrumPlaceholderState | null): void {
  if (!state) {
    spectrumPlaceholder.hidden = true;
    return;
  }
  spectrumPlaceholder.hidden = false;
  spectrumPlaceholder.dataset.kind = state.kind;
  placeholderKicker.textContent = state.kicker;
  placeholderTitle.textContent = state.title;
  placeholderSource.textContent = `from ${state.source}`;
  placeholderBody.textContent = state.message;
}

function setError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(message, true);
  renderPlaceholder(getSpectrumPlaceholderState(Boolean(session), error));
  setOptionSyncState("error");
}

function paintLatestFrame(): void {
  animationFrame = null;
  if (latestBins) {
    drawSpectrum(canvas, latestBins, {
      centerFrequencyHz,
      sampleRateHz: session?.getConnection()?.sampleRateHz,
    });
    refreshSnapshotButtons();
  }
}

function queuePaint(): void {
  if (animationFrame === null) {
    animationFrame = requestAnimationFrame(paintLatestFrame);
  }
}

function refreshCenterFrequency(): void {
  const unit = centerFrequencyUnitValue;
  const parsed = parseFrequencyInputValue(
    centerFrequencyInput.value,
    unit,
    0,
    30_000_000_000,
  );
  if (parsed !== null) centerFrequencyHz = parsed;
  rememberActiveNaptChannelCenter();
  setOptionValue("centerFrequency", formatCenterFrequencyValue());
  scheduleDeviceOptions();
}

function formatCenterFrequency(preserveUnit = false): void {
  const unit = preserveUnit
    ? centerFrequencyUnitValue
    : getOptimalFrequencyScale(centerFrequencyHz).unit;
  centerFrequencyUnitValue = unit;
  centerFrequencyUnit.value = unit;
  centerFrequencyInput.value = formatFrequencyInputValue(centerFrequencyHz, unit);
  setOptionValue("centerFrequency", formatCenterFrequencyValue());
}

centerFrequencyInput.addEventListener("input", refreshCenterFrequency);
centerFrequencyInput.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  event.stopPropagation();
  refreshCenterFrequency();
  const direction = event.key === "ArrowUp" ? 1 : -1;
  const multiplier = event.shiftKey ? 10 : 1;
  centerFrequencyHz = clampFrequencyHz(
    centerFrequencyHz +
      direction * getFrequencyArrowStepHz(centerFrequencyUnitValue) * multiplier,
    0,
    30_000_000_000,
  );
  rememberActiveNaptChannelCenter();
  formatCenterFrequency(true);
  dispatchDeviceOptionsImmediately();
  queuePaint();
});
centerFrequencyInput.addEventListener("blur", () => {
  refreshCenterFrequency();
  formatCenterFrequency();
});
centerFrequencyUnit.addEventListener("change", () => {
  const nextUnit = centerFrequencyUnit.value as FrequencyUnit;
  const parsed = parseFrequencyInputValue(
    centerFrequencyInput.value,
    centerFrequencyUnitValue,
    0,
    30_000_000_000,
  );
  if (parsed !== null) centerFrequencyHz = parsed;
  centerFrequencyUnitValue = nextUnit;
  formatCenterFrequency(true);
  scheduleDeviceOptions();
});

function getParsedSampleRateFromInput(): number | null {
  const parsed = parseFrequencyInputValue(
    sampleRateInput.value,
    sampleRateUnitValue,
    1,
    MAX_SAMPLE_RATE_HZ,
  );
  return parsed === null ? null : normalizeSampleRateHz(parsed);
}

function getSampleRateFromInput(): number {
  return getParsedSampleRateFromInput() ?? DEFAULT_SAMPLE_RATE_HZ;
}

function formatSampleRate(): boolean {
  const nextHz = getParsedSampleRateFromInput();
  if (nextHz === null) return false;
  const nextScale = getOptimalFrequencyScale(nextHz);
  sampleRateUnitValue = nextScale.unit;
  sampleRateUnit.value = nextScale.unit;
  sampleRateInput.value = formatFrequencyInputValue(nextHz, nextScale.unit);
  setOptionValue("sampleRate", formatFrequency(nextHz, {
    precisionMHz: 3,
    trimTrailingZeros: true,
  }));
  return true;
}

function getDeviceOptionState(): RtlSdrOptionState | null {
  return getRtlSdrOptionState({
    centerFrequencyText: centerFrequencyInput.value,
    centerFrequencyUnit: centerFrequencyUnitValue,
    sampleRateText: sampleRateInput.value,
    sampleRateUnit: sampleRateUnitValue,
    fftSizeText: fftSizeInput.value,
    gainText: gainInput.value,
    ppmText: ppmInput.value,
  });
}

async function updateDeviceOptions(options: RtlSdrOptionState): Promise<void> {
  if (!session) return;
  const current = session.getConnection();
  if (!haveRtlSdrOptionsChanged(current, options)) {
    setOptionSyncState("sent");
    return;
  }
  setStatus("Applying RTL-SDR options…");
  const connection = await session.updateOptions(options);
  fftSizeInput.value = String(connection.fftSize);
  gainInput.value = String(connection.gainDb);
  ppmInput.value = String(connection.ppm);
  refreshOptionValues(connection);
  iqCaptureRecorder?.updateOptions(getIqCaptureOptions(connection)!);
  setOptionSyncState("sent");
  setStatus("RTL-SDR options updated.");
}

function scheduleDeviceOptions(): void {
  if (!session) return;
  const nextOptions = getDeviceOptionState();
  const current = session.getConnection();
  if (!nextOptions || !haveRtlSdrOptionsChanged(current, nextOptions)) {
    if (optionDebounceTimer !== null) {
      window.clearTimeout(optionDebounceTimer);
      optionDebounceTimer = null;
    }
    setOptionSyncState("sent");
    return;
  }
  setOptionSyncState("pending");
  if (optionDebounceTimer !== null) window.clearTimeout(optionDebounceTimer);
  optionDebounceTimer = window.setTimeout(() => {
    optionDebounceTimer = null;
    enqueueDeviceOptionsUpdate(nextOptions);
  }, 350);
}

function enqueueDeviceOptionsUpdate(options: RtlSdrOptionState): void {
  deviceOptionUpdateQueue = deviceOptionUpdateQueue
    .then(() => updateDeviceOptions(options))
    .catch(setError);
}

function dispatchDeviceOptionsImmediately(): void {
  if (!session) return;
  if (optionDebounceTimer !== null) {
    window.clearTimeout(optionDebounceTimer);
    optionDebounceTimer = null;
  }
  const nextOptions = getDeviceOptionState();
  if (!nextOptions) {
    setOptionSyncState("sent");
    return;
  }
  setOptionSyncState("pending");
  enqueueDeviceOptionsUpdate(nextOptions);
}

sampleRateInput.addEventListener("input", () => {
  const parsed = parseFrequencyInputValue(
    sampleRateInput.value,
    sampleRateUnitValue,
    1,
    MAX_SAMPLE_RATE_HZ,
  );
  if (parsed !== null) {
    if (parsed === MAX_SAMPLE_RATE_HZ) formatSampleRate();
    else setOptionValue("sampleRate", formatFrequency(parsed, {
      precisionMHz: 3,
      trimTrailingZeros: true,
    }));
    scheduleDeviceOptions();
  }
});
sampleRateInput.addEventListener("blur", () => {
  if (formatSampleRate()) scheduleDeviceOptions();
});
sampleRateUnit.addEventListener("change", () => {
  const nextUnit = sampleRateUnit.value as FrequencyUnit;
  const nextHz = getParsedSampleRateFromInput();
  if (nextHz === null) return;
  sampleRateUnitValue = nextUnit;
  sampleRateInput.value = formatFrequencyInputValue(
    nextHz,
    nextUnit,
  );
  setOptionValue("sampleRate", formatFrequency(nextHz, {
    precisionMHz: 3,
    trimTrailingZeros: true,
  }));
  scheduleDeviceOptions();
});

fftSizeInput.addEventListener("change", () => {
  if (fftSizeInput.value.trim() === "") return;
  const value = Number(fftSizeInput.value);
  if (!Number.isFinite(value)) return;
  const normalized = normalizeFftSize(value);
  setOptionValue("fftSize", normalized.toLocaleString());
  scheduleDeviceOptions();
});
gainInput.addEventListener("input", () => {
  if (gainInput.value.trim() === "") return;
  const value = Number(gainInput.value.trim());
  if (!Number.isFinite(value)) return;
  const normalized = normalizeGainDb(value);
  if (value > MAX_GAIN_DB) gainInput.value = String(MAX_GAIN_DB);
  setOptionValue("gain", `${normalized.toFixed(1)} dB`);
  scheduleDeviceOptions();
});
ppmInput.addEventListener("input", () => {
  if (ppmInput.value.trim() === "") return;
  const value = Number(ppmInput.value.trim());
  if (!Number.isFinite(value)) return;
  const normalized = normalizePpm(value);
  setOptionValue("ppm", String(normalized));
  scheduleDeviceOptions();
});

async function disconnect(): Promise<void> {
  stopVideoRecording();
  await finishIqCapture(true);
  const activeSession = session;
  session = null;
  streamPaused = false;
  latestBins = null;
  if (optionDebounceTimer !== null) window.clearTimeout(optionDebounceTimer);
  optionDebounceTimer = null;
  if (activeSession) await activeSession.disconnect();
  deviceElement.textContent = "No device";
  connectButton.textContent = "Connect and stream";
  setStatus("Disconnected.");
  setSnapshotStatus("");
  renderPlaceholder(getSpectrumPlaceholderState(false));
  setOptionSyncState("idle");
  refreshSourceActions();
  refreshStreamToggle();
  refreshSnapshotButtons();
  refreshIqCaptureControls();
}

function toggleStream(): void {
  if (!session) return;
  try {
    if (streamPaused) {
      session.resume();
      streamPaused = false;
      setStatus("Stream resumed.");
    } else {
      session.pause();
      streamPaused = true;
      setStatus("Stream paused; the device remains connected.");
    }
    refreshStreamToggle();
  } catch (error: unknown) {
    setError(error);
  }
}

async function connect(): Promise<void> {
  if (session) {
    await disconnect();
    return;
  }

  connectButton.disabled = true;
  streamPaused = false;
  refreshStreamToggle();
  latestBins = null;
  refreshSnapshotButtons();
  setStatus("Requesting the RTL-SDR and starting its bulk-IN stream…");
  renderPlaceholder(getSpectrumLoadingPlaceholder());
  setOptionSyncState("pending");
  try {
    const activeSession = new RtlSdrWebUsbSession();
    const connection = await activeSession.connect({
      centerFrequencyHz,
      sampleRateHz: normalizeSampleRateHz(
        parseFrequencyInputValue(
          sampleRateInput.value,
          sampleRateUnit.value as FrequencyUnit,
          1,
          MAX_SAMPLE_RATE_HZ,
        ) ?? DEFAULT_SAMPLE_RATE_HZ,
      ),
      fftSize: normalizeFftSize(Number(fftSizeInput.value)),
      gainDb: normalizeGainDb(Number(gainInput.value)),
      ppm: normalizePpm(Number(ppmInput.value)),
    });
    session = activeSession;
    streamPaused = false;
    connectButton.textContent = "Connect and stream";
    connectButton.disabled = false;
    refreshSourceActions();
    refreshStreamToggle();
    deviceElement.textContent = connection.deviceLabel;
    refreshOptionValues(connection);
    refreshIqCaptureControls();
    markConnectedOptionStates();
    setStatus("Streaming the latest RTL-SDR frame.");

    void activeSession
    .start((frame) => {
      latestBins = processRtlSdrFrame(frame);
      const captureOptions = getIqCaptureOptions();
      if (captureOptions) iqCaptureRecorder?.appendFrame(frame, captureOptions);
      renderPlaceholder(null);
      queuePaint();
      })
      .catch(async (error: unknown) => {
      if (session !== activeSession) return;
        await activeSession.disconnect();
        session = null;
        streamPaused = false;
        connectButton.textContent = "Connect and stream";
        connectButton.disabled = false;
        deviceElement.textContent = "No device";
        refreshSourceActions();
        refreshStreamToggle();
        void finishIqCapture(false);
        refreshIqCaptureControls();
        setError(error);
        refreshSnapshotButtons();
      });
  } catch (error: unknown) {
    streamPaused = false;
    refreshSourceActions();
    refreshStreamToggle();
    setError(error);
    connectButton.disabled = false;
  }
}

connectButton.addEventListener("click", () => {
  void connect();
});
mobileLandscapeToggle.addEventListener("click", () => {
  if (!mobileLandscapeQuery.matches) return;
  landscapeControlsOpen = !landscapeControlsOpen;
  refreshMobileLandscapeControls();
});
mobileLandscapeQuery.addEventListener("change", refreshMobileLandscapeControls);
window.addEventListener("resize", refreshMobileLandscapeControls);
streamToggleButton.addEventListener("click", toggleStream);
disconnectSourceButton.addEventListener("click", () => {
  if (window.confirm("Disconnect the RTL-SDR from this page?")) {
    void disconnect();
  }
});
snapshotImageButton.addEventListener("click", () => {
  void saveSnapshot("png");
});
snapshotSvgButton.addEventListener("click", () => {
  void saveSnapshot("svg");
});
snapshotVideoButton.addEventListener("click", startVideoRecording);
snapshotStatsToggle.addEventListener("click", () => {
  const nextMode = ((snapshotMode + 1) % 3) as 0 | 1 | 2;
  if (nextMode !== 2) {
    snapshotGeolocationRequestId += 1;
    snapshotMode = nextMode;
    snapshotGeolocation = null;
    snapshotLocationLabel = null;
    snapshotGeolocationUnavailable = false;
    refreshSnapshotStatsToggle();
    if (mediaRecorder) {
      setSnapshotStatus(
        `Recording WebM video${snapshotMode > 0 ? " with stats" : " without stats"}…`,
      );
    }
    return;
  }

  if (!navigator.geolocation) {
    snapshotGeolocationRequestId += 1;
    snapshotMode = 1;
    snapshotGeolocation = null;
    snapshotLocationLabel = null;
    snapshotGeolocationUnavailable = true;
    refreshSnapshotStatsToggle();
    setSnapshotStatus("");
    return;
  }

  snapshotGeolocationUnavailable = false;
  const requestId = ++snapshotGeolocationRequestId;
  snapshotLocationLabel = null;
  setSnapshotStatus("Requesting geolocation for the next snapshot…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (requestId !== snapshotGeolocationRequestId) return;
      snapshotGeolocation = {
        lat: position.coords.latitude.toFixed(6),
        lon: position.coords.longitude.toFixed(6),
      };
      const { lat, lon } = snapshotGeolocation;
      snapshotGeolocationUnavailable = false;
      snapshotMode = 2;
      refreshSnapshotStatsToggle();
      setSnapshotStatus(
        `Stats and geolocation enabled${mediaRecorder ? " for the recording" : " for the next snapshot"}.`,
      );
      void reverseGeocodeSnapshotLocation(lat, lon)
        .then((label) => {
          if (requestId === snapshotGeolocationRequestId) {
            snapshotLocationLabel = label;
          }
        })
        .catch(() => {
          if (requestId === snapshotGeolocationRequestId) {
            snapshotLocationLabel = null;
          }
        });
    },
    () => {
      if (requestId !== snapshotGeolocationRequestId) return;
      snapshotMode = 1;
      snapshotGeolocation = null;
      snapshotLocationLabel = null;
      snapshotGeolocationUnavailable = true;
      refreshSnapshotStatsToggle();
      setSnapshotStatus("");
    },
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 5_000 },
  );
});
iqCaptureToggle.addEventListener("click", () => {
  void toggleIqCapture();
});
iqCaptureFormat.addEventListener("change", refreshIqCaptureControls);
window.addEventListener("pagehide", () => {
  void session?.disconnect();
  stopVideoRecording();
  iqCaptureRecorder?.abort();
  iqCaptureRecorder?.dispose();
});

setStatus(
  "Ready. Use a Chromium browser over HTTPS or localhost, then connect an RTL-SDR.",
);
renderPlaceholder(getSpectrumPlaceholderState(false));
refreshMobileLandscapeControls();
refreshOptionValues();
setSnapshotStatus("");
refreshSnapshotStatsToggle();
refreshSourceActions();
refreshStreamToggle();
refreshSnapshotButtons();
refreshNaptChannelButtons();
initializeIqCapture();
showMobileFirstVisitNotice();
