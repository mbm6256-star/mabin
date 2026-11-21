import { analyzeClip, drawOverlay, frameIndex, loadClip, sampleRate, validateClip } from './pose-engine.mjs';
import { chartPath, measureFrames, measurementDifference, pairedSamples } from './pose-metrics.mjs';

import { detectSwingPhases, swingPhases, validSwingBoundaries } from './pose-phases.mjs';

const panel = document.getElementById('pose-comparison-panel');
const find = selector => panel.querySelector(selector);
const start = find('#pose-compare-start');
const status = find('#pose-compare-status');
const results = find('#pose-compare-results');
const phaseControls = find('#pose-phase-controls');
const phaseSelect = find('#pose-phase-select');
const phaseDuration = find('#pose-phase-duration');
for (const [index, label] of swingPhases.entries()) phaseSelect.add(new Option(label, index));
phaseSelect.addEventListener('change', () => {
  if (clips.every(clip => clip.frames.length)) updateComparison();
});
const slider = find('#pose-compare-time');
const position = find('#pose-compare-position');
const format = value => value.toFixed(1) + '°';
const seconds = value => value.toFixed(2) + '초';
let job;
let pairs = [];

const charts = [
  ['leftKnee', '왼쪽 무릎'], ['rightKnee', '오른쪽 무릎'],
  ['elbow', '타구측 팔꿈치'], ['pelvis', '골반선 방향 변화'], ['shoulders', '어깨선 방향 변화']
].map(([key, label]) => {
  const figure = document.createElement('figure');
  figure.innerHTML = `<figcaption>${label}</figcaption><svg viewBox="0 0 420 125" role="img" aria-label="${label}의 A·B 비교">
    <path class="pose-chart-grid" d="M35 10H411 M35 56H411 M35 102H411"/>
    <text x="0" y="15">180°</text><text x="7" y="60">90°</text><text x="14" y="107">0°</text>
    <path class="pose-chart-trace compare-a"/><path class="pose-chart-trace compare-b"/>
    <path class="compare-available"/><line class="pose-chart-cursor" y1="10" y2="116"/>
    </svg><p></p><small></small>`;
  find('#pose-compare-charts').append(figure);
  return {
    key, a: figure.querySelector('.compare-a'), b: figure.querySelector('.compare-b'),
    availability: figure.querySelector('.compare-available'), cursor: figure.querySelector('line'),
    values: figure.querySelector('p'), coverage: figure.querySelector('small')
  };
});

function renderClip(clip) {
  const { video, canvas, frames } = clip;
  const index = frameIndex(video.currentTime, frames);
  const frame = video.seeking ? undefined : frames[index];
  if (frame === clip.lastFrame) return;
  clip.lastFrame = frame;
  const count = drawOverlay(canvas, frame?.landmarks, clip.connections);
  clip.poseStatus.textContent = frame
    ? seconds(frame.time) + ' · ' + (count ? '관절 ' + count + '/33개 표시' : '관절 추정 불가') : '';
  if (clip.viewer) clip.viewer.show(frame ? clip.viewerModule.skeletonFrame(frames, index) : null, frame?.time);
}

function updatePhaseTimeline(clip) {
  const boundaries = clip.boundaries;
  clip.timeline.replaceChildren();
  if (!boundaries) return;
  for (const [index, label] of swingPhases.entries()) {
    const startTime = boundaries[index];
    const endTime = boundaries[index + 1];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(index + 1);
    button.title = label + ' · ' + seconds(startTime) + '–' + seconds(endTime);
    button.setAttribute('aria-label', button.title);
    button.style.left = 100 * startTime / clip.video.duration + '%';
    button.style.width = 100 * (endTime - startTime) / clip.video.duration + '%';
    button.addEventListener('click', () => {
      clip.video.pause();
      clip.video.currentTime = startTime;
    });
    clip.timeline.append(button);
  }
}

