import { analyzeClip, drawOverlay, frameIndex, loadClip, sampleRate, validateClip } from './pose-engine.mjs';
import { chartPath, measureFrames, measurementDifference, pairedSamples } from './pose-metrics.mjs';

import { automaticPhaseOrder, compareSwingBoundaries, hasComparablePhase, suggestSwingPhases, pairPhaseProgress, swingPhases, validSwingBoundaries } from './pose-phases.mjs';

const panel = document.getElementById('pose-comparison-panel');
const find = selector => panel.querySelector(selector);
const start = find('#pose-compare-start');
const status = find('#pose-compare-status');
const results = find('#pose-compare-results');
const phaseControls = find('#pose-phase-controls');
const phaseSelect = find('#pose-phase-select');
const cameraView = find('#pose-compare-view');
let alignedPhase = null;
const boundaryLabels = [...swingPhases.map(phase => phase + ' 시작'), '팔로스루 종료'];
const phaseDuration = find('#pose-phase-duration');
for (const [index, label] of swingPhases.entries()) phaseSelect.add(new Option(label, index));
phaseSelect.addEventListener('change', updateComparison);
cameraView.addEventListener('change', updateComparison);
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

function renderPhaseValidation(clip) {
  const output = clip.phaseValidation;
  output.replaceChildren();
  const comparison = compareSwingBoundaries(clip.automaticBoundaries, clip.manualBoundaries, clip.video.duration);
  if (!clip.manualBoundaries) return;
  const summary = document.createElement('p');
  if (!comparison) {
    summary.textContent = '자동 후보가 없어 시간 차이를 계산할 수 없습니다. 수동 경계로 비교할 수 있습니다.';
    output.append(summary);
    return;
  }
  summary.textContent = '자동−수동 평균 절대 차이 ' + Math.round(comparison.meanAbsoluteMs) +
    'ms. 이 영상의 수동 기준과 비교한 값이며 탐지의 검증 정확도를 나타내지 않습니다.';
  const list = document.createElement('ul');
  for (const [index, label] of boundaryLabels.entries()) {
    const item = document.createElement('li');
    const delta = Math.round(comparison.offsets[index]);
    item.textContent = label + ' · 자동 ' + seconds(clip.automaticBoundaries[index]) +
      ' / 수동 ' + seconds(clip.manualBoundaries[index]) + ' · ' + (delta > 0 ? '+' : '') + delta + 'ms';
    list.append(item);
  }
  output.append(summary, list);
}


function renderPhaseDiagnostics(clip, detection) {
  const output = clip.phaseDiagnostics;
  output.replaceChildren();
  const attempts = detection.attempts ?? [detection];
  const context = document.createElement('p');
  context.textContent = '영상 ' + seconds(clip.video.duration) + ' · 분석 ' + clip.frames.length +
    '개 시점 · ' + sampleRate + 'Hz (약 ' + Math.round(1000 / sampleRate) +
    'ms 간격). 원본 FPS는 이 화면에서 측정하지 않습니다.';
  output.append(context);
  for (const attempt of attempts) {
    const d = attempt.diagnostics;
    const title = document.createElement('h4');
    title.textContent = (attempt.side === 'left' ? '왼손' : '오른손') +
      ' 검사 · 후보 ' + d.candidates + '세트 / 경계 ' + d.boundaryCount + '개';
    const reason = document.createElement('p');
    reason.textContent = attempt.reason || '현재 탐지 조건을 통과했습니다. 영상에서 후보를 확인하세요.';
    output.append(title, reason);
    const items = [
      '몸통 보정 가능 ' + d.torsoSamples + '/' + d.sampleCount + '개 표본',
      d.usableSamples === undefined ? '연속 탐지 신호는 계산하지 못했습니다.' :
        '손목·양쪽 어깨 동시 사용 가능 ' + d.usableSamples + '/' + d.sampleCount +
        '개 · 최장 연속 ' + d.longestStreak + '개 표본'
    ];
    if (Number.isFinite(d.peakSpeed)) {
      items.push('최대 손목 상대 이동 ' + d.peakSpeed.toFixed(2) +
        ' 몸통 길이/초 (' + seconds(d.peakTime) + ', 탐지 기준 1.50)');
    }
    if (Number.isFinite(d.shoulderTurn)) {
      items.push('후보 구간 3D 어깨선 누적 방향 변화 ' + d.shoulderTurn.toFixed(1) + '° (탐지 기준 6°)');
    }
    for (const [key, label] of [['wrist', '타구측 손목'], ['elbow', '타구측 팔꿈치'], ['shoulders', '어깨 중심'], ['pelvis', '골반 중심']]) {
      const signal = d.signals?.[key];
      if (!signal) continue;
      items.push(label + ' · 관측 ' + signal.visible + '/' + d.sampleCount +
        '개 · 연속 이동 표본 ' + signal.steps + '쌍' + (signal.steps ?
          ' · 표본 사이 최대 이동 ' + (signal.peak * 100).toFixed(2) + '% (영상 높이 기준)' : ''));
    }
    const list = document.createElement('ul');
    for (const text of items) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    output.append(list);
  }
  const note = document.createElement('p');
  note.textContent = '영상 좌표의 이동량에는 카메라 움직임과 추정 흔들림이 포함될 수 있습니다. 팔꿈치는 참고용이고 골반은 몸통 길이 보정에 쓰입니다. 관절 표시 수와 후보 통과 여부는 별도 지표입니다.';
  output.append(note);
}


