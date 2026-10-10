import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import * as NativeClassifier from '@n-apt/classification';
import type { SpectrumFrame } from '@n-apt/consts/schemas/websocket';

type ClassifierPanelWithChannelsProps = Parameters<typeof NativeClassifier.NativeClassifierPanel>[0];

function renderClassifierPanelWithChannels(props: ClassifierPanelWithChannelsProps) {
  const panel = NativeClassifier.NativeClassifierPanel as unknown as ComponentType<ClassifierPanelWithChannelsProps>;
  return render(createElement(panel, props));
}

function channelMatchResult(centerFrequencyHz: number, retainedStartBin = 512, retainedEndBin = 3584): NativeClassifier.NativeShadowResult {
  const fftSize = 4096;
  return {
    summary: {
      status: 'ready',
      values: [],
      available: { narrow: true, bridge: true, envelope: true },
      resolution: { binHz: 781.25, resolutionHz: 1171.88, firstBinHz: 18_000, cropped: retainedStartBin !== 0 || retainedEndBin !== fftSize, incomplete: false, visibleFraction: (retainedEndBin - retainedStartBin) / fftSize, validFraction: 1 },
      diagnostics: { floorDb: -80, widthHz: 0, widthBins: 0, spacingHz: null, peakCount: 0 },
    },
    frameMetadata: {
      sourceId: 'source-1:1',
      centerFrequencyHz,
      analysisSampleRateHz: 3_200_000,
      fftSize,
      retainedStartBin,
      retainedEndBin,
      timestampMs: 123456,
    } as NativeClassifier.NativeShadowResult['frameMetadata'],
    score: null,
    modelId: null,
    sampleRateValidated: false,
    latencyMs: 4.2,
    ruleScore: 0.5,
  };
}

beforeEach(() => window.sessionStorage.clear());

it('shows the existing decision beside native-resolution shadow diagnostics and clears a loaded model', () => {
  const onModel = jest.fn();
  render(<NativeClassifier.NativeClassifierPanel result={null} legacy={{ isNapt: true, confidence: 0.87 }} onModel={onModel} />);
  expect(screen.getByText('Displayed classifier: match (0.870)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear model' }));
  expect(onModel).toHaveBeenCalledWith(null);
});

it('withholds the previous score when the newest fresh frame has insufficient evidence', () => {
  const result = channelMatchResult(1_618_000);
  result.summary = { ...result.summary, status: 'insufficient_evidence' };
  result.ruleScore = null;
  render(<NativeClassifier.NativeClassifierPanel result={result} onModel={jest.fn()} />);
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('insufficient_evidence');
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('score withheld');
  expect(screen.getByTestId('classifier-shadow-status')).not.toHaveTextContent('rule 0.500');
});

it('renders classifier controls as a narrow stacked sidebar card and hides the artifact encoding detail', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable />);
  expect(screen.getByRole('region', { name: 'Experimental native resolution classifier' })).toHaveAttribute('data-layout', 'sidebar');
  expect(screen.getByTestId('classifier-state')).toHaveAttribute('data-state', 'ready');
  expect(screen.getByTestId('classifier-capture-status')).toHaveStyle({ minHeight: '2.9em' });
  expect(screen.getByRole('region', { name: 'Classifier workflow' })).toBeInTheDocument();
  expect(screen.getByTestId('classifier-flow-node-selected-source')).toHaveTextContent('Selected spectrum source');
  expect(screen.getByTestId('classifier-flow-node-selected-source')).toHaveTextContent('file playback');
  expect(screen.getByTestId('classifier-flow-node-capture')).toHaveTextContent('live receiving RTL-SDR');
  expect(screen.getByTestId('classifier-flow-node-native-features')).toHaveTextContent('Native FFT metadata');
  expect(screen.getByTestId('classifier-flow-node-annotations')).toHaveTextContent('V6 .iq + labels.json');
  expect(screen.getByTestId('classifier-flow-node-annotations')).toHaveTextContent('filename + UTC fallback');
  expect(screen.getByTestId('classifier-flow-node-offline-training')).toHaveTextContent('Python');
  expect(screen.getByTestId('classifier-flow-node-result')).toHaveTextContent('No decision yet');
  expect(screen.getByRole('button', { name: 'Load model' })).toBeInTheDocument();
});