function suggestPhases(clip) {
  if (!clip.frames.length) return;
  clip.phaseEditor.hidden = false;
  const { boundaries, reason } = detectSwingPhases(
    clip.frames, clip.side.value, clip.video.videoWidth, clip.video.videoHeight, sampleRate);
  clip.boundaries = boundaries;
  clip.phaseStatus.textContent = boundaries
    ? '자동 후보입니다. 재생 화면을 확인하고 필요하면 초 단위 경계를 수정하세요.'
    : reason;
  clip.phaseInputs.forEach((input, index) => {
    input.max = clip.video.duration;
    input.value = boundaries ? Number(boundaries[index].toFixed(3)) : '';
  });
  updatePhaseTimeline(clip);
}

function makeClip(label) {
  const element = find('#pose-compare-clip').content.firstElementChild.cloneNode(true);
  element.querySelector('h3').textContent = label;
  find('#pose-compare-clips').append(element);
  const get = selector => element.querySelector(selector);
  const clip = {
    label, input: get('input'), side: get('select'), video: get('video'), canvas: get('canvas'),
    fileStatus: get('.compare-file-status'), poseStatus: get('.compare-pose-status'),
    anchorStatus: get('.compare-anchor-status'), preview: get('.compare-preview'),
    viewerDetails: get('details'), frames: [], connections: []
  };
  clip.input.addEventListener('change', () => void selectClip(clip));
  clip.phaseEditor = get('.compare-phase-editor');
  clip.phaseStatus = get('.compare-phase-status');
  clip.timeline = get('.compare-phase-timeline');
  clip.phaseInputs = [...swingPhases.map(phase => phase + ' 시작'), '팔로스루 종료'].map((text, index) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.step = 'any';
    label.append((index + 1) + '. ' + text + ' (초)', input);
    get('.compare-phase-inputs').append(label);
    return input;
  });
  get('.compare-phase-apply').addEventListener('click', () => {
    const boundaries = clip.phaseInputs.map(input => input.valueAsNumber);
    if (!validSwingBoundaries(boundaries, clip.video.duration)) {
      clip.phaseStatus.textContent = '영상 길이 안에서 다섯 경계를 시간 순서대로 입력하세요. 적용된 경계는 유지됩니다.';
      return;
    }
    clip.boundaries = boundaries;
    clip.phaseStatus.textContent = '직접 지정한 경계를 적용했습니다.';
    updatePhaseTimeline(clip);
    updateComparison();
  });
  clip.side.addEventListener('change', () => {
    suggestPhases(clip);
    updateComparison();
  });
  get('.compare-anchor').addEventListener('click', () => {
    clip.video.pause();
    clip.anchor = clip.video.currentTime;
    clip.anchorStatus.textContent = '지정 위치 ' + seconds(clip.anchor);
    updateComparison();
  });
  for (const name of ['seeking', 'seeked', 'timeupdate', 'pause']) {
    clip.video.addEventListener(name, () => renderClip(clip));
  }
  clip.viewerDetails.addEventListener('toggle', async () => {
    if (!clip.viewerDetails.open || clip.viewer || clip.viewerLoading || !clip.frames.length) return;
    clip.viewerLoading = true;
    try {
      clip.viewerModule = await import('./pose-3d.mjs');
      clip.viewer = await clip.viewerModule.createPoseViewer(
        get('.compare-3d-view'), clip.connections, get('.compare-reset'), get('.compare-3d-status'));
      clip.lastFrame = null;
      renderClip(clip);
    } catch {
      get('.compare-3d-status').textContent = '3D 뷰어를 열 수 없습니다. WebGL 2와 네트워크 연결을 확인하세요.';
    } finally {
      clip.viewerLoading = false;
    }
  });
  return clip;
}

const clips = [makeClip('A · 이전 영상'), makeClip('B · 현재 영상')];

function updateStart() {
  start.disabled = Boolean(job) || clips.some(clip => !clip.ready);
}

