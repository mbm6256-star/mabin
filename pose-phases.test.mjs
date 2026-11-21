import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSwingPhases, validSwingBoundaries } from './pose-phases.mjs';
import { pairedSamples } from './pose-metrics.mjs';

const rate = 12;
function fixture() {
  const x = [.54, .54, .54, .54, .53, .49, .44, .41, .41, .43, .50, .61, .73, .81, .85, .87, .88, .88, .88, .88];
  return x.map((wrist, index) => {
    const landmarks = [];
    const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
    landmarks[11] = point(.4, .3);
    landmarks[12] = point(.6, .3);
    landmarks[23] = point(.44, .53);
    landmarks[24] = point(.56, .53);
    landmarks[16] = point(wrist, .44);
    const worldLandmarks = [];
    const angle = index * .06;
    worldLandmarks[11] = point(0, 0);
    worldLandmarks[12] = point(Math.cos(angle), 0, Math.sin(angle));
    return { time: index / rate, landmarks, worldLandmarks };
  });
}

test('same clip returns identical candidates and aligned samples at its phase boundary', () => {
  const a = fixture();
  const b = structuredClone(a);
  const candidateA = detectSwingPhases(a, 'right', 1280, 720, rate);
  const candidateB = detectSwingPhases(b, 'right', 1280, 720, rate);
  assert.deepEqual(candidateA, candidateB);
  assert.ok(candidateA.boundaries, candidateA.reason);
  const [,, forward, follow] = candidateA.boundaries;
  const index = a.findIndex(frame => frame.time === forward);
  const pairs = pairedSamples(a, b, index, index, rate)
    .filter(pair => pair.time >= 0 && pair.a.time < follow && pair.b.time < follow);
  assert.ok(pairs.length >= 2);
  assert.ok(pairs.every(pair => pair.a.time === pair.b.time));
});

test('occlusion, static pose and missing side defer candidate detection', () => {
  const frames = fixture();
  frames[9].landmarks[16] = null;
  assert.equal(detectSwingPhases(frames, 'right', 1280, 720, rate).boundaries, undefined);
  assert.equal(detectSwingPhases(fixture(), '', 1280, 720, rate).boundaries, undefined);
  const still = Array.from({ length: 24 }, (_, index) => ({ ...frames[0], time: index / rate }));
  assert.equal(detectSwingPhases(still, 'right', 1280, 720, rate).boundaries, undefined);
});

test('manual boundaries require five increasing in-range times', () => {
  assert.equal(validSwingBoundaries([0, .1, .2, .3, .4], .4), true);
  assert.equal(validSwingBoundaries([0, .1, .1, .3, .4], .4), false);
  assert.equal(validSwingBoundaries([0, .1, .2, .3, .5], .4), false);
  assert.equal(validSwingBoundaries([0, .1, NaN, .3, .4], .4), false);
});
