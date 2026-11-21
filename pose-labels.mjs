import { detectSwingPhases, swingPhases } from './pose-phases.mjs';
import { sampleRate } from './pose-engine.mjs';

export const phaseIds = ['preparation', 'backswing', 'forwardSwing', 'followThrough'];
const eventIds = ['lag', 'impact'];
const version = 1;
const choices = {
  side: ['', 'right', 'left'],
  view: ['', 'side', 'rear', 'front', 'oblique'],
  stance: ['', 'open', 'semiOpen', 'neutral', 'closed'],
  split: ['', 'train', 'validation', 'test']
};

function boundedTime(value, duration) {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > duration)) {
    throw new Error('모든 시각은 영상 길이 범위 안에서 입력하세요.');
  }
  return value;
}

export function normalizeAnnotations(value, clip) {
  if (!value || value.schemaVersion !== version || value.labelSource !== 'manual') {
    throw new Error('지원하는 수동 라벨 JSON 형식이 아닙니다.');
  }
  if (value.clip?.sha256 !== clip.sha256 || !/^[a-f0-9]{64}$/.test(clip.sha256) ||
      !Number.isFinite(clip.durationSec) || clip.durationSec <= 0 ||
      !Number.isFinite(value.clip?.durationSec) || Math.abs(value.clip.durationSec - clip.durationSec) > .001) {
    throw new Error('JSON의 영상과 현재 선택한 MP4가 일치하지 않습니다.');
  }
  const meta = value.metadata;
  if (!meta || Object.keys(choices).some(key => !choices[key].includes(meta[key])) ||
      typeof meta.athleteId !== 'string' || !/^[A-Za-z0-9_-]{0,64}$/.test(meta.athleteId) ||
      (meta.split && !meta.athleteId) ||
      (meta.fps !== null && (!Number.isFinite(meta.fps) || meta.fps <= 0))) {
    throw new Error('영상 메타데이터를 확인하세요. 데이터 용도를 지정하려면 선수 ID가 필요합니다.');
  }
  const { durationSec } = clip;
  let previous = 0;
  const phases = Object.fromEntries(phaseIds.map(id => {
    const source = value.phases?.[id];
    if (!source) throw new Error('라벨 JSON에 단계 항목이 누락됐습니다.');
    const startSec = boundedTime(source.startSec, durationSec);
    const endSec = boundedTime(source.endSec, durationSec);
    if (startSec !== null && endSec !== null && endSec <= startSec) {
      throw new Error('각 단계의 끝은 시작보다 뒤에 있어야 합니다.');
    }
    for (const time of [startSec, endSec]) {
      if (time === null) continue;
      if (time < previous) throw new Error('스윙 단계는 순서대로 지정하고 서로 겹치지 않게 하세요.');
      previous = time;
    }
    const complete = startSec !== null && endSec !== null;
    return [id, {
      startSec, endSec, status: complete ? 'labeled' : 'unknown',
      clipProgress: [startSec, endSec].map(time => time === null ? null : time / durationSec),
      phaseProgress: complete ? { start: 0, end: 1, durationSec: endSec - startSec } : null
    }];
  }));
  const events = Object.fromEntries(eventIds.map(id => {
    const timeSec = boundedTime(value.events?.[id]?.timeSec, durationSec);
    return [id, { timeSec, status: timeSec === null ? 'unknown' : 'labeled',
      clipProgress: timeSec === null ? null : timeSec / durationSec }];
  }));
  return {
    schemaVersion: version, labelSource: 'manual',
    clip: { sha256: clip.sha256, durationSec },
    metadata: {
      athleteId: meta.athleteId, split: meta.split, side: meta.side, view: meta.view,
      stance: meta.stance, fps: meta.fps
    },
    phases, events
  };
}

