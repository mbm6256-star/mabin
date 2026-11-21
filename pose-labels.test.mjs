import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAnnotations, phaseIds, validatePhaseDetection } from './pose-labels.mjs';

function fixture(durationSec = 10) {
  const clip = { sha256: '1'.repeat(64), durationSec };
  const value = {
    schemaVersion: 1, labelSource: 'manual', clip,
    metadata: { athleteId: 'player_01', split: 'test', side: 'right', view: 'side', stance: '', fps: 60 },
    phases: Object.fromEntries(phaseIds.map(id => [id, {startSec: null, endSec: null}])),
    events: { lag: { timeSec: null }, impact: { timeSec: 4 } }
  };
  value.phases.backswing = { startSec: 1, endSec: 2 };
  value.phases.forwardSwing = { startSec: 2, endSec: 4 };
  return { clip, value };
}

test('manual JSON round-trips unknowns, events, athlete split and actual and relative times', () => {
  const { value, clip } = fixture();
  const normalized = normalizeAnnotations(value, clip);
  assert.deepEqual(normalized.phases.forwardSwing, {
    startSec: 2, endSec: 4, status: 'labeled', clipProgress: [.2, .4],
    phaseProgress: { start: 0, end: 1, durationSec: 2 }
  });
  assert.equal(normalized.phases.preparation.status, 'unknown');
  assert.equal(normalized.events.lag.timeSec, null);
  assert.equal(normalized.events.impact.status, 'labeled');
  assert.deepEqual(normalizeAnnotations(JSON.parse(JSON.stringify(normalized)), clip), normalized);
  const longer = fixture(20);
  assert.deepEqual(normalizeAnnotations(longer.value, longer.clip).phases.forwardSwing.clipProgress, [.1, .2]);
});

test('import rejects another video, invalid phase ordering, missing event and invalid split metadata', () => {
  const { value, clip } = fixture();
  assert.throws(() => normalizeAnnotations(value, { ...clip, sha256: '2'.repeat(64) }), /일치하지/);
  assert.throws(() => normalizeAnnotations(value, { ...clip, durationSec: 15 }), /일치하지/);
  assert.throws(() => normalizeAnnotations({ ...value, labelSource: 'automatic' }, clip), /수동 라벨/);
  assert.throws(() => normalizeAnnotations({ ...value, events: {} }, clip), /시각/);
  assert.throws(() => normalizeAnnotations({
    ...value, metadata: { ...value.metadata, athleteId: '' }
  }, clip), /선수 ID/);
  value.phases.preparation = { startSec: 0, endSec: 1.5 };
  assert.throws(() => normalizeAnnotations(value, clip), /겹치지/);
});

test('validation separates matched, missed and unlabeled without modifying the manual record', () => {
  const { value, clip } = fixture();
  const normalized = normalizeAnnotations(value, clip);
  const before = structuredClone(normalized);
  const automatic = validatePhaseDetection(normalized.phases, { boundaries: [0, 1.25, 2, 3.5, 5] }, 10);
  assert.equal(automatic.candidate, 'detected');
  assert.deepEqual(automatic.rows[1], { id: 'backswing', result: 'matched', startOffsetMs: 250, endOffsetMs: 0 });
  assert.deepEqual(automatic.rows[2], { id: 'forwardSwing', result: 'matched', startOffsetMs: 0, endOffsetMs: -500 });
  assert.equal(automatic.meanAbsoluteMs, 187.5);
  const missing = validatePhaseDetection(normalized.phases, { reason: 'occluded' }, 10);
  assert.equal(missing.candidate, 'missing');
  assert.deepEqual(missing.rows.map(row => row.result), ['unlabeled', 'missed', 'missed', 'unlabeled']);
  assert.equal(missing.meanAbsoluteMs, null);
  assert.deepEqual(normalized, before);
});
