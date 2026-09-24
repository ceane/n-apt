import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { validateModel, type FrameMetadata, type NativeModel } from './core';
import type { FeatureSummary } from './core';
import type { NativeTrainingCaptureAnnotations } from './trainingCapture';

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
  frameMetadata: Pick<FrameMetadata, 'fftSize' | 'retainedStartBin' | 'retainedEndBin' | 'timestampMs'>;
  score: number | null;
  modelId: string | null;
  sampleRateValidated: boolean;
  latencyMs: number;
  ruleScore: number;
}
export interface LegacyDecision { isNapt: boolean; confidence: number }
const FEATURE_TOGGLES = [
  ['bridge', 'Bridge'], ['u-dip', 'U-dip'],
  ['coherent-continuation', 'Coherent continuation across visible band'],
  ['truncated-at-band-edge', 'Truncated by visible band edge'],
  ['pulsing', 'Pulsing / amplitude cycling'],
  ['regular-spike-spacing', 'Regular spike spacing'],
  ['above-floor-spikes', 'Spikes above local floor'],
] as const;
const ANNOTATION_DRAFT_KEY = 'napt.native-classifier.annotation-draft.v1';
const EMPTY_ANNOTATIONS: NativeTrainingCaptureAnnotations = { label: 'uncertain', channel: 'unspecified', features: [], tags: [] };

function readAnnotationDraft(): NativeTrainingCaptureAnnotations {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(ANNOTATION_DRAFT_KEY) ?? 'null');
    if (value && ['matching', 'nonmatching', 'uncertain'].includes(value.label) && ['unspecified', 'A', 'B', 'other'].includes(value.channel) &&
      Array.isArray(value.features) && value.features.every((item: unknown) => typeof item === 'string') &&
      Array.isArray(value.tags) && value.tags.every((item: unknown) => typeof item === 'string')) return value;
  } catch { /* Start with an empty draft when storage is unavailable or invalid. */ }
  return { ...EMPTY_ANNOTATIONS };
}

