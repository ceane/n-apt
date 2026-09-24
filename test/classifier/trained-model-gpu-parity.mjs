import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '../../scripts/classifier/runner.mjs';

const candidateDirectory = process.argv[2];
assert.ok(candidateDirectory, 'Pass the directory containing trained model artifacts');
const models = readdirSync(candidateDirectory)
  .filter(filename => filename.endsWith('.json'))
  .sort()
  .map(filename => JSON.parse(readFileSync(join(candidateDirectory, filename), 'utf8')));
assert.deepEqual(new Set(models.map(model => model.kind)), new Set(['logistic', 'mlp']));

const probes = [0.2, 0.8, 120].map(value => {
  const features = Array(18).fill(0);
  features[0] = value;
  return features;
});

const runner = await createRunner();
try {
  const result = await runner.inferParity(models, probes);
  assert.equal(result.comparisons.length, models.length * probes.length, JSON.stringify(result));
  assert.ok(result.maxInferenceError < 2e-5, JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await runner.close();
}