it('reports the acquisition frame FFT size, retained crop and timestamp with native diagnostics', () => {
  const summary = {
    status: 'ready' as const,
    values: [],
    available: { narrow: true, bridge: true, envelope: true },
    resolution: { binHz: 781.25, resolutionHz: 1171.88, firstBinHz: 0, cropped: true, incomplete: false, visibleFraction: 0.75, validFraction: 1 },
    diagnostics: { floorDb: -80, widthHz: 0, widthBins: 0, spacingHz: null, peakCount: 0 },
  };
  const result = {
    summary,
    frameMetadata: { sourceId: 'source-1', centerFrequencyHz: 1_618_000, analysisSampleRateHz: 3_200_000, fftSize: 4096, retainedStartBin: 512, retainedEndBin: 3584, timestampMs: 123456 },
    score: null,
    modelId: null,
    sampleRateValidated: false,
    latencyMs: 4.2,
    ruleScore: 0.5,
  } as NativeClassifier.NativeShadowResult;
  render(<NativeClassifier.NativeClassifierPanel result={result} onModel={jest.fn()} />);
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('4096 FFT');
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('retained bins 512–3584 (75.0% visible)');
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('frame 123456 ms');
});

it('does not present a stale shadow score as a current decision', () => {
  const summary = {
    status: 'ready' as const,
    values: [],
    available: { narrow: true, bridge: true, envelope: true },
    resolution: { binHz: 781.25, resolutionHz: 1171.88, firstBinHz: 0, cropped: true, incomplete: false, visibleFraction: 0.75, validFraction: 1 },
    diagnostics: { floorDb: -80, widthHz: 0, widthBins: 0, spacingHz: null, peakCount: 0 },
  };
  const result = {
    summary,
    frameMetadata: { sourceId: 'source-1', centerFrequencyHz: 1_618_000, analysisSampleRateHz: 3_200_000, fftSize: 4096, retainedStartBin: 512, retainedEndBin: 3584, timestampMs: 123456 },
    score: null,
    modelId: null,
    sampleRateValidated: false,
    latencyMs: 4.2,
    ruleScore: 0.5,
  } as NativeClassifier.NativeShadowResult;
  const { rerender } = render(<NativeClassifier.NativeClassifierPanel result={result} resultState="stale" onModel={jest.fn()} />);
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('stale shadow frame');
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('frame 123456 ms');
  expect(screen.getByTestId('classifier-shadow-status')).not.toHaveTextContent('rule 0.500');
  rerender(<NativeClassifier.NativeClassifierPanel result={result} resultState="metadata-mismatch" onModel={jest.fn()} />);
  expect(screen.getByTestId('classifier-shadow-status')).toHaveTextContent('shadow frame metadata does not match current acquisition');
  expect(screen.getByTestId('classifier-shadow-status')).not.toHaveTextContent('rule 0.500');
});

it('starts only when the parent confirms a safe live source and exports captured frames explicitly', () => {
  const onToggleCapture = jest.fn();
  const onExportCapture = jest.fn();
  const { rerender } = render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable={false} onToggleCapture={onToggleCapture} onExportCapture={onExportCapture} />);
  expect(screen.getByRole('button', { name: 'Start training capture' })).toBeDisabled();
  rerender(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable onToggleCapture={onToggleCapture} onExportCapture={onExportCapture} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start training capture' }));
  expect(onToggleCapture).toHaveBeenCalledTimes(1);
  rerender(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureActive captureFrameCount={1} onToggleCapture={onToggleCapture} onExportCapture={onExportCapture} />);
  expect(screen.getByTestId('classifier-state')).toHaveAttribute('data-state', 'recording');
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export V6 I/Q + labels' }));
  expect(onToggleCapture).toHaveBeenCalledTimes(2);
  expect(onExportCapture).toHaveBeenCalledTimes(1);
});

