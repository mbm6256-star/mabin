import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenePoint, skeletonFrame } from './pose-3d.mjs';

function frame(x, visibility = 1) {
  return {
    landmarks: [{ x: 0.6, y: 0.25, visibility }, { x: 0.4, y: 0.25, visibility }],
    worldLandmarks: [{ x, y: -0.4, z: -0.2, visibility }, { x: -x, y: 0.1, z: 0.3, visibility }]
  };
}

test('viewer preserves landmark identity and image-right X while mapping Y and Z', () => {
  assert.deepEqual(scenePoint(frame(0.3), 0), [0.3, 0.4, 0.2]);
  assert.deepEqual(scenePoint(frame(0.3), 1), [-0.3, -0.1, -0.3]);
});

test('unreliable, nonfinite and offscreen joints are omitted', () => {
  assert.equal(scenePoint(frame(0.3, 0.4), 0), null);
  assert.equal(scenePoint(frame(Infinity), 0), null);
  const sample = frame(0.3);
  sample.landmarks[0].x = 1.1;
  assert.equal(scenePoint(sample, 0), null);
});

test('centered smoothing reduces a one-sample spike and preserves gaps and seek order', () => {
  const frames = [frame(0), frame(1), frame(0), {}, frame(0.2)];
  const first = skeletonFrame(frames, 1);
  assert.equal(first.length, 33);
  assert.equal(first[0][0], 0.7);
  assert(skeletonFrame(frames, 3).every(point => point === null));
  assert.equal(skeletonFrame(frames, 4)[0][0], 0.2);
  assert.deepEqual(skeletonFrame(frames, 1), first);
});
