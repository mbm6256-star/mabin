import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSwingBoundaries, detectSwingPhases, hasComparablePhase, pairPhaseProgress, suggestSwingPhases, validSwingBoundaries } from './pose-phases.mjs';
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

test('validation reports signed offsets and mean absolute error for paired boundaries only', () => {
  const manual = [0, 1, 2, 3, 4];
  const result = compareSwingBoundaries([0, .875, 2.25, 3, 4.125], manual, 5);
  assert.deepEqual(result, { offsets: [0, -125, 250, 0, 125], meanAbsoluteMs: 100 });
  assert.deepEqual(compareSwingBoundaries(manual, manual, 5), { offsets: [0, 0, 0, 0, 0], meanAbsoluteMs: 0 });
  assert.equal(compareSwingBoundaries(null, manual, 5), null);
  assert.equal(compareSwingBoundaries(manual, [0, 1, 1, 3, 4], 5), null);
});

test('relative phase alignment compares observed endpoints of unequal lengths', () => {
  const a = [0, 1, 2, 3].map(time => ({ time, elbow: time * 10 }));
  const b = [4, 5, 6, 7, 8, 9, 10].map(time => ({ time, elbow: time === 6 ? null : time * 10 }));
  const pairs = pairPhaseProgress(a, b, [0, 3], [4, 10]);
  assert.deepEqual(pairs.map(({time, a, b}) => [time, a.time, b.time]), [[0, 0, 4], [.5, 1, 7], [1, 2, 9]]);
  const same = pairPhaseProgress(a, a, [0, 4], [0, 4]);
  assert(same.every(pair => pair.a.time === pair.b.time));
  assert.equal(hasComparablePhase(pairs, ['elbow']), true);
  assert.equal(hasComparablePhase(pairPhaseProgress(a, b, [0, 1], [4, 10]), ['elbow']), false);
  assert.deepEqual(pairPhaseProgress(a, b, [9, 10], [4, 10]), []);
});

test('phase comparison preserves missing samples and holds when a permitted metric is absent', () => {
  const samples = [{ time: 0, elbow: 0 }, { time: 1, elbow: null }, { time: 2, elbow: 20 }];
  const pairs = pairPhaseProgress(samples, samples, [0, 3], [0, 3]);
  assert.equal(pairs[1].a.elbow, null);
  assert.equal(hasComparablePhase(pairs, ['leftKnee']), false);
  assert.equal(hasComparablePhase(pairs.slice(0, 2), ['elbow']), false);
  assert.equal(hasComparablePhase(pairs, ['elbow']), true);
});

test('automatic upload flow suggests a hand only for a unique candidate', () => {
  const one = fixture();
  const unique = suggestSwingPhases(one, '', 1280, 720, rate);
  assert.equal(unique.side, 'right');
  assert.equal(unique.inferred, true);
  assert.ok(unique.boundaries);
  for (const frame of one) frame.landmarks[15] = frame.landmarks[16];
  assert.equal(suggestSwingPhases(one, '', 1280, 720, rate).boundaries, undefined);
  assert.equal(suggestSwingPhases(one, 'left', 1280, 720, rate).side, 'left');
});

test('diagnostics separate visible joints, movement and actual swing candidate coverage', () => {
  const frames = fixture();
  const active = detectSwingPhases(frames, 'right', 1280, 720, rate);
  assert.equal(active.diagnostics.candidates, 1);
  assert.equal(active.diagnostics.boundaryCount, 5);
  assert.equal(active.diagnostics.signals.wrist.visible, frames.length);
  assert.ok(active.diagnostics.signals.wrist.peak > 0);
  assert.equal(active.diagnostics.signals.elbow.visible, 0);
  assert.equal(active.diagnostics.signals.pelvis.peak, 0);
  const still = frames.map((frame, index) => ({ ...frames[0], time: index / rate }));
  const quiet = detectSwingPhases(still, 'right', 1280, 720, rate).diagnostics;
  assert.equal(quiet.code, 'motion');
  assert.equal(quiet.usableSamples, still.length);
  assert.equal(quiet.peakSpeed, 0);
  assert.equal(quiet.candidates, 0);
  assert.equal(detectSwingPhases(frames.slice(0, 8), 'right', 1280, 720, rate).diagnostics.code, 'short');
});

test('diagnostics identify occlusion without erasing other landmarks', () => {
  const frames = fixture();
  frames[9].landmarks[16] = null;
  const result = detectSwingPhases(frames, 'right', 1280, 720, rate).diagnostics;
  assert.equal(result.code, 'reversal-signal');
  assert.equal(result.signals.wrist.visible, frames.length - 1);
  assert.equal(result.signals.shoulders.visible, frames.length);
  assert.ok(result.longestStreak < frames.length);
  assert.equal(suggestSwingPhases(frames, '', 1280, 720, rate).attempts.length, 2);
});

test('extra quiet video duration does not change the candidate or conceal its coverage', () => {
  const shorter = fixture();
  const longer = [...shorter, ...Array.from({ length: 24 }, (_, index) =>
    ({ ...shorter.at(-1), time: (shorter.length + index) / rate }))];
  const a = detectSwingPhases(shorter, 'right', 1280, 720, rate);
  const b = detectSwingPhases(longer, 'right', 1280, 720, rate);
  assert.deepEqual(a.boundaries, b.boundaries);
  assert.equal(b.diagnostics.sampleCount, a.diagnostics.sampleCount + 24);
});
