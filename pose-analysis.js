(() => {
  let engine;
  const engineReady = () => import('./pose-engine.mjs');

  const byId = id => document.getElementById(id);
  const fileInput = byId('pose-file');
  const start = byId('pose-start');
  const status = byId('pose-status');
  let labelTool;
  const preview = byId('pose-preview');
  const progress = byId('pose-progress');
  const video = byId('pose-video');
  const canvas = byId('pose-overlay');
  const quality = byId('pose-quality');
  const context = canvas.getContext('2d');
  let selection;
  let frames = [];
  let connections = [];
  let animation;
  let lastFrame;
  const viewerStatus = byId('pose-3d-status');
  const viewerReset = byId('pose-3d-reset');
  let viewer;
  let viewerModule;
  let viewerLoad;

  async function loadViewer(clip) {
    viewerStatus.textContent = '3D 뷰어를 불러오는 중입니다.';
    try {
      viewerLoad ??= import('./pose-3d.mjs').then(async module => {
        const instance = await module.createPoseViewer(byId('pose-3d-view'), connections, viewerReset, viewerStatus);
        viewerModule = module;
        viewer = instance;
      });
      await viewerLoad;
      if (clip !== selection || !frames.length) return;
      viewerReset.disabled = false;
      lastFrame = undefined;
      draw();
    } catch {
      viewerLoad = undefined;
      if (clip === selection) viewerStatus.textContent = '3D 뷰어를 열 수 없습니다. WebGL 2 지원과 네트워크 연결을 확인하세요.';
    }
  }

  const measurements = byId('pose-measurements');
  const metricsStatus = byId('pose-metrics-status');
  let metricsModule;
  const hittingSide = byId('pose-side');
  const measurementTime = byId('pose-measurement-time');
  const segmentSelect = byId('pose-report-segment');
  const segmentSeek = byId('pose-report-seek');
  const reportRows = byId('pose-report-rows');
  const reportCoverage = byId('pose-report-coverage');
  let segments = [];
  const metrics = [
    ['leftKnee', '왼쪽 무릎', '#22675e'],
    ['rightKnee', '오른쪽 무릎', '#675598'],
    ['elbow', '타구측 팔꿈치', '#934d26'],
    ['pelvis', '골반선 방향 변화', '#22675e'],
    ['shoulders', '어깨선 방향 변화', '#675598']
  ].map(([key, label, color]) => {
    const figure = document.createElement('figure');
    figure.innerHTML = `<figcaption>${label} <span></span></figcaption>
      <svg viewBox="0 0 440 144" role="img" aria-label="${label} 시간 그래프">
        <path d="M34 16 H430 M34 66 H430 M34 116 H430" class="pose-chart-grid"/>
        <text x="2" y="20">180°</text><text x="8" y="70">90°</text><text x="14" y="120">0°</text>
        <text x="34" y="137">0초</text><text x="430" y="137" text-anchor="end"></text>
        <path class="pose-chart-trace" stroke="${color}"/><line class="pose-chart-cursor" y1="16" y2="116"/>
        <circle r="4" fill="${color}"/>
      </svg><small></small>`;
    byId('pose-charts').append(figure);
    return {
      key, label, value: figure.querySelector('figcaption span'), path: figure.querySelector('.pose-chart-trace'),
      cursor: figure.querySelector('line'), dot: figure.querySelector('circle'),
      end: figure.querySelector('text:last-of-type'), note: figure.querySelector('small')
    };
  });
  let measured = [];
  const chartX = time => 34 + 396 * time / video.duration;
  const chartY = angle => 116 - 100 * angle / 180;

  function renderMeasurements(index) {
    const sample = measured[index];
    measurementTime.textContent = sample ? sample.time.toFixed(2) + '초' : '이동 중';
    for (const metric of metrics) {
      const value = sample?.[metric.key];
      const valid = Number.isFinite(value);
      metric.value.textContent = metric.key === 'elbow' && !hittingSide.value ? '타구 손 선택 필요' :
        valid ? value.toFixed(1) + '°' : '측정 불가';
      metric.cursor.style.display = sample ? '' : 'none';
      metric.dot.style.display = valid ? '' : 'none';
      if (!sample) continue;
      const x = chartX(sample.time);
      metric.cursor.setAttribute('x1', x);
      metric.cursor.setAttribute('x2', x);
      if (valid) {
        metric.dot.setAttribute('cx', x);
        metric.dot.setAttribute('cy', chartY(value));
      }
    }
  }

  const evidence = {
    joints: {
      label: 'Pedro 외 (2026) 원문',
      url: 'https://www.mdpi.com/1424-8220/26/7/2244',
      context: '남성 고숙련·중급 선수의 크로스코트 포핸드에서 전신 IMU로 관절 각도 파형을 비교했습니다. 영상 투영각과 연구의 3D 관절각은 측정 방식이 다릅니다.'
    },
    grip: {
      label: 'Elliott 외 (1997) 공식 초록',
      url: 'https://research-repository.uwa.edu.au/en/publications/the-influence-of-grip-position-on-upper-limb-contributions-to-rac/',
      context: '고숙련 선수의 이스턴·웨스턴 그립에서 손 분절의 라켓 속도 기여가 달랐습니다. 팔꿈치 투영각으로 분절의 속도 기여를 판단할 수 없습니다.'
    },
    rotation: {
      label: 'Landlinger 외 (2010) 원문',
      url: 'https://jssm.org/volume09/iss4/cap/jssm-09-643.pdf',
      context: 'ATP 프로와 고숙련 주니어를 400Hz 모션 캡처로 비교했고, 타구 방향에 따라 일부 회전 지표가 달랐습니다. 이 영상의 축 방향 변화에는 기울기도 포함되며, 연구의 분리각이나 임팩트 기준 회전 타이밍과 직접 비교할 수 없습니다.'
    }
  };

  function renderInterpretation(segment, previous) {
    const angle = value => value.toFixed(1) + '°';
    const seconds = value => value.toFixed(2) + '초';
    const entries = metrics.map(({ key, label }) => {
      const { first, last, comparison } = metricsModule.interpretMetric(segment.samples, previous?.samples, key);
      const detail = document.createElement('details');
      const heading = document.createElement('summary');
      heading.textContent = label;
      const observation = document.createElement('p');
      observation.textContent = last
        ? '영상 관찰 · ' + seconds(first.time) + '에 ' + angle(first[key]) + ', ' +
          seconds(last.time) + '에 ' + angle(last[key]) + '가 관측됐습니다.'
        : key === 'elbow' && !hittingSide.value ? '평가 보류 · 타구 손을 선택하세요.' :
          first ? '평가 보류 · ' + seconds(first.time) + '에 ' + angle(first[key]) + '만 관측됐습니다.' :
          '평가 보류 · 이 구간에 사용할 수 있는 관측값이 없습니다.';
      detail.append(heading, observation);
      if (previous) {
        const comparisonNote = document.createElement('p');
        comparisonNote.textContent = comparison
          ? '구간 비교 · ' + previous.label + ' 평균 ' + angle(comparison.previous) + ', ' +
            segment.label + ' 평균 ' + angle(comparison.current) + '.'
          : '구간 비교 보류 · 두 구간에 결측이 없고 각각 두 표본 이상이 필요합니다.';
        detail.append(comparisonNote);
      }
      const sources = key === 'elbow' ? [evidence.joints, evidence.grip] :
        key === 'pelvis' || key === 'shoulders' ? [evidence.rotation] : [evidence.joints];
      for (const source of sources) {
        const context = document.createElement('p');
        const link = document.createElement('a');
        link.href = source.url;
        link.textContent = source.label;
        context.append('연구 맥락 · ' + source.context + ' ', link);
        detail.append(context);
      }
      return detail;
    });
    byId('pose-interpretation').replaceChildren(...entries);
  }


  function renderReport() {
    const selected = Number(segmentSelect.value);
    const segment = segments[selected];
    if (!segment) return;
    const rows = metrics.map(metric => {
      const { count, total, min, max } = metricsModule.summarizeMetric(segment.samples, metric.key);
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = metric.label;
      const measureType = document.createElement('small');
      measureType.textContent = metric.key === 'pelvis' || metric.key === 'shoulders'
        ? '추정 3D 방향 변화' : '2D 투영각';
      heading.append(document.createElement('br'), measureType);
      const observation = document.createElement('td');
      observation.textContent = metric.key === 'elbow' && !hittingSide.value ? '측정 불가 · 타구 손 선택 필요' :
        !count ? '측정 불가' : count === 1 ? '한 시점에서 ' + min.toFixed(1) + '°가 관측됐습니다.' :
          min.toFixed(1) + '°부터 ' + max.toFixed(1) + '°까지 관측됐습니다.';
      const availability = document.createElement('td');
      availability.textContent = count + '/' + total + '개 · 측정 불가 ' + (total - count) + '개';
      row.append(heading, observation, availability);
      return row;
    });
    reportRows.replaceChildren(...rows);
    renderInterpretation(segment, selected > 1 ? segments[selected - 1] : null);
    reportCoverage.textContent = segment.samples.length
      ? '측정 가능 수는 표시할 수 있었던 시점의 개수입니다. 가림, 낮은 관절 가시성, 화면 이탈 등으로 값이 누락될 수 있으며 화면에 표시된 값의 오차는 미산정입니다.'
      : '이 구간에 분석 표본이 없습니다.';
    segmentSeek.disabled = !segment.samples.length;
  }

  function updateReport() {
    const selected = segmentSelect.value;
    segments = metricsModule.reportSegments(measured, video.duration);
    segmentSelect.replaceChildren(...segments.map(({ label, start, end }, index) =>
      new Option(label + ' · ' + start.toFixed(2) + '–' + end.toFixed(2) + '초', index)));
    segmentSelect.value = selected || '0';
    renderReport();
  }

  segmentSelect.addEventListener('change', renderReport);
  segmentSeek.addEventListener('click', () => {
    const first = segments[Number(segmentSelect.value)]?.samples[0];
    if (!first) return;
    video.pause();
    video.currentTime = first.time;
  });


  function updateMeasurements() {
    if (!metricsModule || !frames.length) return;
    const { measureFrames, chartPath } = metricsModule;
    measured = measureFrames(frames, video.videoWidth, video.videoHeight, hittingSide.value);
    measurements.hidden = measured.length === 0;
    if (!measured.length) return;
    updateReport();
    for (const metric of metrics) {
      const count = measured.filter(sample => Number.isFinite(sample[metric.key])).length;
      metric.path.setAttribute('d', chartPath(measured, metric.key, chartX, chartY));
      metric.end.textContent = video.duration.toFixed(1) + '초';
      metric.note.textContent = '표시 가능 ' + count + '/' + measured.length + '개 시점';
    }
    lastFrame = undefined;
    if (video.seeking) renderMeasurements();
    else draw();
  }


  function draw(time = video.currentTime) {
    if (!frames.length || video.seeking) return;
    const index = engine.frameIndex(time, frames);
    const frame = frames[index];
    if (frame === lastFrame) return;
    lastFrame = frame;
    viewer?.show(viewerModule.skeletonFrame(frames, index), frame.time);
    if (measured.length) renderMeasurements(index);
    const count = engine.drawOverlay(canvas, frame.landmarks, connections);
    quality.textContent = count ? '현재 구간 · 관절 ' + count + '/33개 표시' : '현재 구간 · 자세 인식 실패';
  }

  function stopDrawing() {
    if (animation === undefined) return;
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(animation);
    else cancelAnimationFrame(animation);
    animation = undefined;
  }

  function followPlayback() {
    stopDrawing();
    if (!frames.length || video.paused || video.ended) return;
    const update = (_, metadata) => {
      draw(metadata?.mediaTime ?? video.currentTime);
      followPlayback();
    };
    animation = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(update) : requestAnimationFrame(update);
  }

  function clearResult() {
    stopDrawing();
    frames = [];
    labelTool?.setFrames([]);
    lastFrame = undefined;
    context.clearRect(0, 0, canvas.width, canvas.height);
    quality.textContent = '';
    measured = [];
    segments = [];
    segmentSelect.replaceChildren();
    reportRows.replaceChildren();
    byId('pose-interpretation').replaceChildren();
    measurements.hidden = true;
    metricsStatus.hidden = true;
    viewer?.show(null);
    viewerReset.disabled = true;
    viewerStatus.textContent = '분석을 시작하면 3D 골격을 표시합니다.';
  }

  async function selectVideo() {
    labelTool?.select();
    if (selection) {
      selection.controller.abort();
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(selection.url);
      selection = undefined;
    }
    clearResult();
    start.disabled = true;
    preview.hidden = true;
    progress.hidden = true;
    const file = fileInput.files[0];
    if (!file) {
      status.textContent = 'MP4 영상을 선택하세요.';
      return;
    }
    if (!/\.mp4$/i.test(file.name) || !file.size || file.size > 50 * 1024 * 1024) {
      status.textContent = '영상 파일 오류 · 50MB 이하의 비어 있지 않은 MP4를 선택하세요.';
      return;
    }
    const clip = { controller: new AbortController(), url: URL.createObjectURL(file) };
    selection = clip;
    status.textContent = '영상을 확인하는 중입니다.';
    try {
      engine ??= await engineReady();
      await engine.loadClip(video, clip.url, clip.controller.signal);
      if (clip !== selection) return;
      canvas.width = Math.min(video.videoWidth, 1280);
      canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
      preview.hidden = false;
      start.disabled = false;
      status.textContent = '영상 준비가 끝났습니다. 관절 분석을 시작할 수 있습니다.';
      void import('./pose-labels.mjs').then(module => {
        if (clip !== selection) return;
        labelTool ??= module.createLabelTool(byId('pose-label-tool'), video);
        labelTool.select(file);
        labelTool.setFrames(frames);
      }).catch(() => {
        if (clip === selection) status.textContent = '영상 준비 완료 · 수동 라벨 도구를 불러오지 못했습니다.';
      });
    } catch (error) {
      if (clip !== selection) return;
      selection = undefined;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(clip.url);
      fileInput.value = '';
      status.textContent = '영상 파일 오류 · ' + error.message;
    }
  }

  fileInput.addEventListener('change', selectVideo);
  if (fileInput.files.length) selectVideo();

  start.addEventListener('click', async () => {
    const clip = selection;
    if (!clip || start.disabled) return;
    const { signal } = clip.controller;
    clearResult();
    start.disabled = true;
    status.textContent = '관절 분석 모델을 불러오는 중입니다.';
    try {
      const result = await engine.analyzeClip(clip.url, signal, (value, total) => {
        progress.hidden = false;
        progress.max = total;
        progress.value = value;
        status.textContent = '영상에서 관절 위치를 추정하는 중입니다.';
      });
      signal.throwIfAborted();
      frames = result.frames;
      labelTool?.setFrames(frames);
      connections = result.connections;
      status.textContent = result.found
        ? '분석 완료 · ' + frames.length + '개 시점 중 ' + result.found + '개에서 관절을 표시할 수 있습니다.'
        : '표시할 수 있는 관절을 찾지 못했습니다. 한 사람의 전신이 보이는 영상을 선택하세요.';
      draw();
      followPlayback();
      if (!viewer) void loadViewer(clip);
      else viewerReset.disabled = false;
      try {
        metricsModule ??= await import('./pose-metrics.mjs');
        if (clip === selection) updateMeasurements();
      } catch {
        if (clip === selection) {
          measured = [];
          measurements.hidden = true;
          metricsStatus.textContent = '각도 그래프를 불러오지 못했습니다. 관절 표시는 계속 볼 수 있습니다. 로컬 서버를 다시 실행한 뒤 페이지를 새로고침하세요.';
          metricsStatus.hidden = false;
        }
      }
    } catch (error) {
      if (clip === selection) status.textContent = error.message;
    } finally {
      if (clip === selection) {
        progress.hidden = true;
        start.disabled = false;
      }
    }
  });

  hittingSide.addEventListener('change', updateMeasurements);
  video.addEventListener('play', followPlayback);
  video.addEventListener('pause', () => { stopDrawing(); draw(); });
  video.addEventListener('ended', () => { stopDrawing(); draw(); });
  video.addEventListener('seeking', () => {
    viewer?.show(null);
    if (measured.length) renderMeasurements();
    lastFrame = undefined;
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
  video.addEventListener('seeked', () => { draw(); followPlayback(); });
})();