it('offers a Data Package download and protected classification destination after export', async () => {
  const onClearCapture = jest.fn();
  render(<NativeClassifier.NativeClassifierPanel
    result={null}
    onModel={jest.fn()}
    captureFrameCount={12}
    captureDownloads={{
      packageHref: 'blob:https://local/package',
      packageFileName: 'n-apt-session.zip',
    }}
    onClearCapture={onClearCapture}
  />);

  expect(screen.getByRole('link', { name: 'Download capture package' })).toHaveAttribute('href', 'blob:https://local/package');
  expect(screen.getByRole('link', { name: 'Download capture package' })).toHaveAttribute('download', 'n-apt-session.zip');
  expect(screen.queryByRole('link', { name: 'Download I/Q capture' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download labels' })).not.toBeInTheDocument();
  expect(screen.getByText(/datapackage\.json, the V6 I\/Q capture, and detached labels/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clear exported capture' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clear capture to continue' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export V6 I/Q + labels' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Save classification capture to Hugging Face'));
  expect(screen.getByLabelText('Split')).toBeInTheDocument();
  expect(screen.getByLabelText('Increased protection (required for online storage)')).toBeChecked();
  expect(screen.getByLabelText('Increased protection (required for online storage)')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save encrypted to Hugging Face' }));
  expect(await screen.findByText('Sign in to save this capture to the dataset.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear exported capture' }));
  expect(onClearCapture).toHaveBeenCalledTimes(1);
});

it('keeps a rehydrated export from starting a new capture after refresh', () => {
  const onToggleCapture = jest.fn();
  render(<NativeClassifier.NativeClassifierPanel
    result={null}
    onModel={jest.fn()}
    captureAvailable
    captureDownloads={{
      packageHref: `/api/capture/download?jobId=classifier_${'a'.repeat(64)}`,
      packageFileName: `n-apt-classifier-${'a'.repeat(12)}.zip`,
    }}
    onToggleCapture={onToggleCapture}
  />);

  expect(screen.getByRole('button', { name: 'Clear capture to continue' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear capture to continue' }));
  expect(onToggleCapture).not.toHaveBeenCalled();
});

it('saves classification captures through the protected dataset flow with an explicit split', async () => {
  const previousFetchDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ files: ['training-captures/classification/validation/capture.iq.enc'] }),
  } as Response);
  Object.defineProperty(window, 'fetch', { configurable: true, value: fetchMock });
  render(<NativeClassifier.NativeClassifierPanel
    result={null}
    onModel={jest.fn()}
    captureDownloads={{ jobId: `classifier_${'a'.repeat(64)}`, packageHref: '/package.zip', packageFileName: 'package.zip' }}
    sessionToken="session-token"
  />);
  fireEvent.click(screen.getByLabelText('Save classification capture to Hugging Face'));
  fireEvent.change(screen.getByLabelText('Split'), { target: { value: 'validation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save encrypted to Hugging Face' }));

  await screen.findByText(/Saved with increased protection/);
  const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string, window.location.origin);
  expect(requestedUrl.pathname).toBe('/api/capture/save/huggingface');
  expect(requestedUrl.searchParams.get('section')).toBe('classification');
  expect(requestedUrl.searchParams.get('split')).toBe('validation');
  expect(requestedUrl.searchParams.get('token')).toBe('session-token');
  if (previousFetchDescriptor) {
    Object.defineProperty(window, 'fetch', previousFetchDescriptor);
  } else {
    Reflect.deleteProperty(window, 'fetch');
  }
});

it('holds capture controls until a persisted export link is rehydrated', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable captureDownloadsPersisted />);

  expect(screen.getByRole('button', { name: 'Sign in to retrieve saved capture' })).toBeDisabled();
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent('awaits an authenticated session');
});