export function validatePhaseDetection(phases, detection, durationSec) {
  const boundaries = detection.boundaries;
  const rows = phaseIds.map((id, index) => {
    const manual = phases[id];
    if (manual.startSec === null || manual.endSec === null) return { id, result: 'unlabeled' };
    if (!boundaries) return { id, result: 'missed' };
    return {
      id, result: 'matched',
      startOffsetMs: (boundaries[index] - manual.startSec) * 1000,
      endOffsetMs: (boundaries[index + 1] - manual.endSec) * 1000
    };
  });
  const offsets = rows.filter(row => row.result === 'matched')
    .flatMap(row => [Math.abs(row.startOffsetMs), Math.abs(row.endOffsetMs)]);
  return {
    labelSource: 'manual', predictionSource: 'pose-phases', durationSec, sampleRate,
    candidate: boundaries ? 'detected' : 'missing',
    reason: detection.reason ?? null,
    rows,
    meanAbsoluteMs: offsets.length ? offsets.reduce((sum, value) => sum + value, 0) / offsets.length : null
  };
}

async function fingerprint(file) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createLabelTool(panel, video) {
  const find = selector => panel.querySelector(selector);
  const fields = Object.fromEntries([...panel.querySelectorAll('[data-label-meta]')]
    .map(field => [field.dataset.labelMeta, field]));
  const timeline = find('.label-timeline');
  const playhead = find('.label-playhead');
  const status = find('.label-status');
  const reportView = find('.label-report');
  const exportButton = find('.label-export');
  const importField = find('.label-import');
  const compareButton = find('.label-compare');
  let clip;
  let frames = [];
  let fingerprintPromise;
  let validation;
  let playbackRequest;

  const labels = [...swingPhases, '래깅 (선택)', '임팩트 (선택)'];
  const formats = value => value.toFixed(3) + '초';
  function updatePlayhead() {
    if (!clip) return;
    timeline.value = video.currentTime;
    playhead.textContent = formats(video.currentTime);
  }
  function stopPlayhead() {
    if (playbackRequest !== undefined) cancelAnimationFrame(playbackRequest);
    playbackRequest = undefined;
  }
  function followPlayhead() {
    updatePlayhead();
    if (clip && !video.paused && !video.ended) playbackRequest = requestAnimationFrame(followPlayhead);
    else playbackRequest = undefined;
  }
  video.addEventListener('play', () => { stopPlayhead(); followPlayhead(); });
  for (const name of ['seeked', 'loadedmetadata', 'timeupdate']) video.addEventListener(name, updatePlayhead);
  for (const name of ['pause', 'ended']) video.addEventListener(name, () => { stopPlayhead(); updatePlayhead(); });
  timeline.addEventListener('input', () => { video.pause(); video.currentTime = timeline.valueAsNumber; });

  function invalidateValidation() {
    validation = undefined;
    reportView.replaceChildren();
    compareButton.disabled = !frames.length;
  }

  function makeTimeField(label) {
    const wrapper = document.createElement('div');
    const caption = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.step = 'any';
    input.placeholder = '미확인';
    caption.append(label + ' (초)', input);
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'btn secondary';
    mark.textContent = '현재 시점';
    mark.setAttribute('aria-label', label + '에 현재 영상 시점 기록');
    mark.addEventListener('click', () => {
      video.pause();
      input.value = video.currentTime;
      invalidateValidation();
    });
    wrapper.append(caption, mark);
    return { wrapper, input };
  }

  const rows = labels.map((label, index) => {
    const section = document.createElement('fieldset');
    const title = document.createElement('legend');
    title.textContent = label;
    const timeFields = index < phaseIds.length ? [makeTimeField(label + ' 시작'), makeTimeField(label + ' 끝')]
      : [makeTimeField(label)];
    section.append(title, ...timeFields.map(field => field.wrapper));
    find('.label-boundaries').append(section);
    return timeFields.map(field => field.input);
  });

  const timeValue = field => field.value === '' ? null : field.valueAsNumber;
  panel.addEventListener('input', invalidateValidation);

  function draft(identity) {
    const metadata = Object.fromEntries(Object.entries(fields).map(([key, field]) =>
      [key, key === 'fps' ? timeValue(field) : field.value.trim()]));
    return normalizeAnnotations({
      schemaVersion: version, labelSource: 'manual', clip: identity, metadata,
      phases: Object.fromEntries(phaseIds.map((id, index) => [id, {
        startSec: timeValue(rows[index][0]), endSec: timeValue(rows[index][1])
      }])),
      events: Object.fromEntries(eventIds.map((id, index) => [id, { timeSec: timeValue(rows[phaseIds.length + index][0]) }]))
    }, identity);
  }

  function temporaryIdentity() {
    return { durationSec: clip.durationSec, sha256: '0'.repeat(64) };
  }

  async function verifiedIdentity(current) {
    fingerprintPromise ??= fingerprint(current.file).catch(error => {
      if (clip === current) fingerprintPromise = undefined;
      throw error;
    });
    const sha256 = await fingerprintPromise;
    return { durationSec: current.durationSec, sha256 };
  }

  compareButton.addEventListener('click', () => {
    try {
      const record = draft(temporaryIdentity());
      if (!record.metadata.side) throw new Error('타구 손을 선택한 뒤 자동 결과와 비교하세요.');
      if (!Object.values(record.phases).some(phase => phase.status === 'labeled')) {
        throw new Error('수동 시작과 끝이 확인된 단계가 하나 이상 필요합니다.');
      }
      const detection = detectSwingPhases(frames, record.metadata.side, video.videoWidth, video.videoHeight, sampleRate);
      validation = validatePhaseDetection(record.phases, detection, clip.durationSec);
      const describe = { matched: '탐지 성공', missed: '탐지 누락', unlabeled: '수동 기준 미확인' };
      const header = document.createElement('p');
      header.textContent = (detection.boundaries ? '자동 후보 생성' : '자동 후보 누락 · ' + detection.reason) +
        (validation.meanAbsoluteMs === null ? '' : ' · 경계 평균 절대 차이 ' + Math.round(validation.meanAbsoluteMs) + 'ms');
      const list = document.createElement('ul');
      for (const [index, row] of validation.rows.entries()) {
        const item = document.createElement('li');
        item.textContent = swingPhases[index] + ' · ' + describe[row.result] +
          (row.result === 'matched' ? ' · 시작 ' + Math.round(row.startOffsetMs) +
            'ms / 끝 ' + Math.round(row.endOffsetMs) + 'ms (자동−수동)' : '');
        list.append(item);
      }
      reportView.replaceChildren(header, list);
      status.textContent = '수동 라벨을 기준으로 비교했습니다.';
    } catch (error) { status.textContent = error.message; }
  });

  exportButton.addEventListener('click', async () => {
    const current = clip;
    if (!current) return;
    try {
      const identity = await verifiedIdentity(current);
      if (clip !== current) return;
      const record = draft(identity);
      const blob = new Blob([JSON.stringify({ ...record, validation: validation ?? null }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tennis-lab-labels-' + identity.sha256.slice(0, 12) + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '수동 라벨 JSON을 내보냈습니다.';
    } catch (error) { if (clip === current) status.textContent = error.message; }
  });

  importField.addEventListener('change', async () => {
    const current = clip;
    const file = importField.files[0];
    importField.value = '';
    if (!current || !file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('라벨 JSON은 1MB 이하여야 합니다.');
      let value;
      try { value = JSON.parse(await file.text()); }
      catch { throw new Error('올바른 라벨 JSON 파일을 선택하세요.'); }
      const identity = await verifiedIdentity(current);
      if (clip !== current) return;
      const record = normalizeAnnotations(value, identity);
      for (const [key, field] of Object.entries(fields)) field.value = record.metadata[key] ?? '';
      phaseIds.forEach((id, index) => {
        rows[index][0].value = record.phases[id].startSec ?? '';
        rows[index][1].value = record.phases[id].endSec ?? '';
      });
      eventIds.forEach((id, index) => { rows[phaseIds.length + index][0].value = record.events[id].timeSec ?? ''; });
      invalidateValidation();
      status.textContent = '수동 라벨을 불러왔습니다. 수정하거나 다시 비교할 수 있습니다.';
    } catch (error) { if (clip === current) status.textContent = error.message; }
  });

  return {
    select(file) {
      clip = file ? { file, durationSec: video.duration } : undefined;
      fingerprintPromise = undefined;
      panel.hidden = !clip;
      panel.open = false;
      stopPlayhead();
      for (const field of Object.values(fields)) field.value = '';
      for (const field of rows.flat()) {
        field.value = '';
        field.max = clip?.durationSec ?? '';
      }
      if (clip) {
        timeline.max = clip.durationSec;
        updatePlayhead();
      }
      status.textContent = '미확인 경계와 이벤트는 비워 두세요.';
      this.setFrames([]);
    },
    setFrames(samples) {
      frames = samples;
      invalidateValidation();
    }
  };
}