function suggestPhases(clip) {
  if (!clip.frames.length) return;
  clip.phaseEditor.hidden = false;
  clip.phaseDiagnostics.closest('details').hidden = false;
  const detection = suggestSwingPhases(
    clip.frames, clip.side.value, clip.video.videoWidth, clip.video.videoHeight, sampleRate);
  const { boundaries, reason, side, inferred } = detection;
  renderPhaseDiagnostics(clip, detection);
  clip.detectedSide = side;
  clip.automaticBoundaries = boundaries;
  if (clip.manualBoundaries) {
    renderPhaseValidation(clip);
    return;
  }
  clip.boundaries = boundaries;
  clip.timeline.hidden = false;
  renderPhaseValidation(clip);
  clip.phaseStatus.textContent = boundaries
    ? (inferred ? '타구 손 후보: ' + (side === 'right' ? '오른손' : '왼손') + ' · ' : '') + '자동 후보입니다. 재생 화면에서 확인할 수 있습니다.'
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
    viewerDetails: get('.compare-3d-panel'), frames: [], connections: []
  };
  clip.input.addEventListener('change', () => void selectClip(clip));
  clip.phaseEditor = get('.compare-phase-editor');
  clip.phaseStatus = get('.compare-phase-status');
  clip.timeline = get('.compare-phase-timeline');
  clip.phaseValidation = get('.compare-phase-validation');
  clip.phaseDiagnostics = get('.compare-phase-diagnostic-output');
  const diagnosticsPanel = get('.compare-phase-diagnostics');
  clip.phaseInputs = boundaryLabels.map((text, index) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.step = 'any';
    label.append((index + 1) + '. ' + text + ' (초)', input);
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'btn secondary';
    mark.textContent = '현재 시점';
    mark.setAttribute('aria-label', text + '에 현재 영상 시점 기록');
    mark.addEventListener('click', () => {
      clip.video.pause();
      input.value = clip.video.currentTime;
    });
    const field = document.createElement('div');
    field.append(label, mark);
    get('.compare-phase-inputs').append(field);
    return input;
  });
  get('.compare-phase-manual').addEventListener('click', () => {
    clip.phaseInputs.forEach(input => { input.value = ''; });
    clip.timeline.hidden = true;
    diagnosticsPanel.hidden = true;
    clip.phaseValidation.replaceChildren();
    clip.boundaries = undefined;
    clip.manualBoundaries = undefined;
    clip.phaseStatus.textContent = '수동 기준 입력 중 · 후보를 가렸습니다.';
    updateComparison();
  });
  get('.compare-phase-apply').addEventListener('click', () => {
    const boundaries = clip.phaseInputs.map(input => input.valueAsNumber);
    if (!validSwingBoundaries(boundaries, clip.video.duration)) {
      clip.phaseStatus.textContent = '영상 길이 안에서 다섯 경계를 시간 순서대로 입력하세요. 적용된 경계는 유지됩니다.';
      return;
    }
    clip.manualBoundaries = boundaries;
    diagnosticsPanel.hidden = false;
    if (phaseSelect.value === '') phaseSelect.value = 'auto';
    clip.boundaries = boundaries;
    clip.timeline.hidden = false;
    renderPhaseValidation(clip);
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
    phaseSelect.value = '';
    updateComparison();
  });
  for (const name of ['seeking', 'seeked', 'timeupdate', 'pause']) {
    clip.video.addEventListener(name, () => renderClip(clip));
  }
  clip.loadViewer = async () => {
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
  };
  clip.viewerDetails.addEventListener('toggle', clip.loadViewer);
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
  clip.manualBoundaries = undefined;
  clip.phaseEditor.hidden = true;
  phaseControls.hidden = true;
  phaseSelect.value = 'auto';
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
      clip.manualBoundaries = undefined;
      clip.phaseEditor.open = false;
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
      void clip.loadViewer();
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

const effectiveSide = clip => clip.side.value || clip.detectedSide || '';

function measurementsFor(clip, index) {
  return measureFrames(clip.frames, clip.video.videoWidth, clip.video.videoHeight, effectiveSide(clip), clip.frames[index]);
}

function alignPhase(phase) {
  if (clips.some(clip => !clip.boundaries)) return null;
  const intervals = clips.map(clip => clip.boundaries.slice(phase, phase + 2));
  const anchors = clips.map((clip, index) =>
    clip.frames.findIndex(frame => frame.time >= intervals[index][0] && frame.time < intervals[index][1]));
  if (anchors.includes(-1)) return null;
  const values = clips.map((clip, index) => measurementsFor(clip, anchors[index]));
  return { phase, intervals, pairs: pairPhaseProgress(...values, ...intervals) };
}

