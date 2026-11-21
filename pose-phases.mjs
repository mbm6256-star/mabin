import { angleBetween, visibilityThreshold } from './pose-metrics.mjs';

export const swingPhases = ['준비 자세', '백스윙', '전방 스윙', '팔로스루'];

function visibleImage(point) {
  return point?.visibility >= visibilityThreshold &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function imageCenter(frame, indices) {
  const points = indices.map(index => frame.landmarks?.[index]);
  if (!points.every(visibleImage)) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function imageMotion(frames, indices, aspect) {
  let previous;
  let visible = 0;
  let steps = 0;
  let peak = 0;
  for (const frame of frames) {
    const point = imageCenter(frame, indices);
    if (point) visible++;
    if (point && previous) {
      steps++;
      peak = Math.max(peak, Math.hypot((point.x - previous.x) * aspect, point.y - previous.y));
    }
    previous = point;
  }
  return { visible, steps, peak };
}


function signalPoint(frame, wrist, aspect, scale) {
  const [hand, left, right] = [wrist, 11, 12].map(index => frame.landmarks?.[index]);
  if (![hand, left, right].every(visibleImage)) return null;
  const axis = [
    frame.worldLandmarks?.[11], frame.worldLandmarks?.[12]
  ];
  if (axis.some(point => !(point?.visibility >= visibilityThreshold &&
      [point.x, point.y, point.z].every(Number.isFinite)))) return null;
  const [a, b] = axis;
  const shoulder = [b.x - a.x, b.y - a.y, b.z - a.z];
  if (Math.hypot(...shoulder) < 1e-6) return null;
  return {
    hand: [(hand.x - (left.x + right.x) / 2) * aspect / scale,
      (hand.y - (left.y + right.y) / 2) / scale],
    shoulder
  };
}

export function detectSwingPhases(frames, side, width, height, rate) {
  const diagnostics = { sampleCount: frames.length, rate, candidates: 0, boundaryCount: 0 };
  const reject = (code, reason) => ({
    reason: reason + ' 경계를 영상에서 직접 지정할 수 있습니다.',
    diagnostics: { ...diagnostics, code }
  });
  if (side !== 'left' && side !== 'right') return reject('side', '타구 손을 선택하면 해당 손의 관절 신호를 점검합니다.');
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return reject('sampling', '영상 크기나 분석 표본 간격을 읽을 수 없습니다.');
  }
  const wrist = side === 'right' ? 16 : 15;
  const elbow = side === 'right' ? 14 : 13;
  diagnostics.signals = {
    wrist: imageMotion(frames, [wrist], aspect),
    elbow: imageMotion(frames, [elbow], aspect),
    shoulders: imageMotion(frames, [11, 12], aspect),
    pelvis: imageMotion(frames, [23, 24], aspect)
  };

  const torsoSizes = frames.flatMap(frame => {
    const points = [11, 12, 23, 24].map(index => frame.landmarks?.[index]);
    if (!points.every(visibleImage)) return [];
    const [a, b, c, d] = points;
    const length = Math.hypot((a.x + b.x - c.x - d.x) * aspect / 2, (a.y + b.y - c.y - d.y) / 2);
    return length > 0.025 ? [length] : [];
  }).sort((a, b) => a - b);
  diagnostics.torsoSamples = torsoSizes.length;
  if (frames.length < 9) return reject('short', '분석 표본이 9개 미만이라 네 구간을 제안할 수 없습니다.');
  const scale = torsoSizes[Math.floor(torsoSizes.length / 2)];
  if (!Number.isFinite(scale)) return reject('torso', '어깨와 골반 사이 길이를 추정할 수 있는 표본이 없습니다.');
  const points = frames.map(frame => signalPoint(frame, wrist, aspect, scale));
  let streak = 0;
  diagnostics.usableSamples = 0;
  diagnostics.longestStreak = 0;
  for (const point of points) {
    streak = point ? streak + 1 : 0;
    if (point) diagnostics.usableSamples++;
    diagnostics.longestStreak = Math.max(diagnostics.longestStreak, streak);
  }

  const motion = points.map((point, index) => {
    const previous = points[index - 1];
    if (!point || !previous) return null;
    const velocity = point.hand.map((value, axis) => (value - previous.hand[axis]) * rate);
    const turn = angleBetween(point.shoulder, previous.shoulder);
    return { velocity, speed: Math.hypot(...velocity), turn };
  });
  const smoothed = motion.map((value, index) => {
    const before = motion[index - 1];
    const after = motion[index + 1];
    if (!before || !value || !after) return value;
    const velocity = value.velocity.map((entry, axis) => entry * 0.5 + (before.velocity[axis] + after.velocity[axis]) * 0.25);
    return { velocity, speed: Math.hypot(...velocity), turn: value.turn };
  });

  let peak = -1;
  for (let i = 1; i < smoothed.length; i++) {
    if ((smoothed[i]?.speed ?? -1) > (smoothed[peak]?.speed ?? -1)) peak = i;
  }
  const main = smoothed[peak];
  // Heuristic in torso lengths per second; these gates control suggestion coverage.
  diagnostics.peakSpeed = main?.speed ?? null;
  diagnostics.peakTime = main ? frames[peak].time : null;
  if (!main) return reject('signal', '타구 손목과 양쪽 어깨가 연속으로 관측된 속도 표본이 없습니다.');
  if (main.speed < 1.5) return reject('motion', '몸통 대비 손목 이동이 탐지 기준보다 작습니다.');
  const projection = value => value.velocity.reduce((sum, coordinate, i) => sum + coordinate * main.velocity[i], 0) / main.speed;
  let reverse = peak - 1;
  while (reverse > 1 && smoothed[reverse] && projection(smoothed[reverse]) > -main.speed * 0.16) reverse--;
  if (!smoothed[reverse]) return reject('reversal-signal', '최고 이동 시점 앞에서 연속 관절 신호가 끊겼습니다.');
  if (projection(smoothed[reverse]) > -main.speed * 0.16) {
    return reject('reversal', '가장 빠른 손목 이동 앞에서 반대 방향 움직임을 충분히 찾지 못했습니다.');
  }
  let back = reverse;
  while (back > 1 && smoothed[back - 1] && projection(smoothed[back - 1]) < -main.speed * 0.16) back--;
  let forward = reverse + 1;
  while (forward < peak && smoothed[forward] && projection(smoothed[forward]) < main.speed * 0.16) forward++;
  let follow = peak + 1;
  while (follow < smoothed.length && smoothed[follow] && smoothed[follow].speed > main.speed * 0.55) follow++;
  let end = follow + 1;
  while (end < smoothed.length && smoothed[end] && smoothed[end].speed > main.speed * 0.23) end++;
  const start = back - 2;
  if (start < 0) return reject('preparation', '빠른 움직임 앞의 준비 구간이 짧거나 영상에서 잘렸습니다.');
  if (end >= frames.length) return reject('end', '움직임이 느려지는 끝부분을 영상에서 충분히 확인할 수 없습니다.');
  if (!points[start] || smoothed.slice(start + 1, end + 1).some(value => !value)) {
    return reject('joint-gap', '후보 구간 안에서 손목·어깨 신호가 끊겼습니다. 가림과 화면 이탈을 확인하세요.');
  }
  diagnostics.preparationSpeed = smoothed[back - 1].speed;
  if (diagnostics.preparationSpeed > main.speed * 0.4) {
    return reject('preparation-speed', '백스윙 후보 앞에서 움직임이 충분히 느려지는 준비 표본을 찾지 못했습니다.');
  }
  diagnostics.shoulderTurn = smoothed.slice(back, follow + 1).reduce((sum, value) => sum + value.turn, 0);
  if (diagnostics.shoulderTurn < 6) {
    return reject('shoulder-turn', '후보 구간에서 추정 3D 어깨선의 누적 방향 변화가 탐지 기준에 미치지 못했습니다.');
  }
  if (smoothed.slice(end + 1).some(value => value?.speed > main.speed * 0.75)) {
    return reject('later-motion', '후보 이후에도 큰 움직임이 있어 한 번의 스윙으로 구분하기 어렵습니다.');
  }
  const boundaries = [start, back, forward, follow, end].map(index => frames[index].time);
  if (!validSwingBoundaries(boundaries, frames.at(-1).time)) {
    return reject('boundary-order', '구간 경계가 시간 순서대로 분리되지 않았습니다.');
  }
  return { boundaries, diagnostics: { ...diagnostics, code: 'candidate', candidates: 1, boundaryCount: boundaries.length } };
}

export function validSwingBoundaries(values, duration) {
  return values.length === 5 && values.every((time, index) => Number.isFinite(time) &&
    time >= 0 && time <= duration && (index === 0 || time > values[index - 1]));
}

export function compareSwingBoundaries(automatic, manual, duration) {
  if (!automatic || !manual ||
      !validSwingBoundaries(automatic, duration) || !validSwingBoundaries(manual, duration)) return null;
  const offsets = automatic.map((time, index) => (time - manual[index]) * 1000);
  return {
    offsets,
    meanAbsoluteMs: offsets.reduce((sum, value) => sum + Math.abs(value), 0) / offsets.length
  };
}

function samplesInInterval(samples, [start, end]) {
  return samples.filter(sample => sample.time >= start && sample.time < end);
}

export function pairPhaseProgress(a, b, intervalA, intervalB) {
  const samplesA = samplesInInterval(a, intervalA);
  const samplesB = samplesInInterval(b, intervalB);
  // The smaller sample count bounds the comparison resolution. Use observed samples only.
  const count = Math.min(samplesA.length, samplesB.length);
  const nearest = (samples, [start, end], progress) => {
    const time = start + (end - start) * progress;
    return samples.reduce((best, sample) =>
      Math.abs(sample.time - time) < Math.abs(best.time - time) ? sample : best);
  };
  return Array.from({ length: count }, (_, index) => {
    const time = count === 1 ? 0 : index / (count - 1);
    return { time, a: nearest(samplesA, intervalA, time), b: nearest(samplesB, intervalB, time) };
  });
}

export function automaticPhaseOrder() {
  return [2, 1, 3, 0];
}

export function hasComparablePhase(pairs, keys) {
  return keys.some(key => ['a', 'b'].every(side => new Set(pairs
    .filter(pair => Number.isFinite(pair.a[key]) && Number.isFinite(pair.b[key]))
    .map(pair => pair[side].time)).size >= 2));
}

export function suggestSwingPhases(frames, side, width, height, rate) {
  if (side) return { ...detectSwingPhases(frames, side, width, height, rate), side };
  const attempts = ['left', 'right'].map(hand =>
    ({ ...detectSwingPhases(frames, hand, width, height, rate), side: hand }));
  const candidates = attempts.filter(candidate => candidate.boundaries);
  if (candidates.length === 1) return { ...candidates[0], inferred: true, attempts };
  return { reason: '타구측 후보를 하나로 좁힐 수 없습니다. 타구 손을 선택하거나 경계를 직접 지정하세요.', attempts };
}
