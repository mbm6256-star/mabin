import { angleBetween, visibilityThreshold } from './pose-metrics.mjs';

export const swingPhases = ['준비 자세', '백스윙', '전방 스윙', '팔로스루'];

function signalPoint(frame, wrist, aspect, scale) {
  const [hand, left, right] = [wrist, 11, 12].map(index => frame.landmarks?.[index]);
  if ([hand, left, right].some(point => !(point?.visibility >= visibilityThreshold &&
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1))) return null;
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
  if (side !== 'left' && side !== 'right') return { reason: '자동 후보를 찾으려면 타구 손을 선택하세요.' };
  const aspect = width / height;
  const torsoSizes = frames.flatMap(frame => {
    const points = [11, 12, 23, 24].map(index => frame.landmarks?.[index]);
    if (points.some(point => !(point?.visibility >= visibilityThreshold &&
        point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1))) return [];
    const [a, b, c, d] = points;
    const length = Math.hypot((a.x + b.x - c.x - d.x) * aspect / 2, (a.y + b.y - c.y - d.y) / 2);
    return length > 0.025 ? [length] : [];
  }).sort((a, b) => a - b);
  const uncertain = { reason: '연속 관절·회전 신호에서 네 구간의 경계를 찾기 어렵습니다. 경계를 영상에서 직접 지정하세요.' };
  const scale = torsoSizes[Math.floor(torsoSizes.length / 2)];
  if (!Number.isFinite(scale) || !Number.isFinite(rate) || rate <= 0 || frames.length < 9) return uncertain;
  const points = frames.map(frame => signalPoint(frame, side === 'right' ? 16 : 15, aspect, scale));
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

  let peak = 0;
  for (let i = 1; i < smoothed.length; i++) {
    if ((smoothed[i]?.speed ?? 0) > (smoothed[peak]?.speed ?? 0)) peak = i;
  }
  const main = smoothed[peak];
  // Heuristic in torso lengths per second; these gates control suggestion coverage.
  if (!main || main.speed < 1.5) return uncertain;
  const projection = value => value.velocity.reduce((sum, coordinate, i) => sum + coordinate * main.velocity[i], 0) / main.speed;
  let reverse = peak - 1;
  while (reverse > 1 && smoothed[reverse] && projection(smoothed[reverse]) > -main.speed * 0.16) reverse--;
  if (!smoothed[reverse] || projection(smoothed[reverse]) > -main.speed * 0.16) return uncertain;
  let back = reverse;
  while (back > 1 && smoothed[back - 1] && projection(smoothed[back - 1]) < -main.speed * 0.16) back--;
  let forward = reverse + 1;
  while (forward < peak && smoothed[forward] && projection(smoothed[forward]) < main.speed * 0.16) forward++;
  let follow = peak + 1;
  while (follow < smoothed.length && smoothed[follow] && smoothed[follow].speed > main.speed * 0.55) follow++;
  let end = follow + 1;
  while (end < smoothed.length && smoothed[end] && smoothed[end].speed > main.speed * 0.23) end++;
  const start = back - 2;
  if (start < 0 || end >= frames.length || !points[start] ||
      smoothed.slice(start + 1, end + 1).some(value => !value) ||
      smoothed[back - 1].speed > main.speed * 0.4 ||
      smoothed.slice(back, follow + 1).reduce((sum, value) => sum + value.turn, 0) < 6 ||
      smoothed.slice(end + 1).some(value => value?.speed > main.speed * 0.75)) return uncertain;
  const boundaries = [start, back, forward, follow, end].map(index => frames[index].time);
  return validSwingBoundaries(boundaries, frames.at(-1).time) ? { boundaries } : uncertain;
}

export function validSwingBoundaries(values, duration) {
  return values.length === 5 && values.every((time, index) => Number.isFinite(time) &&
    time >= 0 && time <= duration && (index === 0 || time > values[index - 1]));
}
