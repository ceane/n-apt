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
  expect(screen.getByTestId('classifier-pipeline-flow')).toHaveTextContent('Start capture → Stop/export → Label & prepare → Extract → Train/evaluate → Load model');
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
  fireEvent.click(screen.getByRole('button', { name: 'Export I/Q frames' }));
  expect(onToggleCapture).toHaveBeenCalledTimes(2);
  expect(onExportCapture).toHaveBeenCalledTimes(1);
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

it('requires exporting a completed capture before another recording can start', () => {
  render(<NativeClassifier.NativeClassifierPanel result={null} onModel={jest.fn()} captureAvailable captureFrameCount={1} />);
  expect(screen.getByRole('button', { name: 'Export before next capture' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export I/Q frames' })).toBeEnabled();
});
