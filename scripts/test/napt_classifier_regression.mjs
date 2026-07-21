import path from "node:path";

const FEATURE_LABELS = new Set(["positive", "negative", "unasserted"]);
const NAPT_LABELS = new Set(["yes", "likely", "no"]);
const FEATURE_NAMES = [
  "suspension_bridge",
  "u_dip",
  "unimodal_bridge",
  "partial_bridge",
  "apex_prominence",
  "shoulder_symmetry",
  "capture_quality",
];

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function validateThresholds(thresholds, caseId) {
  if (!thresholds || typeof thresholds !== "object") {
    throw new Error(`case ${caseId} requires thresholds`);
  }
  for (const feature of FEATURE_NAMES) {
    const threshold = thresholds[feature];
    if (!threshold) continue;
    if (threshold.peak_min !== undefined) finiteNumber(threshold.peak_min, `${caseId}.${feature}.peak_min`);
    if (threshold.peak_max !== undefined) finiteNumber(threshold.peak_max, `${caseId}.${feature}.peak_max`);
    if (threshold.p75_min !== undefined) finiteNumber(threshold.p75_min, `${caseId}.${feature}.p75_min`);
    if (threshold.p75_max !== undefined) finiteNumber(threshold.p75_max, `${caseId}.${feature}.p75_max`);
    if (threshold.peak_min === undefined && threshold.peak_max === undefined && threshold.p75_min === undefined && threshold.p75_max === undefined) {
      throw new Error(`case ${caseId}.${feature} requires a score threshold`);
    }
  }
  const napt = thresholds.napt;
  if (!napt || typeof napt !== "object") throw new Error(`case ${caseId} requires thresholds.napt`);
  for (const key of ["confidence_min", "confidence_max", "yes_fraction_min", "yes_fraction_max"]) {
    if (napt[key] !== undefined) finiteNumber(napt[key], `${caseId}.napt.${key}`);
  }
}

export function parseRegressionManifest(raw, rootDir = process.cwd()) {
  if (!raw || typeof raw !== "object") throw new Error("regression manifest must be an object");
  if (raw.version !== 1) throw new Error("regression manifest version must be 1");
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error("regression manifest requires cases");
  const ids = new Set();
  const cases = raw.cases.map((entry, index) => {
    const caseId = typeof entry?.id === "string" && entry.id.length > 0 ? entry.id : `case-${index}`;
    if (ids.has(caseId)) throw new Error(`duplicate regression case id: ${caseId}`);
    ids.add(caseId);
    if (typeof entry.capture_dir !== "string" || entry.capture_dir.length === 0) {
      throw new Error(`case ${caseId} requires capture_dir`);
    }
    if (!entry.expected || !NAPT_LABELS.has(entry.expected.napt)) {
      throw new Error(`case ${caseId} requires expected.napt of yes, likely, or no`);
    }
    for (const feature of ["suspension_bridge", "u_dip"]) {
      if (!entry.expected[feature] || !FEATURE_LABELS.has(entry.expected[feature])) {
        throw new Error(`case ${caseId} requires expected.${feature} of positive, negative, or unasserted`);
      }
    }
    validateThresholds(entry.thresholds, caseId);
    return {
      id: caseId,
      capture_dir: path.resolve(rootDir, entry.capture_dir),
      expected: { ...entry.expected },
      thresholds: structuredClone(entry.thresholds),
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
    };
  });
  return { version: 1, cases };
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { peak: 0, p75: 0, mean: 0 };
  return {
    peak: Math.max(...finite),
    p75: percentile(finite, 0.75),
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
  };
}

export function aggregateClassifierFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("classifier frame results are required");
  const metricValues = {
    suspension_bridge: frames.map((frame) => Number(frame.unimodalBridge ?? frame.suspensionBridge)),
    u_dip: frames.map((frame) => Number(frame.uDip)),
    unimodal_bridge: frames.map((frame) => Number(frame.unimodalBridge)),
    partial_bridge: frames.map((frame) => Number(frame.partialBridge)),
    apex_prominence: frames.map((frame) => Number(frame.apexProminence)),
    shoulder_symmetry: frames.map((frame) => Number(frame.shoulderSymmetry)),
    capture_quality: frames.map((frame) => Number(frame.captureQuality)),
    confidence: frames.map((frame) => Number(frame.confidence)),
  };
  return {
    frame_count: frames.length,
    metrics: Object.fromEntries(Object.entries(metricValues).map(([key, values]) => [key, summarize(values)])),
    temporal_yes_fraction: frames.filter((frame) => frame.isNapt === true).length / frames.length,
    baseline_yes_fraction: frames.filter((frame) => frame.baselineIsNapt === true).length / frames.length,
    frames,
  };
}

