import { createClassifierWorkflowGraph } from '@n-apt/classification/native/classifierWorkflow';

it('models the selected-source scoring path and the offline training path as separate branches', () => {
  const { nodes, edges } = createClassifierWorkflowGraph({
    selectedSourceHasFrames: true,
    captureActive: false,
    hasCapturedFrames: true,
    loadedModelId: 'native-morphology-v1',
    resultAvailable: true,
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));

  expect(nodeById.get('selected-source')?.data.title).toBe('Selected spectrum source');
  expect(nodeById.get('selected-source')?.data.detail).toContain('file playback');
  expect(nodeById.get('native-features')?.data.detail).toContain('Native FFT metadata');
  expect(nodeById.get('capture')?.data.detail).toContain('Capture stopped');
  expect(nodeById.get('annotations')?.data.title).toBe('V6 .iq + labels.json');
  expect(nodeById.get('annotations')?.data.detail).toContain('trailer SHA-256');
  expect(nodeById.get('annotations')?.data.detail).not.toContain('filename + UTC fallback');
  expect(nodeById.get('annotations')?.data.status).toBe('ready');
  expect(nodeById.get('offline-training')?.data.detail).toContain('Python');
  expect(nodeById.get('model-artifact')?.data.detail).toContain('native-morphology-v1');
  expect(nodeById.get('result')?.data.detail).toContain('Current score');

  expect(links).toEqual(new Set([
    'selected-source->native-features',
    'native-features->shadow-score',
    'shadow-score->result',
    'selected-source->capture',
    'capture->annotations',
    'annotations->offline-training',
    'offline-training->model-artifact',
    'model-artifact->shadow-score',
  ]));
});

it('shows waiting, active capture, and missing model states without implying classification', () => {
  const { nodes } = createClassifierWorkflowGraph({
    selectedSourceHasFrames: false,
    captureActive: true,
    hasCapturedFrames: false,
    loadedModelId: null,
    resultAvailable: false,
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  expect(nodeById.get('selected-source')?.data.status).toBe('waiting');
  expect(nodeById.get('capture')?.data.status).toBe('recording');
  expect(nodeById.get('native-features')?.data.status).toBe('waiting');
  expect(nodeById.get('capture')?.data.detail).toContain('Live RTL-SDR only');
  expect(nodeById.get('model-artifact')?.data.detail).toContain('No model loaded');
  expect(nodeById.get('result')?.data.detail).toContain('No decision yet');
});
