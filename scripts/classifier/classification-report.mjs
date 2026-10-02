const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function increment(group, row) {
  group.windows += 1;
  if (row.status === 'ready') group.readyWindows += 1;
  else group.insufficientEvidenceWindows += 1;
  if (row.status === 'ready' && typeof row.decision === 'boolean') {
    if (row.decision) group.naptPredictions += 1;
    else group.nonNaptPredictions += 1;
    const score = finite(row.score);
    if (score !== null) {
      group.score.count += 1;
      group.score.sum += score;
      group.score.min = group.score.min === null ? score : Math.min(group.score.min, score);
      group.score.max = group.score.max === null ? score : Math.max(group.score.max, score);
    }
  }
  const timestamp = finite(row.timestampMs);
  if (timestamp !== null) {
    group.timestampsMs.first = group.timestampsMs.first === null ? timestamp : Math.min(group.timestampsMs.first, timestamp);
    group.timestampsMs.last = group.timestampsMs.last === null ? timestamp : Math.max(group.timestampsMs.last, timestamp);
  }
}

function initialGroup() {
  return {
    windows: 0,
    readyWindows: 0,
    insufficientEvidenceWindows: 0,
    naptPredictions: 0,
    nonNaptPredictions: 0,
    score: { count: 0, min: null, max: null, sum: 0 },
    timestampsMs: { first: null, last: null },
  };
}

function finishGroup(group) {
  const { sum, ...score } = group.score;
  return {
    ...group,
    score: { ...score, mean: score.count ? sum / score.count : null },
  };
}

function resolutionVisibilityKey(row) {
  return JSON.stringify([
    finite(row.sampleRateHz), finite(row.analysisSampleRateHz), finite(row.fftSize),
    finite(row.binHz), finite(row.resolutionHz), finite(row.retainedStartBin),
    finite(row.retainedEndBin), finite(row.visibleFraction), finite(row.firstBinHz),
  ]);
}

function resolutionVisibilityMetadata(row) {
  return {
    sampleRateHz: finite(row.sampleRateHz),
    analysisSampleRateHz: finite(row.analysisSampleRateHz),
    fftSize: finite(row.fftSize),
    binHz: finite(row.binHz),
    resolutionHz: finite(row.resolutionHz),
    retainedStartBin: finite(row.retainedStartBin),
    retainedEndBin: finite(row.retainedEndBin),
    visibleFraction: finite(row.visibleFraction),
    firstBinHz: finite(row.firstBinHz),
  };
}

function sortNullableNumber(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function summarizeClassificationRows(rows, modelId) {
  if (!Array.isArray(rows)) throw new TypeError('classification rows must be an array');
  if (typeof modelId !== 'string' || !modelId.length) throw new TypeError('modelId must be a non-empty string');
  const recordings = new Map();
  const totals = initialGroup();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const recordingId = String(row.sourceCaptureId ?? row.captureId ?? row.id ?? 'unknown-recording');
    let recording = recordings.get(recordingId);
    if (!recording) {
      recording = { ...initialGroup(), recordingId, sessionIds: new Set(), resolutionVisibility: new Map() };
      recordings.set(recordingId, recording);
    }
    if (typeof row.session === 'string' && row.session.length) recording.sessionIds.add(row.session);
    increment(recording, row);
    increment(totals, row);

    const key = resolutionVisibilityKey(row);
    let resolutionGroup = recording.resolutionVisibility.get(key);
    if (!resolutionGroup) {
      resolutionGroup = { ...initialGroup(), ...resolutionVisibilityMetadata(row) };
      recording.resolutionVisibility.set(key, resolutionGroup);
    }
    increment(resolutionGroup, row);
  }

  const reportRecordings = [...recordings.values()].map(recording => {
    const { resolutionVisibility, sessionIds, ...counts } = recording;
    const byResolutionVisibility = [...resolutionVisibility.values()]
      .map(finishGroup)
      .sort((a, b) => sortNullableNumber(a.fftSize, b.fftSize)
        || sortNullableNumber(a.retainedStartBin, b.retainedStartBin)
        || sortNullableNumber(a.retainedEndBin, b.retainedEndBin)
        || sortNullableNumber(a.binHz, b.binHz));
    return {
      ...finishGroup(counts),
      sessionIds: [...sessionIds].sort(),
      byResolutionVisibility,
    };
  }).sort((a, b) => a.recordingId.localeCompare(b.recordingId));

  return {
    format: 'n-apt-classification-summary-v1',
    modelId: String(modelId),
    totalWindows: totals.windows,
    totalReadyWindows: totals.readyWindows,
    totalInsufficientEvidenceWindows: totals.insufficientEvidenceWindows,
    recordings: reportRecordings,
  };
}