export function NativeClassifierPanel({ result, legacy, onModel, captureAvailable = false, captureActive = false, captureFrameCount = 0, captureStatus = '', onToggleCapture, onExportCapture, onAnnotationsChange }: { result: NativeShadowResult | null; legacy?: LegacyDecision | null; onModel: (model: NativeModel | null) => void; captureAvailable?: boolean; captureActive?: boolean; captureFrameCount?: number; captureStatus?: string; onToggleCapture?: (annotations: NativeTrainingCaptureAnnotations) => void; onExportCapture?: () => void; onAnnotationsChange?: (annotations: NativeTrainingCaptureAnnotations) => void }) {
  const input = useRef<HTMLInputElement>(null); const [message, setMessage] = useState('Shadow scoring waits for a live acquisition frame.');
  const [annotations, setAnnotations] = useState<NativeTrainingCaptureAnnotations>(readAnnotationDraft);
  const [tagDraft, setTagDraft] = useState('');
  const updateAnnotations = (next: NativeTrainingCaptureAnnotations) => { setAnnotations(next); onAnnotationsChange?.(next); };
  useEffect(() => { try { window.sessionStorage.setItem(ANNOTATION_DRAFT_KEY, JSON.stringify(annotations)); } catch { /* The capture still exports even when storage is unavailable. */ } }, [annotations]);
  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (tag && !annotations.tags.includes(tag)) updateAnnotations({ ...annotations, tags: [...annotations.tags, tag] });
    setTagDraft('');
  };
  const load = async (file?: File) => {
    if (!file) return;
    try { const model=validateModel(JSON.parse(await file.text())); onModel(model); setMessage(`Loaded ${model.kind} model ${model.id}.`); }
    catch (error) { onModel(null); setMessage(`Model unavailable: ${error instanceof Error ? error.message : String(error)}`); }
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
    ? `${result.summary.status}; ${result.frameMetadata.fftSize} FFT; ${result.summary.resolution.binHz.toFixed(2)} Hz/bin; ${result.summary.resolution.resolutionHz.toFixed(2)} Hz effective resolution; retained bins ${result.frameMetadata.retainedStartBin}–${result.frameMetadata.retainedEndBin} (${(100 * (result.frameMetadata.retainedEndBin - result.frameMetadata.retainedStartBin) / result.frameMetadata.fftSize).toFixed(1)}% visible); frame ${result.frameMetadata.timestampMs} ms; ${result.modelId ? `model ${result.score?.toFixed(3)}${result.sampleRateValidated ? '' : ' (sample rate unvalidated)'}` : `rule ${result.ruleScore.toFixed(3)}`}; ${result.latencyMs.toFixed(1)} ms`
    : message;
  const state = captureActive ? 'recording' : captureAvailable ? 'ready' : 'waiting';
  const tuneStatus = captureStatus.match(/^center-frequency-changed(?::([0-9.]+):([0-9.]+))?$/);
  const metadataStatus = captureStatus.match(/^options-applied:([^:]+):rev-(\d+)-to-(\d+):([^:]+):([^:]+)$/);
  const captureStatusText = tuneStatus
    ? `Capture stopped on tune: ${tuneStatus[1] && tuneStatus[2] ? `${(Number(tuneStatus[1]) / 1e6).toFixed(3)} → ${(Number(tuneStatus[2]) / 1e6).toFixed(3)} MHz` : 'new center frequency saved'}.`
    : metadataStatus ? `Capture stopped at the OptionsApplied boundary (revision ${metadataStatus[2]} → ${metadataStatus[3]}, frame ${metadataStatus[4]} → ${metadataStatus[5]}; ${metadataStatus[1]} changed).`
    : captureStatus === 'source-or-config-changed' ? 'Capture stopped because the source or acquisition settings changed.'
      : captureStatus === 'no-new-frames' ? 'Capture stopped because live frames became stale.' : captureStatus;
  const captureNeedsExport = !captureActive && captureFrameCount > 0;
  return <section aria-label="Experimental native resolution classifier" data-layout="sidebar" style={card}>
    <div style={{ ...row, gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'center' }}>
      <StateIndicator data-testid="classifier-state" data-state={state} $recording={captureActive} $ready={captureAvailable || captureActive}>{captureActive ? 'RECORDING' : captureAvailable ? 'READY' : 'WAITING'}</StateIndicator>
    </div>
    <div style={row}>
      <button type="button" disabled={!captureActive && (!captureAvailable || captureNeedsExport)} onClick={() => onToggleCapture?.(annotations)} style={button}>{captureActive ? 'Stop recording' : captureNeedsExport ? 'Export before next capture' : 'Start training capture'}</button>
      <button type="button" disabled={captureFrameCount === 0} onClick={onExportCapture} style={button}>Export I/Q frames</button>
    </div>
    <div data-testid="classifier-capture-status" aria-live="polite" style={{ ...wrappingText, minHeight: '2.9em' }}>{captureStatusText || (captureActive ? `Recording ${captureFrameCount} I/Q frames` : captureAvailable ? 'Ready. Labels and model fitting stay offline.' : 'Requires a fresh live RTL-SDR frame in Lossless mode.')}</div>
    <div data-testid="classifier-labeling" style={{ ...wrappingText, borderTop: '1px solid var(--color-border, rgba(128,128,128,.25))', paddingTop: 8 }}>
      <strong>{captureActive ? 'During capture · edits are timestamped' : captureFrameCount > 0 ? 'Review capture labels' : 'Before capture · label what you expect'}</strong>
      <label style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, marginTop: 6 }}>
        <span>Signal label</span>
        <select aria-label="Signal label" value={annotations.label} onChange={(event) => updateAnnotations({ ...annotations, label: event.currentTarget.value as NativeTrainingCaptureAnnotations['label'] })} style={{ ...button, background: 'var(--color-surface, transparent)', color: 'inherit' }}>
          <option value="uncertain">Uncertain</option><option value="matching">Matching morphology</option><option value="nonmatching">Non-matching</option>
        </select>
      </label>
      <label style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, marginTop: 7 }}>
        <span>Observed N-APT channel</span>
        <select aria-label="N-APT channel" value={annotations.channel} onChange={(event) => updateAnnotations({ ...annotations, channel: event.currentTarget.value as NativeTrainingCaptureAnnotations['channel'] })} style={{ ...button, background: 'var(--color-surface, transparent)', color: 'inherit' }}>
          <option value="unspecified">Unspecified</option><option value="A">Channel A</option><option value="B">Channel B</option><option value="other">Other / uncertain</option>
        </select>
      </label>
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
      <div role="status" style={wrappingText}>{diagnostics}</div>
    </div>
    <div style={row}>
      <button type="button" onClick={() => input.current?.click()} style={button}>Load model</button>
      <button type="button" onClick={() => { onModel(null); setMessage('No learned model loaded.'); }} style={button}>Clear model</button>
    </div>
    <span style={{ ...wrappingText, opacity: .8 }}>Local browser weights; training labels remain in the offline dataset.</span>
    <div data-testid="classifier-pipeline-flow" aria-label="Classifier pipeline" style={{ ...wrappingText, borderTop: '1px solid var(--color-border, rgba(128,128,128,.25))', paddingTop: 8 }}>
      <strong>Pipeline</strong>
      <div style={wrappingText}>Start capture → Stop/export → Label &amp; prepare → Extract → Train/evaluate → Load model</div>
    </div>
    <input ref={input} type="file" accept="application/json,.json" aria-label="Load local classifier model" hidden onChange={e => { void load(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
  </section>;
}
