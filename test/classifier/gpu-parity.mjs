import assert from 'node:assert/strict';
import { createRunner } from '../../scripts/classifier/runner.mjs';
const runner = await createRunner();
try {
  const result = await runner.parity();
  assert.ok(result.maxFeatureError < 2e-4, JSON.stringify(result));
  assert.ok(result.maxInferenceError < 2e-5, JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
} finally { await runner.close(); }