async function selectClip(clip) {
  job?.abort();
  clip.source?.abort();
  clip.ready = false;
  clip.video.pause();
  clip.video.removeAttribute('src');
  clip.video.load();
  if (clip.url) URL.revokeObjectURL(clip.url);
  clip.url = undefined;
  clip.frames = [];
  clip.anchor = undefined;
  clip.boundaries = undefined;
  clip.phaseEditor.hidden = true;
  phaseControls.hidden = true;
  phaseSelect.value = '';
  clip.anchorStatus.textContent = '';
  clip.viewerDetails.open = false;
  renderClip(clip);
  clip.preview.hidden = true;
  results.hidden = true;
  pairs = [];
  updateStart();
  status.textContent = '두 영상을 준비한 뒤 분석하세요.';
  const file = clip.input.files[0];
  if (!file) {
    clip.fileStatus.textContent = '영상을 선택하세요.';
    return;
  }
  const source = new AbortController();
  clip.source = source;
  try {
    validateClip(file);
    clip.fileStatus.textContent = '영상을 확인하는 중입니다.';
    clip.url = URL.createObjectURL(file);
    await loadClip(clip.video, clip.url, source.signal);
    source.signal.throwIfAborted();
    clip.canvas.width = Math.min(clip.video.videoWidth, 960);
    clip.canvas.height = Math.max(1, Math.round(clip.canvas.width * clip.video.videoHeight / clip.video.videoWidth));
    clip.preview.hidden = false;
    clip.ready = true;
    clip.fileStatus.textContent = '영상 준비 완료';
  } catch (error) {
    if (!source.signal.aborted) {
      if (clip.url) URL.revokeObjectURL(clip.url);
      clip.url = undefined;
      clip.video.removeAttribute('src');
      clip.video.load();
      clip.input.value = '';
      clip.fileStatus.textContent = '영상 파일 오류 · ' + error.message;
    }
  } finally {
    updateStart();
  }
}

start.addEventListener('click', async () => {
  if (start.disabled) return;
  const controller = new AbortController();
  job = controller;
  updateStart();
  results.hidden = true;
  pairs = [];
  try {
    for (const clip of clips) {
      clip.frames = [];
      clip.boundaries = undefined;
      clip.phaseEditor.hidden = true;
      phaseControls.hidden = true;
      clip.viewerDetails.open = false;
      renderClip(clip);
    }
    for (const clip of clips) {
      status.textContent = clip.label + ' 분석 준비 중';
      const data = await analyzeClip(clip.url, controller.signal, (value, total) => {
        if (!controller.signal.aborted) status.textContent = clip.label + ' 분석 중 · ' + value + '/' + total;
      });
      controller.signal.throwIfAborted();
      clip.frames = data.frames;
      clip.connections = data.connections;
      suggestPhases(clip);
      clip.fileStatus.textContent = '분석 완료 · 관절 표시 가능 ' + data.found + '/' + data.frames.length + '개 시점';
      renderClip(clip);
    }
    updateComparison();
  } catch (error) {
    if (!controller.signal.aborted) status.textContent = error.message;
  } finally {
    job = undefined;
    updateStart();
  }
});

const x = (time, first, span) => 35 + (span ? 376 * (time - first) / span : 188);
const y = value => 102 - 92 * value / 180;