export function evaluateRegressionCase(testCase, aggregate) {
  const failures = [];
  const expected = testCase.expected;
  const thresholds = testCase.thresholds;
  for (const feature of ["suspension_bridge", "u_dip"]) {
    const label = expected[feature];
    const metric = aggregate.metrics[feature];
    const threshold = thresholds[feature];
    if (label === "positive") {
      if (threshold.peak_min !== undefined && metric.peak < threshold.peak_min) {
        failures.push(`${feature} peak ${metric.peak.toFixed(3)} < ${threshold.peak_min.toFixed(3)}`);
      }
      if (threshold.p75_min !== undefined && metric.p75 < threshold.p75_min) {
        failures.push(`${feature} p75 ${metric.p75.toFixed(3)} < ${threshold.p75_min.toFixed(3)}`);
      }
    } else if (label === "negative") {
      if (threshold.peak_max !== undefined && metric.peak > threshold.peak_max) {
        failures.push(`${feature} peak ${metric.peak.toFixed(3)} > ${threshold.peak_max.toFixed(3)}`);
      }
      if (threshold.p75_max !== undefined && metric.p75 > threshold.p75_max) {
        failures.push(`${feature} p75 ${metric.p75.toFixed(3)} > ${threshold.p75_max.toFixed(3)}`);
      }
    }
  }
  const qualityThreshold = thresholds.capture_quality;
  const qualityMetric = aggregate.metrics.capture_quality;
  if (qualityThreshold && qualityMetric) {
    if (qualityThreshold.peak_min !== undefined && qualityMetric.peak < qualityThreshold.peak_min) {
      failures.push(`capture_quality peak ${qualityMetric.peak.toFixed(3)} < ${qualityThreshold.peak_min.toFixed(3)}`);
    }
    if (qualityThreshold.peak_max !== undefined && qualityMetric.peak > qualityThreshold.peak_max) {
      failures.push(`capture_quality peak ${qualityMetric.peak.toFixed(3)} > ${qualityThreshold.peak_max.toFixed(3)}`);
    }
    if (qualityThreshold.p75_min !== undefined && qualityMetric.p75 < qualityThreshold.p75_min) {
      failures.push(`capture_quality p75 ${qualityMetric.p75.toFixed(3)} < ${qualityThreshold.p75_min.toFixed(3)}`);
    }
    if (qualityThreshold.p75_max !== undefined && qualityMetric.p75 > qualityThreshold.p75_max) {
      failures.push(`capture_quality p75 ${qualityMetric.p75.toFixed(3)} > ${qualityThreshold.p75_max.toFixed(3)}`);
    }
  }
  const napt = thresholds.napt;
  const confidence = aggregate.metrics.confidence;
  if (expected.napt === "yes") {
    if (napt.confidence_min !== undefined && confidence.peak < napt.confidence_min) {
      failures.push(`confidence peak ${confidence.peak.toFixed(3)} < ${napt.confidence_min.toFixed(3)}`);
    }
    if (napt.yes_fraction_min !== undefined && aggregate.temporal_yes_fraction < napt.yes_fraction_min) {
      failures.push(`temporal yes fraction ${aggregate.temporal_yes_fraction.toFixed(3)} < ${napt.yes_fraction_min.toFixed(3)}`);
    }
  } else if (expected.napt === "no") {
    if (napt.confidence_max !== undefined && confidence.peak > napt.confidence_max) {
      failures.push(`confidence peak ${confidence.peak.toFixed(3)} > ${napt.confidence_max.toFixed(3)}`);
    }
    if (napt.yes_fraction_max !== undefined && aggregate.temporal_yes_fraction > napt.yes_fraction_max) {
      failures.push(`temporal yes fraction ${aggregate.temporal_yes_fraction.toFixed(3)} > ${napt.yes_fraction_max.toFixed(3)}`);
    }
  } else if (napt.confidence_min !== undefined && confidence.peak < napt.confidence_min) {
    failures.push(`likely confidence peak ${confidence.peak.toFixed(3)} < ${napt.confidence_min.toFixed(3)}`);
  }
  return { ok: failures.length === 0, failures };
}