it('collects a capture label, morphology toggles, and editable condition tags', () => {
  const onToggleCapture = jest.fn();
  const onAnnotationsChange = jest.fn();
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable onToggleCapture={onToggleCapture} onAnnotationsChange={onAnnotationsChange} />);
  fireEvent.change(screen.getByLabelText('Signal label'), { target: { value: 'matching' } });
  fireEvent.click(screen.getByLabelText('U-dip'));
  fireEvent.click(screen.getByLabelText('Coherent continuation across visible band'));
  fireEvent.click(screen.getByLabelText('Pulsing / amplitude cycling'));
  fireEvent.click(screen.getByLabelText('Regular spike spacing'));
  fireEvent.click(screen.getByLabelText('Spikes above local floor'));
  fireEvent.change(screen.getByLabelText('N-APT channel'), { target: { value: 'A' } });
  fireEvent.change(screen.getByLabelText('Add condition tag'), { target: { value: 'weak interference' } });
  fireEvent.keyDown(screen.getByLabelText('Add condition tag'), { key: 'Enter' });
  expect(screen.getByText('weak interference')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Remove weak interference'));
  fireEvent.click(screen.getByRole('button', { name: 'Start training capture' }));
  expect(onToggleCapture).toHaveBeenCalledWith({ label: 'matching', channel: 'A', features: ['u-dip', 'coherent-continuation', 'pulsing', 'regular-spike-spacing', 'above-floor-spikes'], tags: [] });
  expect(onAnnotationsChange).toHaveBeenCalled();
  expect(screen.queryByLabelText('Partial shape')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Truncated by visible band edge')).toBeInTheDocument();
});

it('keeps known target presence positive when interference affects the display', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} />);
  expect(screen.getByTestId('classifier-label-guidance')).toHaveTextContent('Matching means the known N-APT target is present');
  expect(screen.getByTestId('classifier-label-guidance')).toHaveTextContent('Interference is a condition, not a negative label');
  expect(screen.getByTestId('classifier-label-guidance')).toHaveTextContent('Known app mocks and sinc signals are non-matching examples');
});

it('suggests the channel from the current frame center until the user chooses a manual override', () => {
  const onAnnotationsChange = jest.fn();
  const canonicalChannels: SpectrumFrame[] = [
    { id: 'a', label: 'A', min_hz: 18_000, max_hz: 4_390_000, description: 'Channel A' },
    { id: 'c', label: 'C', min_hz: 4_750_000, max_hz: 23_000_000, description: 'Channel C' },
    { id: 'b', label: 'B', min_hz: 24_100_000, max_hz: 30_370_000, description: 'Channel B' },
  ];
  const { rerender } = renderClassifierPanelWithChannels({
    result: channelMatchResult(1_618_000),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1:1',
    onAnnotationsChange,
  });

  expect(screen.getByLabelText('N-APT channel')).toHaveValue('auto');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: Channel A');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Current annotation: Channel A');
  expect(screen.getByRole('status', { name: 'Channel match status' })).toHaveTextContent('Automatic channel suggestion: Channel A');
  expect(onAnnotationsChange).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'A' }));

  fireEvent.change(screen.getByLabelText('N-APT channel'), { target: { value: 'A' } });
  rerender(createElement(NativeClassifier.NativeClassifierPanel as unknown as ComponentType<ClassifierPanelWithChannelsProps>, {
    result: channelMatchResult(24_200_000),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1:1',
    onAnnotationsChange,
  }));

  expect(screen.getByLabelText('N-APT channel')).toHaveValue('A');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Manual channel label: Channel A');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: Channel B');

  fireEvent.change(screen.getByLabelText('N-APT channel'), { target: { value: 'auto' } });
  expect(screen.getByLabelText('N-APT channel')).toHaveValue('auto');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Current annotation: Channel B');
  expect(onAnnotationsChange).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'B' }));
});

it('keeps channel matching based on frame center when crop visibility changes', () => {
  const canonicalChannels: SpectrumFrame[] = [
    { id: 'a', label: 'A', min_hz: 18_000, max_hz: 4_390_000, description: 'Channel A' },
    { id: 'b', label: 'B', min_hz: 24_100_000, max_hz: 30_370_000, description: 'Channel B' },
  ];
  const { rerender } = renderClassifierPanelWithChannels({
    result: channelMatchResult(1_618_000),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1:1',
  });
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: Channel A');

  rerender(createElement(NativeClassifier.NativeClassifierPanel as unknown as ComponentType<ClassifierPanelWithChannelsProps>, {
    result: channelMatchResult(1_618_000, 2040, 2056),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1:1',
  }));
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: Channel A');
});

