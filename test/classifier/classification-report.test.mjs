import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeClassificationRows } from '../../scripts/classifier/classification-report.mjs';

test('summarizes decisions and evidence coverage per capture and FFT/crop without copying labels', () => {
  const rows = [
    {
      id: 'frame-a-0', captureId: 'capture-a', sourceCaptureId: 'source-a', session: 'session-a',
      timestampMs: 1000, score: 0.8, decision: true, status: 'ready', label: 'matching',
      fftSize: 1024, binHz: 3125, resolutionHz: 3125, retainedStartBin: 0, retainedEndBin: 1024, visibleFraction: 1,
    },
    {
      id: 'frame-a-1', captureId: 'capture-a', sourceCaptureId: 'source-a', session: 'session-a',
      timestampMs: 2000, score: 0.99, decision: null, status: 'insufficient_evidence', label: 'nonmatching',
      fftSize: 1024, binHz: 3125, resolutionHz: 3125, retainedStartBin: 0, retainedEndBin: 512, visibleFraction: 0.5,
    },
    {
      id: 'frame-b-0', captureId: 'capture-b', sourceCaptureId: 'source-b', session: 'session-b',
      timestampMs: 3000, score: 0.2, decision: false, status: 'ready', label: 'matching',
      fftSize: 4096, binHz: 781.25, resolutionHz: 1171.875, retainedStartBin: 512, retainedEndBin: 3584, visibleFraction: 0.75,
    },
  ];

  const report = summarizeClassificationRows(rows, 'model-1');

  assert.equal(report.format, 'n-apt-classification-summary-v1');
  assert.equal(report.modelId, 'model-1');
  assert.deepEqual({
    windows: report.totalWindows,
    ready: report.totalReadyWindows,
    insufficient: report.totalInsufficientEvidenceWindows,
  }, { windows: 3, ready: 2, insufficient: 1 });
  assert.deepEqual(report.recordings.map(({ recordingId, sessionIds, windows, readyWindows, insufficientEvidenceWindows, naptPredictions, nonNaptPredictions, score, timestampsMs }) => ({
    recordingId, sessionIds, windows, readyWindows, insufficientEvidenceWindows, naptPredictions, nonNaptPredictions, score, timestampsMs,
  })), [
    {
      recordingId: 'source-a', sessionIds: ['session-a'], windows: 2, readyWindows: 1,
      insufficientEvidenceWindows: 1, naptPredictions: 1, nonNaptPredictions: 0,
      score: { count: 1, min: 0.8, max: 0.8, mean: 0.8 }, timestampsMs: { first: 1000, last: 2000 },
    },
    {
      recordingId: 'source-b', sessionIds: ['session-b'], windows: 1, readyWindows: 1,
      insufficientEvidenceWindows: 0, naptPredictions: 0, nonNaptPredictions: 1,
      score: { count: 1, min: 0.2, max: 0.2, mean: 0.2 }, timestampsMs: { first: 3000, last: 3000 },
    },
  ]);
  assert.deepEqual(report.recordings[0].byResolutionVisibility.map(({ fftSize, binHz, retainedStartBin, retainedEndBin, visibleFraction, windows }) => ({
    fftSize, binHz, retainedStartBin, retainedEndBin, visibleFraction, windows,
  })), [
    { fftSize: 1024, binHz: 3125, retainedStartBin: 0, retainedEndBin: 512, visibleFraction: 0.5, windows: 1 },
    { fftSize: 1024, binHz: 3125, retainedStartBin: 0, retainedEndBin: 1024, visibleFraction: 1, windows: 1 },
  ]);
  assert.equal(JSON.stringify(report).includes('label'), false);
  assert.equal(JSON.stringify(report).includes('matching'), false);
});

test('keeps unavailable measurements and scores unavailable instead of converting them to zero', () => {
  const report = summarizeClassificationRows([{
    id: 'frame-no-metadata', sourceCaptureId: 'source-c', timestampMs: null,
    score: null, decision: null, status: 'insufficient_evidence',
    sampleRateHz: null, fftSize: null, binHz: null, retainedStartBin: null,
    retainedEndBin: null, visibleFraction: null,
  }], 'model-1');

  assert.equal(report.totalInsufficientEvidenceWindows, 1);
  assert.equal(report.recordings[0].score.count, 0);
  assert.equal(report.recordings[0].score.mean, null);
  assert.equal(report.recordings[0].timestampsMs.first, null);
  assert.deepEqual(report.recordings[0].byResolutionVisibility[0], {
    sampleRateHz: null, analysisSampleRateHz: null, fftSize: null, binHz: null,
    resolutionHz: null, retainedStartBin: null, retainedEndBin: null,
    visibleFraction: null, firstBinHz: null,
    windows: 1, readyWindows: 0, insufficientEvidenceWindows: 1,
    naptPredictions: 0, nonNaptPredictions: 0,
    score: { count: 0, min: null, max: null, mean: null },
    timestampsMs: { first: null, last: null },
  });
});
