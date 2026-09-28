import { fireEvent, render, screen } from '@testing-library/react';
import * as NativeClassifier from '@n-apt/classification';

beforeEach(() => window.sessionStorage.clear());

it('shows the existing decision beside native-resolution shadow diagnostics and clears a loaded model', () => {
  const onModel = jest.fn();
  render(<NativeClassifier.NativeClassifierPanel result={null} legacy={{ isNapt: true, confidence: 0.87 }} onModel={onModel} />);
  expect(screen.getByText('Displayed classifier: match (0.870)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear model' }));
  expect(onModel).toHaveBeenCalledWith(null);
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
    frameMetadata: { fftSize: 4096, retainedStartBin: 512, retainedEndBin: 3584, timestampMs: 123456 },
    score: null,
    modelId: null,
    sampleRateValidated: false,
    latencyMs: 4.2,
    ruleScore: 0.5,
  } as NativeClassifier.NativeShadowResult;
  render(<NativeClassifier.NativeClassifierPanel result={result} onModel={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('4096 FFT');
  expect(screen.getByRole('status')).toHaveTextContent('retained bins 512–3584 (75.0% visible)');
  expect(screen.getByRole('status')).toHaveTextContent('frame 123456 ms');
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
    frameMetadata: { fftSize: 4096, retainedStartBin: 512, retainedEndBin: 3584, timestampMs: 123456 },
    score: null,
    modelId: null,
    sampleRateValidated: false,
    latencyMs: 4.2,
    ruleScore: 0.5,
  } as NativeClassifier.NativeShadowResult;
  const { rerender } = render(<NativeClassifier.NativeClassifierPanel result={result} resultState="stale" onModel={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('stale shadow frame');
  expect(screen.getByRole('status')).toHaveTextContent('frame 123456 ms');
  expect(screen.getByRole('status')).not.toHaveTextContent('rule 0.500');
  rerender(<NativeClassifier.NativeClassifierPanel result={result} resultState="metadata-mismatch" onModel={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('shadow frame metadata does not match current acquisition');
  expect(screen.getByRole('status')).not.toHaveTextContent('rule 0.500');
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

it('offers direct I/Q and label download links after preparing an export', () => {
  const onClearCapture = jest.fn();
  render(<NativeClassifier.NativeClassifierPanel
    result={null}
    onModel={jest.fn()}
    captureFrameCount={12}
    captureDownloads={{
      iqHref: 'blob:https://local/capture',
      iqFileName: 'n-apt-session.iq',
      annotationHref: 'blob:https://local/labels',
      annotationFileName: 'n-apt-session.json',
    }}
    onClearCapture={onClearCapture}
  />);

  expect(screen.getByRole('link', { name: 'Download I/Q capture' })).toHaveAttribute('href', 'blob:https://local/capture');
  expect(screen.getByRole('link', { name: 'Download I/Q capture' })).toHaveAttribute('download', 'n-apt-session.iq');
  expect(screen.getByRole('link', { name: 'Download labels' })).toHaveAttribute('href', 'blob:https://local/labels');
  expect(screen.getByRole('link', { name: 'Download labels' })).toHaveAttribute('download', 'n-apt-session.json');
  expect(screen.getByRole('button', { name: 'Clear exported capture' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clear capture to continue' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export V6 I/Q + labels' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear exported capture' }));
  expect(onClearCapture).toHaveBeenCalledTimes(1);
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

it('requires exporting a completed capture before another recording can start', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable captureFrameCount={1} />);
  expect(screen.getByRole('button', { name: 'Export before next capture' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export V6 I/Q + labels' })).toBeEnabled();
});
