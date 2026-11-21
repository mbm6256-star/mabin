import assert from 'node:assert/strict';
import { test } from 'node:test';
import { angleBetween, chartPath, jointAngle, measureFrames, interpretMetric, measurementDifference, pairedSamples, reportSegments, summarizeMetric } from './pose-metrics.mjs';

const point = (x, y, z = 0, visibility = 1) => ({ x, y, z, visibility });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, String(actual));

test('vector angle supports aligned, right and straight joint positions', () => {
  near(angleBetween([1, 0], [1, 0]), 0);
  near(angleBetween([1, 0], [0, 1]), 90);
  near(angleBetween([1, 0], [-1, 0]), 180);
  assert.equal(angleBetween([0, 0], [1, 0]), null);
});

test('joint angle uses the video pixel aspect ratio and rejects invalid joints', () => {
  const points = [point(0.75, 0.75), point(0.5, 0.5), point(0.75, 0.25)];
  near(jointAngle(points, [0, 1, 2], 200, 100), 53.13010235415598);
  assert.equal(jointAngle(points, [0, 1, 2], 0, 100), null);
  points[2] = point(0.75, 0.25, 0, 0.49);
  assert.equal(jointAngle(points, [0, 1, 2], 200, 100), null);
  points[2] = point(1.1, 0.25);
  assert.equal(jointAngle(points, [0, 1, 2], 200, 100), null);
  points[2] = point(NaN, 0.25);
  assert.equal(jointAngle(points, [0, 1, 2], 200, 100), null);
});

const landmarks = [];
for (const [index, x, y] of [
  [11, .2, .2], [12, .8, .2], [13, .2, .4], [14, .8, .4], [15, .4, .4], [16, .8, .5],
  [23, .4, .5], [24, .6, .5], [25, .4, .7], [26, .6, .7], [27, .2, .7], [28, .6, .9]
]) landmarks[index] = point(x, y);

test('measurement selects the hitting elbow and uses the first shared valid axis frame', () => {
  const world = [];
  world[11] = world[23] = point(0, 0);
  world[12] = world[24] = point(1, 0);
  const rotated = world.slice();
  rotated[24] = point(0, 0, 1);
  const frames = [
    { time: 0, landmarks, worldLandmarks: [] },
    { time: 1, landmarks, worldLandmarks: world },
    { time: 2 },
    { time: 3, landmarks, worldLandmarks: rotated }
  ];
  const values = measureFrames(frames, 100, 100, 'left');
  near(values[0].elbow, 90);
  near(values[0].leftKnee, 90);
  near(values[0].rightKnee, 180);
  assert.equal(values[0].pelvis, null);
  near(values[1].pelvis, 0);
  assert.deepEqual(values[2], { time: 2, leftKnee: null, rightKnee: null, elbow: null, pelvis: null, shoulders: null });
  near(values[3].pelvis, 90);
  near(values[3].shoulders, 0);
  near(measureFrames(frames, 100, 100, 'right')[0].elbow, 180);
  assert.equal(measureFrames(frames, 100, 100, '')[0].elbow, null);
});

test('graph breaks at missing values and retains an actual zero', () => {
  const values = [0, 90, null, 45].map((elbow, time) => ({ elbow, time }));
  assert.equal(chartPath(values, 'elbow', time => time, value => value).replace(/ +/g, ' '), 'M0 0 L1 90 M3 45');
});

test('report segments keep time boundaries and missing samples', () => {
  const samples = [{ time: 0, elbow: 0 }, { time: 1, elbow: null }, { time: 2, elbow: 30 }];
  const [, first, middle, last] = reportSegments(samples, 3);
  assert.deepEqual([first, middle, last].map(segment => segment.samples[0].time), [0, 1, 2]);
  assert.deepEqual(summarizeMetric(samples, 'elbow'), { count: 2, total: 3, min: 0, max: 30 });
  assert.deepEqual(summarizeMetric(middle.samples, 'elbow'), { count: 0, total: 1, min: null, max: null });
  assert.deepEqual(summarizeMetric([], 'elbow'), { count: 0, total: 0, min: null, max: null });
});

test('2D joint angle is invariant to image mirroring without swapping anatomical IDs', () => {
  const original = measureFrames([{ time: 0, landmarks }], 200, 100, 'left')[0];
  const mirrored = landmarks.map(joint => ({ ...joint, x: 1 - joint.x }));
  const reflected = measureFrames([{ time: 0, landmarks: mirrored }], 200, 100, 'left')[0];
  near(original.leftKnee, reflected.leftKnee);
  near(original.rightKnee, reflected.rightKnee);
  near(original.elbow, reflected.elbow);
});


test('interpretation compares complete segments and only reports observed endpoints', () => {
  const previous = [{ time: 0, elbow: 10 }, { time: 1, elbow: 20 }];
  const current = [{ time: 2, elbow: 20 }, { time: 3, elbow: 40 }];
  assert.deepEqual(interpretMetric(current, previous, 'elbow'), {
    first: current[0], last: current[1], comparison: { previous: 15, current: 30 }
  });
  const gap = [current[0], { time: 2.5, elbow: null }, current[1]];
  assert.deepEqual(interpretMetric(gap, previous, 'elbow'), {
    first: current[0], last: current[1], comparison: null
  });
  assert.equal(interpretMetric(current, [previous[0]], 'elbow').comparison, null);
  assert.equal(interpretMetric([current[0]], previous, 'elbow').last, null);
  assert.deepEqual(interpretMetric(gap, null, 'leftKnee'), { first: null, last: null, comparison: null });
});


test('manual anchors align fixed seconds over overlap without stretching either clip', () => {
  const a = [0, 1, 2, 3, 4].map(time => ({ time, elbow: time * 10 }));
  const b = [0, 1, 2].map(time => ({ time, elbow: time === 2 ? null : 35 }));
  const pairs = pairedSamples(a, b, 3, 1, 1);
  assert.deepEqual(pairs.map(({ time, a, b }) => [time, a.time, b.time]), [[-1, 2, 0], [0, 3, 1], [1, 4, 2]]);
  assert.deepEqual(pairs.map(pair => measurementDifference(pair, 'elbow')), [15, 5, null]);
});

test('comparison axis baseline uses the selected frame, including missing axes', () => {
  const world = [];
  world[11] = world[23] = point(0, 0);
  world[12] = world[24] = point(1, 0);
  const rotated = world.slice();
  rotated[24] = point(0, 0, 1);
  delete rotated[12];
  const frames = [{ time: 0, landmarks, worldLandmarks: world }, { time: 1, landmarks, worldLandmarks: rotated }];
  const values = measureFrames(frames, 100, 100, 'left', frames[1]);
  near(values[0].pelvis, 90);
  near(values[1].pelvis, 0);
  assert.equal(values[0].shoulders, null);
  assert.equal(values[1].shoulders, null);
});