function updateComparison() {
  if (clips.some(clip => !clip.frames.length)) return;
  phaseControls.hidden = false;
  results.hidden = true;
  phaseDuration.hidden = true;
  const phase = phaseSelect.value === '' ? null : Number(phaseSelect.value);
  if (phase === null && clips.some(clip => clip.anchor === undefined)) {
    status.textContent = '두 영상의 기준 시점을 각각 지정하거나 스윙 후보 구간을 선택하세요.';
    return;
  }
  if (phase !== null && clips.some(clip => !clip.boundaries)) {
    status.textContent = '비교 보류 · 양쪽 영상에서 후보를 확인하거나 경계를 직접 지정하세요.';
    return;
  }
  const [a, b] = clips;
  const intervals = phase === null ? null : clips.map(clip => clip.boundaries.slice(phase, phase + 2));
  const anchors = clips.map((clip, index) => intervals
    ? clip.frames.findIndex(frame => frame.time >= intervals[index][0] && frame.time < intervals[index][1])
    : frameIndex(clip.anchor, clip.frames));
  if (anchors.includes(-1)) {
    status.textContent = '비교 보류 · 선택 구간에 양쪽의 분석 표본이 필요합니다.';
    return;
  }
  const values = clips.map((clip, index) => {
    const reference = clip.frames[anchors[index]];
    if (!intervals) clip.anchorStatus.textContent = '정렬에 사용한 분석 표본 ' + seconds(reference.time);
    return measureFrames(clip.frames, clip.video.videoWidth, clip.video.videoHeight, clip.side.value, reference);
  });
  pairs = pairedSamples(...values, ...anchors, sampleRate);
  if (intervals) {
    pairs = pairs.filter(pair => pair.time >= 0 && pair.a.time < intervals[0][1] && pair.b.time < intervals[1][1]);
    const [durationA, durationB] = intervals.map(([startTime, endTime]) => endTime - startTime);
    phaseDuration.textContent = swingPhases[phase] + ' · 지정 구간 길이 A ' + seconds(durationA) +
      ' · B ' + seconds(durationB) + ' · 차이(B−A) ' + seconds(durationB - durationA) +
      '. 관절 그래프는 구간 내 첫 분석 표본부터 겹치는 시간만 표시합니다.';
    phaseDuration.hidden = false;
  }
  const first = pairs[0].time;
  const span = pairs.at(-1).time - first;
  const chartX = time => x(time, first, span);
  for (const chart of charts) {
    for (const side of ['a', 'b']) {
      chart[side].setAttribute('d', chartPath(pairs.map(pair => ({ ...pair[side], time: pair.time })), chart.key, chartX, y));
    }
    const available = pairs.map(pair => ({
      time: pair.time, value: difference(pair, chart.key) === null ? null : 0
    }));
    const halfStep = span ? Math.min(3, 188 / (pairs.length - 1)) : 3;
    chart.availability.setAttribute('d', available.filter(sample => sample.value !== null)
      .map(sample => 'M' + (chartX(sample.time) - halfStep) + ' 115h' + 2 * halfStep).join(' '));
    const count = available.filter(sample => sample.value !== null).length;
    chart.coverage.textContent = '비교 가능 ' + count + '/' + pairs.length + '개 · 부족 ' + (pairs.length - count) + '개';
  }
  slider.min = 0;
  slider.max = pairs.length - 1;
  slider.value = -Math.round(first * sampleRate);
  slider.disabled = pairs.length < 2;
  results.hidden = false;
  status.textContent = '겹치는 분석 시간 ' + seconds(first) + ' ~ ' + seconds(pairs.at(-1).time) +
    (!a.side.value || !b.side.value ? ' · 팔꿈치 비교에 타구 손 선택이 필요합니다.' :
      a.side.value !== b.side.value ? ' · 타구 손이 달라 팔꿈치 차이 표시는 보류합니다.' : '');
  seekPair();
}

function difference(pair, key) {
  const [a, b] = clips;
  if (key === 'elbow' && (!a.side.value || a.side.value !== b.side.value)) return null;
  return measurementDifference(pair, key);
}

function seekPair() {
  const pair = pairs[Number(slider.value)];
  if (!pair) return;
  clips.forEach((clip, index) => {
    clip.video.pause();
    const time = index ? pair.b.time : pair.a.time;
    if (Math.abs(clip.video.currentTime - time) > 0.001) clip.video.currentTime = time;
    renderClip(clip);
  });
  position.textContent = '상대 ' + seconds(pair.time) + ' · A ' + seconds(pair.a.time) + ' · B ' + seconds(pair.b.time);
  for (const chart of charts) {
    const valueA = pair.a[chart.key];
    const valueB = pair.b[chart.key];
    const delta = difference(pair, chart.key);
    const next = x(pair.time, pairs[0].time, pairs.at(-1).time - pairs[0].time);
    chart.cursor.setAttribute('x1', next);
    chart.cursor.setAttribute('x2', next);
    chart.values.textContent = 'A ' + (Number.isFinite(valueA) ? format(valueA) : '측정 불가') +
      ' · B ' + (Number.isFinite(valueB) ? format(valueB) : '측정 불가') +
      ' · B−A ' + (delta === null ? '비교 보류' : (delta > 0 ? '+' : '') + format(delta));
  }
}

slider.addEventListener('input', seekPair);
for (const clip of clips) if (clip.input.files.length) void selectClip(clip);
