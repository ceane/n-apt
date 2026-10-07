import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { validateModel, type FrameMetadata, type NativeModel } from './core';
import type { FeatureSummary } from './core';
import type { NativeTrainingCaptureAnnotations, NativeTrainingFrameTimestampDiagnostic } from './trainingCapture';
import { suggestNativeObservedChannel } from './observedChannel';
import { ClassifierWorkflowFlow } from './ClassifierWorkflowFlow';
import type { SpectrumFrame } from '@n-apt/consts/schemas/websocket';
import { useGeolocation } from '@n-apt/maps/public/useGeolocation';

const recordingPulse = keyframes`
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(220, 38, 38, .42); }
  50% { opacity: .58; box-shadow: 0 0 0 5px rgba(220, 38, 38, 0); }
`;

const StateIndicator = styled.span<{ $recording: boolean; $ready: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: ${({ $recording, $ready }) => $recording ? 'var(--color-danger, #dc2626)' : $ready ? 'var(--color-success, #168a45)' : 'var(--text-secondary, #777)'};
  font-weight: 700;
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: currentColor;
    ${({ $recording }) => $recording && css`animation: ${recordingPulse} 1.25s ease-in-out infinite;`}
  }
  @media (prefers-reduced-motion: reduce) { &::before { animation: none; } }