it('requires an exact current stream key and declines stale frames or another source', () => {
  const canonicalChannels: SpectrumFrame[] = [
    { id: 'a', label: 'A', min_hz: 18_000, max_hz: 4_390_000, description: 'Channel A' },
    { id: 'b', label: 'B', min_hz: 24_100_000, max_hz: 30_370_000, description: 'Channel B' },
  ];
  const { rerender } = renderClassifierPanelWithChannels({
    result: channelMatchResult(1_618_000),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1',
  });

  expect(screen.getByLabelText('N-APT channel')).toHaveValue('auto');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: unavailable');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Current annotation: Unspecified');

  rerender(createElement(NativeClassifier.NativeClassifierPanel as unknown as ComponentType<ClassifierPanelWithChannelsProps>, {
    result: channelMatchResult(1_618_000),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1:1',
  }));
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: Channel A');

  rerender(createElement(NativeClassifier.NativeClassifierPanel as unknown as ComponentType<ClassifierPanelWithChannelsProps>, {
    result: channelMatchResult(1_618_000),
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'another-source:2',
  }));
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: unavailable');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Current annotation: Unspecified');

  rerender(createElement(NativeClassifier.NativeClassifierPanel as unknown as ComponentType<ClassifierPanelWithChannelsProps>, {
    result: channelMatchResult(1_618_000),
    resultState: 'stale',
    onModel: jest.fn(),
    canonicalChannels,
    activeStreamId: 'source-1:1',
  }));
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Automatic channel suggestion: unavailable');
  expect(screen.getByTestId('classifier-channel-match')).toHaveTextContent('Current annotation: Unspecified');
});

it('explains that a tuned receiver stopped the single-frequency capture', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable captureFrameCount={3} captureStatus="center-frequency-changed:137500000:137600000" />);
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent('137.500 → 137.600 MHz');
  expect(screen.getByText('Review capture labels')).toBeInTheDocument();
});

it('names the applied-options action and shows its revision/frame boundary', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable captureFrameCount={3} captureStatus="options-applied:fftSize,optionsRevision:rev-2-to-3:10:11" />);
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent('OptionsApplied boundary');
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent('revision 2 → 3, frame 10 → 11');
});

it('politely asks the user to reconnect the RTL-SDR after a disconnect', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureFrameCount={2} captureStatus="rtl-sdr-disconnected" />);
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent('The RTL-SDR is disconnected. Please reconnect it; capture will be ready when receiving resumes.');
});

it.each([
  ['rtl-sdr-stale', 'The RTL-SDR has stopped sending fresh frames. Please check its connection and reconnect it; capture will be ready when fresh receiving resumes.'],
  ['rtl-sdr-paused', 'RTL-SDR capture is paused. Resume live receiving before starting a capture.'],
  ['rtl-sdr-not-receiving', 'The RTL-SDR is not receiving live frames. Switch it to RX/Receiving before capturing.'],
])('gives distinct guidance for %s', (captureStatus, message) => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureStatus={captureStatus} />);
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent(message);
});

it('explains stale-frame auto-stop and politely invites reconnect if the receiver dropped', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureFrameCount={4} captureStatus="no-new-frames" />);
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent('Capture stopped because fresh I/Q frames stopped arriving. Please check the RTL-SDR connection and reconnect it if the receiver dropped; recording will be ready when fresh receiving resumes.');
});

it.each([
  ['non-increasing-frame-timestamp', 'Capture stopped because I/Q frame timestamps did not advance. Wait for a fresh, ordered stream before recording again.'],
  ['frame-timestamp-stale', 'Capture stopped because an I/Q frame arrived too late to prove continuity. Please check the RTL-SDR connection and reconnect it if the receiver dropped.'],
  ['frame-timestamp-future', 'Capture stopped because an I/Q frame timestamp is ahead of the browser clock. Check time alignment before recording again.'],
])('explains capture stop reason %s', (captureStatus, message) => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureStatus={captureStatus} />);
  expect(screen.getByTestId('classifier-capture-status')).toHaveTextContent(message);
});

it('shows sequence and timestamp values for a rejected non-increasing frame without exposing I/Q data', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureStatus="non-increasing-frame-timestamp" captureTimestampDiagnostic={{
    previousSequence: 10, previousTimestampMs: 1000, incomingSequence: 11, incomingTimestampMs: 1000,
  }} />);
  expect(screen.getByTestId('classifier-capture-timestamp-diagnostic')).toHaveTextContent('Frame 11 at 1000 ms followed frame 10 at 1000 ms.');
  expect(screen.queryByTestId('classifier-capture-timestamp-diagnostic')).not.toHaveTextContent('I/Q');
});

it('requires exporting a completed capture before another recording can start', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable captureFrameCount={1} />);
  expect(screen.getByRole('button', { name: 'Export before next capture' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export V6 I/Q + labels' })).toBeEnabled();
});