function updateComparison() {
  if (clips.some(clip => !clip.frames.length)) return;
  phaseControls.hidden = false;
  results.hidden = true;
  phaseDuration.hidden = true;
  alignedPhase = null;
  pairs = [];
  const mode = phaseSelect.value;
  const [a, b] = clips;
  if (mode === '') {
    if (clips.some(clip => clip.anchor === undefined)) {
      status.textContent = '수동 기준점 비교 · 두 영상에서 기준점을 각각 지정하세요.';
      return;
    }
    const anchors = clips.map(clip => frameIndex(clip.anchor, clip.frames));
    const values = clips.map((clip, index) => {
      clip.anchorStatus.textContent = '정렬에 사용한 분석 표본 ' + seconds(clip.frames[anchors[index]].time);
      return measurementsFor(clip, anchors[index]);
    });
    pairs = pairedSamples(...values, ...anchors, sampleRate);
  } else {
    if (clips.some(clip => !clip.boundaries)) {
      for (const clip of clips.filter(clip => !clip.boundaries)) clip.phaseEditor.open = true;
    status.textContent = '비교 보류 · ' + clips.filter(clip => !clip.boundaries).map(clip => clip.label).join(', ') +
        '에서 비교에 사용할 스윙 구간을 찾기 어려웠습니다. 각 영상의 스윙 후보 및 수동 경계에서 이유를 확인하세요. 구간 경계를 직접 입력하거나 두 영상에서 같은 동작을 기준점으로 지정하면 수동으로 비교할 수 있습니다.';
      return;
    }
    const keys = charts.map(chart => chart.key).filter(key => key !== 'elbow' || (effectiveSide(a) && effectiveSide(a) === effectiveSide(b)));
    const candidates = mode === 'auto' ? automaticPhaseOrder() : [Number(mode)];
    let aligned;
    for (const candidate of candidates) {
      const trial = alignPhase(candidate);
      if (trial && hasComparablePhase(trial.pairs, keys)) {
        aligned = trial;
        break;
      }
    }
    if (!aligned) {
      status.textContent = '비교 보류 · 양쪽에서 함께 관측된 표본이 부족합니다. 다른 후보 구간이나 수동 기준점을 확인하세요.';
      return;
    }
    alignedPhase = aligned.phase;
    pairs = aligned.pairs;
    const [durationA, durationB] = aligned.intervals.map(([startTime, endTime]) => endTime - startTime);
    phaseDuration.textContent = swingPhases[alignedPhase] + ' · 실제 구간 길이 A ' + seconds(durationA) +
      ' · B ' + seconds(durationB) + ' · 차이(B−A) ' + seconds(durationB - durationA) +
      '. 그래프는 각 구간의 상대 진행률 0–100%에서 가장 가까운 관측 표본을 표시합니다.';
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
  slider.value = alignedPhase === null ? -Math.round(first * sampleRate) : 0;
  slider.disabled = pairs.length < 2;
  results.hidden = false;
  const phaseSource = clips.every(clip => !clip.manualBoundaries) ? '자동 후보' :
    clips.every(clip => clip.manualBoundaries) ? '수동 경계' : '자동 후보와 수동 경계';
  status.textContent = (alignedPhase === null
    ? '기준점 정렬 · ' + seconds(first) + ' ~ ' + seconds(pairs.at(-1).time)
    : phaseSource + ' 정렬 · ' + swingPhases[alignedPhase] + ' · 상대 진행률 0–100%') +
    (!effectiveSide(a) || !effectiveSide(b) ? ' · 팔꿈치 비교에 타구 손 선택이 필요합니다.' :
      effectiveSide(a) !== effectiveSide(b) ? ' · 타구 손이 달라 팔꿈치 차이 표시는 보류합니다.' : '') +
    (clips.some(clip => !clip.side.value && clip.detectedSide) ? ' · 자동 추정한 타구 손을 영상별 후보에서 확인하세요.' : '') +
    (cameraView.value === 'different' ? ' · 촬영 방향이 달라 각도 차이 표시는 보류합니다.' :
      cameraView.value === '' ? ' · 촬영 방향 미확인. 직접 비교에 주의하세요.' : '');
  seekPair();
}

function difference(pair, key) {
  const [a, b] = clips;
  if (cameraView.value === 'different') return null;
  if (key === 'elbow' && (!effectiveSide(a) || effectiveSide(a) !== effectiveSide(b))) return null;
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
  const timeLabel = alignedPhase === null ? '상대 ' + seconds(pair.time) :
    '구간 진행률 ' + (100 * pair.time).toFixed(0) + '%';
  position.textContent = timeLabel + ' · A ' + seconds(pair.a.time) + ' · B ' + seconds(pair.b.time);
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