`;

export interface NativeShadowResult {
  summary: FeatureSummary;
  frameMetadata: Pick<FrameMetadata, 'sourceId' | 'centerFrequencyHz' | 'analysisSampleRateHz' | 'fftSize' | 'retainedStartBin' | 'retainedEndBin' | 'timestampMs'>;
  score: number | null;
  modelId: string | null;
  sampleRateValidated: boolean;
  latencyMs: number;
  ruleScore: number | null;
}
export type NativeShadowResultState = 'current' | 'stale' | 'metadata-mismatch';
export interface LegacyDecision { isNapt: boolean; confidence: number }
export interface NativeTrainingCaptureDownloadLinks {
  jobId?: string;
  packageHref: string;
  packageFileName: string;
}
const FEATURE_TOGGLES = [
  ['bridge', 'Bridge'], ['u-dip', 'U-dip'],
  ['coherent-continuation', 'Coherent continuation across visible band'],
  ['truncated-at-band-edge', 'Truncated by visible band edge'],
  ['pulsing', 'Pulsing / amplitude cycling'],
  ['regular-spike-spacing', 'Regular spike spacing'],
  ['above-floor-spikes', 'Spikes above local floor'],
] as const;
const ANNOTATION_DRAFT_KEY = 'napt.native-classifier.annotation-draft.v1';
const ANNOTATION_CHANNEL_MODE_KEY = 'napt.native-classifier.annotation-channel-mode.v1';
const EMPTY_ANNOTATIONS: NativeTrainingCaptureAnnotations = { label: 'uncertain', channel: 'unspecified', features: [], tags: [] };

type AnnotationChannelMode = 'auto' | 'manual';

function readAnnotationChannelMode(annotations: NativeTrainingCaptureAnnotations): AnnotationChannelMode {
  try {
    const mode = window.sessionStorage.getItem(ANNOTATION_CHANNEL_MODE_KEY);
    if (mode === 'auto' || mode === 'manual') return mode;
  } catch { /* Continue with a conservative mode when storage is unavailable. */ }
  return annotations.channel === 'unspecified' ? 'auto' : 'manual';
}

function describeChannel(channel: NativeTrainingCaptureAnnotations['channel'] | null): string {
  if (channel === 'A' || channel === 'B') return `Channel ${channel}`;
  if (channel === 'other') return 'Other / uncertain';
  return 'Unspecified';
}

function readAnnotationDraft(): NativeTrainingCaptureAnnotations {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(ANNOTATION_DRAFT_KEY) ?? 'null');
    if (value && ['matching', 'nonmatching', 'uncertain'].includes(value.label) && ['unspecified', 'A', 'B', 'other'].includes(value.channel) &&
      Array.isArray(value.features) && value.features.every((item: unknown) => typeof item === 'string') &&
      Array.isArray(value.tags) && value.tags.every((item: unknown) => typeof item === 'string')) return value;
  } catch { /* Start with an empty draft when storage is unavailable or invalid. */ }
  return { ...EMPTY_ANNOTATIONS };
}

export function NativeClassifierPanel({ result, resultState = 'current', legacy, onModel, captureAvailable = false, captureActive = false, captureFrameCount = 0, captureStatus = '', captureTimestampDiagnostic = null, captureDownloads = null, captureDownloadsPersisted = false, onToggleCapture, onExportCapture, onClearCapture, onAnnotationsChange, sessionToken, canonicalChannels, activeStreamId }: { result: NativeShadowResult | null; resultState?: NativeShadowResultState; legacy?: LegacyDecision | null; onModel: (model: NativeModel | null) => void; captureAvailable?: boolean; captureActive?: boolean; captureFrameCount?: number; captureStatus?: string; captureTimestampDiagnostic?: NativeTrainingFrameTimestampDiagnostic | null; captureDownloads?: NativeTrainingCaptureDownloadLinks | null; captureDownloadsPersisted?: boolean; onToggleCapture?: (annotations: NativeTrainingCaptureAnnotations) => void; onExportCapture?: () => void; onClearCapture?: () => void; onAnnotationsChange?: (annotations: NativeTrainingCaptureAnnotations) => void; sessionToken?: string | null; canonicalChannels?: readonly SpectrumFrame[]; activeStreamId?: string | null }) {
  const input = useRef<HTMLInputElement>(null); const [message, setMessage] = useState('Shadow scoring waits for a live acquisition frame.');
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<NativeTrainingCaptureAnnotations>(readAnnotationDraft);
  const [captureGeolocationEnabled, setCaptureGeolocationEnabled] = useState(true);
  const [captureStartPending, setCaptureStartPending] = useState(false);
  const [captureGeolocationStatus, setCaptureGeolocationStatus] = useState('');
  const { getLocation, error: geolocationError } = useGeolocation();
  const [channelMode, setChannelMode] = useState<AnnotationChannelMode>(() => readAnnotationChannelMode(annotations));
  const lastAutoAppliedChannel = useRef<NativeTrainingCaptureAnnotations['channel'] | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [classificationSplit, setClassificationSplit] = useState<'train' | 'validation' | 'test'>('train');
  const [saveToDataset, setSaveToDataset] = useState(false);
  const [datasetSaveStatus, setDatasetSaveStatus] = useState('');
  const updateAnnotations = (next: NativeTrainingCaptureAnnotations) => { setAnnotations(next); onAnnotationsChange?.(next); };
  const observedChannelSuggestion = result && resultState === 'current' && result.frameMetadata.sourceId && result.frameMetadata.sourceId === activeStreamId
    ? suggestNativeObservedChannel(result.frameMetadata.centerFrequencyHz, canonicalChannels)
    : null;
  useEffect(() => {
    try {
      window.sessionStorage.setItem(ANNOTATION_DRAFT_KEY, JSON.stringify({ ...annotations, geolocation: undefined }));
      window.sessionStorage.setItem(ANNOTATION_CHANNEL_MODE_KEY, channelMode);
    } catch { /* The capture still exports even when storage is unavailable. */ }
  }, [annotations, channelMode]);
  useEffect(() => {
    if (channelMode !== 'auto' || observedChannelSuggestion === null) {
      lastAutoAppliedChannel.current = null;
      return;
    }
    if (annotations.channel === observedChannelSuggestion) {
      lastAutoAppliedChannel.current = observedChannelSuggestion;
      return;
    }
    if (lastAutoAppliedChannel.current === observedChannelSuggestion) return;
    lastAutoAppliedChannel.current = observedChannelSuggestion;
    const next = { ...annotations, channel: observedChannelSuggestion };
    setAnnotations(next);
    onAnnotationsChange?.(next);
  }, [annotations, channelMode, observedChannelSuggestion, onAnnotationsChange]);
  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (tag && !annotations.tags.includes(tag)) updateAnnotations({ ...annotations, tags: [...annotations.tags, tag] });
    setTagDraft('');
  };
  const load = async (file?: File) => {
    if (!file) return;
    try { const model=validateModel(JSON.parse(await file.text())); onModel(model); setLoadedModelId(model.id); setMessage(`Loaded ${model.kind} model ${model.id}.`); }
    catch (error) { onModel(null); setLoadedModelId(null); setMessage(`Model unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const saveClassifierCaptureToDataset = async () => {
    if (!captureDownloads?.jobId || !sessionToken) {
      setDatasetSaveStatus('Sign in to save this capture to the dataset.');
      return;
    }
    setDatasetSaveStatus('Saving encrypted capture…');
    const query = new URLSearchParams({
      token: sessionToken,
      jobId: captureDownloads.jobId,
      section: 'classification',
      split: classificationSplit,
    });
    try {
      const response = await fetch(`/api/capture/save/huggingface?${query.toString()}`, { method: 'POST' });
      const body = await response.json().catch(() => ({})) as { error?: string; files?: string[] };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setDatasetSaveStatus(`Saved with increased protection: ${body.files?.join(', ') || 'capture package'}`);
    } catch (error) {
      setDatasetSaveStatus(`Dataset save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const card: CSSProperties = {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 9,
    width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
    padding: 10, border: '1px solid var(--color-border, rgba(128,128,128,.35))',
    borderRadius: 8, background: 'var(--color-surface, transparent)',
    color: 'var(--text-secondary, #aaa)', fontFamily: 'monospace', fontSize: 11,
    overflow: 'hidden',
  };
  const row: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 7, minWidth: 0 };
  const button: CSSProperties = { font: 'inherit', width: '100%', minWidth: 0, minHeight: 34, whiteSpace: 'normal', overflowWrap: 'anywhere' };
  const wrappingText: CSSProperties = { minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.45 };
  const diagnostics = result
    ? resultState === 'current'
      ? `${result.summary.status}; ${result.frameMetadata.fftSize} FFT; ${result.summary.resolution.binHz.toFixed(2)} Hz/bin; ${result.summary.resolution.resolutionHz.toFixed(2)} Hz effective resolution; retained bins ${result.frameMetadata.retainedStartBin}–${result.frameMetadata.retainedEndBin} (${(100 * (result.frameMetadata.retainedEndBin - result.frameMetadata.retainedStartBin) / result.frameMetadata.fftSize).toFixed(1)}% visible); frame ${result.frameMetadata.timestampMs} ms; ${result.summary.status === 'insufficient_evidence' ? 'score withheld' : result.modelId ? `model ${result.score?.toFixed(3)}${result.sampleRateValidated ? '' : ' (sample rate unvalidated)'}` : `rule ${result.ruleScore?.toFixed(3) ?? 'unavailable'}`}; ${result.latencyMs.toFixed(1)} ms`
      : `${resultState === 'stale' ? 'stale shadow frame' : 'shadow frame metadata does not match current acquisition'}; last ${result.frameMetadata.fftSize} FFT at ${result.summary.resolution.binHz.toFixed(2)} Hz/bin; last retained bins ${result.frameMetadata.retainedStartBin}–${result.frameMetadata.retainedEndBin}; frame ${result.frameMetadata.timestampMs} ms; score withheld; previous extraction ${result.latencyMs.toFixed(1)} ms`
    : message;
  const state = captureActive ? 'recording' : captureAvailable ? 'ready' : 'waiting';
  const tuneStatus = captureStatus.match(/^center-frequency-changed(?::([0-9.]+):([0-9.]+))?$/);
  const metadataStatus = captureStatus.match(/^options-applied:([^:]+):rev-(\d+)-to-(\d+):([^:]+):([^:]+)$/);
  const captureStatusText = tuneStatus
    ? `Capture stopped on tune: ${tuneStatus[1] && tuneStatus[2] ? `${(Number(tuneStatus[1]) / 1e6).toFixed(3)} → ${(Number(tuneStatus[2]) / 1e6).toFixed(3)} MHz` : 'new center frequency saved'}.`
    : metadataStatus ? `Capture stopped at the OptionsApplied boundary (revision ${metadataStatus[2]} → ${metadataStatus[3]}, frame ${metadataStatus[4]} → ${metadataStatus[5]}; ${metadataStatus[1]} changed).`
    : captureStatus === 'rtl-sdr-disconnected' ? 'The RTL-SDR is disconnected. Please reconnect it; capture will be ready when receiving resumes.'
    : captureStatus === 'rtl-sdr-stale' ? 'The RTL-SDR has stopped sending fresh frames. Please check its connection and reconnect it; capture will be ready when fresh receiving resumes.'
    : captureStatus === 'rtl-sdr-paused' ? 'RTL-SDR capture is paused. Resume live receiving before starting a capture.'
    : captureStatus === 'rtl-sdr-not-receiving' ? 'The RTL-SDR is not receiving live frames. Switch it to RX/Receiving before capturing.'
    : captureStatus === 'source-or-config-changed' ? 'Capture stopped because the source or acquisition settings changed.'
      : captureStatus === 'non-increasing-frame-timestamp' ? 'Capture stopped because I/Q frame timestamps did not advance. Wait for a fresh, ordered stream before recording again.'
        : captureStatus === 'frame-timestamp-stale' ? 'Capture stopped because an I/Q frame arrived too late to prove continuity. Please check the RTL-SDR connection and reconnect it if the receiver dropped.'
          : captureStatus === 'frame-timestamp-future' ? 'Capture stopped because an I/Q frame timestamp is ahead of the browser clock. Check time alignment before recording again.'
            : captureStatus === 'no-new-frames' || captureStatus === 'stale-frame' || captureStatus === 'stale-or-out-of-order-frame' ? 'Capture stopped because fresh I/Q frames stopped arriving. Please check the RTL-SDR connection and reconnect it if the receiver dropped; recording will be ready when fresh receiving resumes.' : captureStatus;
  const captureNeedsExport = !captureActive && captureFrameCount > 0;
  const captureDownloadsLocked = captureDownloadsPersisted || !!captureDownloads;
  const channelSuggestionDescription = observedChannelSuggestion === null
    ? 'unavailable'
    : describeChannel(observedChannelSuggestion);
  const currentChannelDescription = channelMode === 'auto' && observedChannelSuggestion === null
    ? 'Unspecified'
    : describeChannel(annotations.channel);
  const channelMatchDescription = channelMode === 'auto'
    ? `Automatic channel suggestion: ${channelSuggestionDescription}. Current annotation: ${currentChannelDescription}.`
    : `Manual channel label: ${describeChannel(annotations.channel)}. Automatic channel suggestion: ${channelSuggestionDescription}.`;
  const annotationsForCapture = channelMode === 'auto'
    ? { ...annotations, channel: observedChannelSuggestion ?? 'unspecified' }
    : annotations;
  const handleTrainingCaptureToggle = async () => {
    if (captureActive) {
      onToggleCapture?.(annotationsForCapture);
      return;
    }
    const withoutLocation: NativeTrainingCaptureAnnotations = {
      label: annotationsForCapture.label,
      channel: annotationsForCapture.channel,
      features: annotationsForCapture.features,
      tags: annotationsForCapture.tags,
    };
    if (!captureGeolocationEnabled) {
      onToggleCapture?.(withoutLocation);
      return;
    }
    setCaptureStartPending(true);
    setCaptureGeolocationStatus('Requesting location permission…');
    try {
      const geolocation = await getLocation();
      if (geolocation) {
        const withLocation = { ...withoutLocation, geolocation };
        updateAnnotations(withLocation);
        setCaptureGeolocationStatus('Location attached to this capture with accuracy and timestamp.');
        onToggleCapture?.(withLocation);
      } else {
        setCaptureGeolocationStatus(`${geolocationError || 'Location unavailable or permission declined.'} Capture will continue without location.`);
        onToggleCapture?.(withoutLocation);
      }
    } finally {
      setCaptureStartPending(false);
    }
  };
  return <section aria-label="Experimental native resolution classifier" data-layout="sidebar" style={card}>
    <div style={{ ...row, gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'center' }}>
      <StateIndicator data-testid="classifier-state" data-state={state} $recording={captureActive} $ready={captureAvailable || captureActive}>{captureActive ? 'RECORDING' : captureAvailable ? 'READY' : 'WAITING'}</StateIndicator>
    </div>
    <label data-testid="classifier-geolocation-control" style={{ ...row, gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center' }}>
      <input type="checkbox" aria-label="Include geolocation in classifier training captures" checked={captureGeolocationEnabled} disabled={captureActive || captureStartPending} onChange={(event) => { setCaptureGeolocationEnabled(event.currentTarget.checked); setCaptureGeolocationStatus(event.currentTarget.checked ? 'Location will be requested when the next capture starts.' : 'Location is off for this session.'); }} />
      <span>Include geolocation (on by default)</span>
    </label>
    <div aria-live="polite" data-testid="classifier-geolocation-status" style={{ ...wrappingText, minHeight: '1.2em' }}>{captureGeolocationStatus || 'Location is requested when a training capture starts; capture can continue without it.'}</div>
    <div style={row}>
      <button type="button" disabled={captureStartPending || (!captureActive && (!captureAvailable || captureNeedsExport || captureDownloadsLocked))} onClick={() => void handleTrainingCaptureToggle()} style={button}>{captureActive ? 'Stop recording' : captureDownloadsPersisted && !captureDownloads ? 'Sign in to retrieve saved capture' : captureDownloads ? 'Clear capture to continue' : captureNeedsExport ? 'Export before next capture' : 'Start training capture'}</button>
      <button type="button" disabled={captureFrameCount === 0 || captureDownloadsLocked} onClick={onExportCapture} style={button}>Export V6 I/Q + labels</button>
    </div>
    <div data-testid="classifier-capture-status" aria-live="polite" style={{ ...wrappingText, minHeight: '2.9em' }}>{captureStatusText || (captureDownloadsPersisted && !captureDownloads ? 'Saved capture awaits an authenticated session so its backend links can be restored.' : captureActive ? `Recording ${captureFrameCount} I/Q frames` : captureAvailable ? 'Ready. Labels and model fitting stay offline.' : 'Requires a fresh live RTL-SDR frame in Lossless mode.')}</div>
    {captureTimestampDiagnostic && <div data-testid="classifier-capture-timestamp-diagnostic" style={wrappingText}>
      Frame {captureTimestampDiagnostic.incomingSequence} at {captureTimestampDiagnostic.incomingTimestampMs} ms followed frame {captureTimestampDiagnostic.previousSequence} at {captureTimestampDiagnostic.previousTimestampMs} ms.
    </div>}
    {captureDownloads && <div aria-label="Exported capture package" style={{ ...row, ...wrappingText }}>
      <a href={captureDownloads.packageHref} download={captureDownloads.packageFileName} style={{ ...button, gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', textAlign: 'center', color: 'inherit' }}>Download capture package</a>
      <div style={{ gridColumn: '1 / -1' }}>One ZIP with datapackage.json, the V6 I/Q capture, and detached labels.</div>
      <label style={{ ...row, gridColumn: '1 / -1', alignItems: 'center' }}>
        <input type="checkbox" checked={saveToDataset} onChange={(event) => { setSaveToDataset(event.target.checked); setDatasetSaveStatus(''); }} />
        Save classification capture to Hugging Face
      </label>
      {saveToDataset && <>
        <label style={{ ...row, gridColumn: '1 / -1', alignItems: 'center' }}>
          Split
          <select value={classificationSplit} onChange={(event) => setClassificationSplit(event.target.value as typeof classificationSplit)}>
            <option value="train">Train</option><option value="validation">Validation</option><option value="test">Test</option>
          </select>
        </label>
        <label style={{ ...row, gridColumn: '1 / -1', alignItems: 'center' }}>
          <input type="checkbox" checked disabled readOnly />
          Increased protection (required for online storage)
        </label>
        <button type="button" style={{ ...button, gridColumn: '1 / -1' }} onClick={() => void saveClassifierCaptureToDataset()}>
          Save encrypted to Hugging Face
        </button>
        <div aria-live="polite" style={{ ...wrappingText, gridColumn: '1 / -1' }}>{datasetSaveStatus}</div>
      </>}
      <button type="button" onClick={onClearCapture} style={{ ...button, gridColumn: '1 / -1' }}>Clear exported capture</button>
    </div>}
    <div data-testid="classifier-labeling" style={{ ...wrappingText, borderTop: '1px solid var(--color-border, rgba(128,128,128,.25))', paddingTop: 8 }}>
      <strong>{captureActive ? 'During capture · edits are timestamped' : captureFrameCount > 0 ? 'Review capture labels' : 'Before capture · label what you expect'}</strong>
      <label style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, marginTop: 6 }}>
        <span>Signal label</span>
        <select aria-label="Signal label" aria-describedby="classifier-label-guidance" value={annotations.label} onChange={(event) => updateAnnotations({ ...annotations, label: event.currentTarget.value as NativeTrainingCaptureAnnotations['label'] })} style={{ ...button, background: 'var(--color-surface, transparent)', color: 'inherit' }}>
          <option value="uncertain">Uncertain</option><option value="matching">Matching morphology</option><option value="nonmatching">Non-matching</option>
        </select>
      </label>
      <div id="classifier-label-guidance" data-testid="classifier-label-guidance" style={{ marginTop: 4, opacity: .85 }}>
        Matching means the known N-APT target is present, including when interference affects the display. Interference is a condition, not a negative label. Known app mocks and sinc signals are non-matching examples; use Uncertain only when the capture source or label provenance is unknown.
      </div>
      <label style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, marginTop: 7 }}>
        <span>Observed N-APT channel</span>
        <select aria-label="N-APT channel" value={channelMode === 'auto' ? 'auto' : annotations.channel} onChange={(event) => {
          if (event.currentTarget.value === 'auto') {
            setChannelMode('auto');
            return;
          }
          setChannelMode('manual');
          lastAutoAppliedChannel.current = null;
          updateAnnotations({ ...annotations, channel: event.currentTarget.value as NativeTrainingCaptureAnnotations['channel'] });
        }} style={{ ...button, background: 'var(--color-surface, transparent)', color: 'inherit' }}>
          <option value="auto">Auto match · {observedChannelSuggestion === null ? 'waiting for current source' : channelSuggestionDescription}</option>
          <option value="unspecified">Unspecified</option><option value="A">Channel A</option><option value="B">Channel B</option><option value="other">Other / uncertain</option>
        </select>
      </label>
      <div role="status" aria-label="Channel match status" aria-live="polite" data-testid="classifier-channel-match" style={{ marginTop: 4 }}>{channelMatchDescription}</div>
      <div style={{ marginTop: 7 }}>Morphology present</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 3 }}>
        {FEATURE_TOGGLES.map(([value, label]) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflowWrap: 'anywhere' }}>
          <input type="checkbox" checked={annotations.features.includes(value)} onChange={(event) => updateAnnotations({ ...annotations, features: event.currentTarget.checked ? [...annotations.features, value] : annotations.features.filter((feature) => feature !== value) })} />{label}
        </label>)}
      </div>
      <label style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, marginTop: 7 }}>
        <span>Conditions and notes · Enter adds a tag</span>
        <input aria-label="Add condition tag" value={tagDraft} onChange={(event) => setTagDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(tagDraft); } }} style={{ ...button, boxSizing: 'border-box' }} placeholder="e.g. interference, weak signal" />
      </label>
      {annotations.tags.length > 0 && <div aria-label="Condition tags" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
        {annotations.tags.map((tag) => <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--color-border, rgba(128,128,128,.35))', borderRadius: 12, padding: '2px 6px', maxWidth: '100%', overflowWrap: 'anywhere' }}>
          {tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => updateAnnotations({ ...annotations, tags: annotations.tags.filter((item) => item !== tag) })} style={{ ...button, width: 20, minHeight: 20, border: 0, padding: 0 }}>×</button>
        </span>)}
      </div>}
    </div>
    <div style={{ borderTop: '1px solid var(--color-border, rgba(128,128,128,.25))', paddingTop: 8, ...wrappingText }}>
      <strong>Shadow diagnostics</strong>
      {legacy && <div style={wrappingText}>Displayed classifier: {legacy.isNapt ? 'match' : 'no match'} ({legacy.confidence.toFixed(3)})</div>}
      <div role="status" data-testid="classifier-shadow-status" style={wrappingText}>{diagnostics}</div>
    </div>
    <div style={row}>
      <button type="button" onClick={() => input.current?.click()} style={button}>Load model</button>
      <button type="button" onClick={() => { onModel(null); setLoadedModelId(null); setMessage('No learned model loaded.'); }} style={button}>Clear model</button>
    </div>
    <span style={{ ...wrappingText, opacity: .8 }}>Local browser weights; training labels remain in the offline dataset.</span>
    <ClassifierWorkflowFlow
      selectedSourceHasFrames={result !== null}
      captureActive={captureActive}
      hasCapturedFrames={captureFrameCount > 0}
      loadedModelId={loadedModelId ?? result?.modelId ?? null}
      resultAvailable={result !== null}
    />
    <input ref={input} type="file" accept="application/json,.json" aria-label="Load local classifier model" hidden onChange={e => { void load(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
  </section>;
}
