// MediaPipe indices for the joints used by the report.
export const visibilityThreshold = 0.5;
const knees = [[23, 25, 27], [24, 26, 28]];
const elbows = { left: [11, 13, 15], right: [12, 14, 16] };

export function angleBetween(a, b) {
  const lengthA = Math.hypot(...a);
  const lengthB = Math.hypot(...b);
  if (!Number.isFinite(lengthA) || !Number.isFinite(lengthB) || lengthA <= 1e-8 || lengthB <= 1e-8) return null;
  const cosine = a.reduce((sum, value, index) => sum + (value / lengthA) * (b[index] / lengthB), 0);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function coordinates(points, indices, axes) {
  const selected = indices.map(index => points?.[index]);
  if (selected.some(point => !(point?.visibility >= visibilityThreshold) ||
      axes.some(axis => !Number.isFinite(point[axis])))) return null;
  return selected.map(point => axes.map(axis => point[axis]));
}

function difference(a, b) {
  return a.map((value, index) => value - b[index]);
}

export function jointAngle(points, indices, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const joints = coordinates(points, indices, ['x', 'y']);
  if (!joints || joints.some(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1)) return null;
  const [a, vertex, b] = joints.map(([x, y]) => [x * width, y * height]);
  return angleBetween(difference(a, vertex), difference(b, vertex));
}

function bodyAxis(frame, indices) {
  const image = coordinates(frame.landmarks, indices, ['x', 'y']);
  if (!image || image.some(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1)) return null;
  const joints = coordinates(frame.worldLandmarks, indices, ['x', 'y', 'z']);
  if (!joints) return null;
  const axis = difference(joints[1], joints[0]);
  return Math.hypot(...axis) > 1e-8 ? axis : null;
}

export function measureFrames(frames, width, height, hittingSide, referenceFrame) {
  let pelvisReference = referenceFrame && bodyAxis(referenceFrame, [23, 24]);
  let shoulderReference = referenceFrame && bodyAxis(referenceFrame, [11, 12]);
  return frames.map(frame => {
    const pelvis = bodyAxis(frame, [23, 24]);
    const shoulders = bodyAxis(frame, [11, 12]);
    if (!referenceFrame && pelvis && shoulders && !pelvisReference) {
      pelvisReference = pelvis;
      shoulderReference = shoulders;
    }
    return {
      time: frame.time,
      leftKnee: jointAngle(frame.landmarks, knees[0], width, height),
      rightKnee: jointAngle(frame.landmarks, knees[1], width, height),
      elbow: Object.hasOwn(elbows, hittingSide) ? jointAngle(frame.landmarks, elbows[hittingSide], width, height) : null,
      pelvis: pelvis && pelvisReference ? angleBetween(pelvisReference, pelvis) : null,
      shoulders: shoulders && shoulderReference ? angleBetween(shoulderReference, shoulders) : null
    };
  });
}

export function chartPath(samples, key, x, y) {
  let connected = false;
  return samples.map(sample => {
    const value = sample[key];
    if (!Number.isFinite(value)) {
      connected = false;
      return '';
    }
    const position = x(sample.time) + ' ' + y(value);
    const command = connected ? 'L' : 'M';
    connected = true;
    return command + position;
  }).join(' ');
}

// Divide by video time so missing detections never move the segment boundaries.
export function reportSegments(samples, duration) {
  const segments = [{ label: '전체 영상', start: 0, end: duration, samples }];
  ['처음 ⅓', '가운데 ⅓', '마지막 ⅓'].forEach((label, index) => {
    const start = duration * index / 3;
    const end = duration * (index + 1) / 3;
    segments.push({ label, start, end, samples: samples.filter(sample =>
      sample.time >= start && (index === 2 ? sample.time <= end : sample.time < end)) });
  });
  return segments;
}

export function summarizeMetric(samples, key) {
  const observed = samples.filter(sample => Number.isFinite(sample[key]));
  const count = observed.length;
  if (!count) return { count, total: samples.length, min: null, max: null };
  const values = observed.map(sample => sample[key]);
  return { count, total: samples.length, min: Math.min(...values), max: Math.max(...values) };
}


export function interpretMetric(samples, previousSamples, key) {
  const observed = samples.filter(sample => Number.isFinite(sample[key]));
  const first = observed[0] ?? null;
  const last = observed.length >= 2 ? observed.at(-1) : null;
  const comparable = previousSamples && samples.length >= 2 && previousSamples.length >= 2 &&
    observed.length === samples.length && previousSamples.every(sample => Number.isFinite(sample[key]));
  const mean = values => values.reduce((sum, sample) => sum + sample[key], 0) / values.length;
  return {
    first, last,
    comparison: comparable ? { previous: mean(previousSamples), current: mean(samples) } : null
  };
}


export function pairedSamples(a, b, anchorA, anchorB, sampleRate) {
  const first = Math.max(-anchorA, -anchorB);
  const last = Math.min(a.length - 1 - anchorA, b.length - 1 - anchorB);
  const result = [];
  for (let offset = first; offset <= last; offset++) {
    result.push({ time: offset / sampleRate, a: a[anchorA + offset], b: b[anchorB + offset] });
  }
  return result;
}

export function measurementDifference(pair, key) {
  const a = pair?.a[key];
  const b = pair?.b[key];
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}
