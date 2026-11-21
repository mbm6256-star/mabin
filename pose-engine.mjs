const assetRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const model = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
export const sampleRate = 12;
const visibilityThreshold = 0.5;

function waitForMedia(media, event, signal, action) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const listeners = new AbortController();
    const finish = error => {
      listeners.abort();
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const options = { signal: listeners.signal };
    const fail = () => finish(new Error('영상을 읽을 수 없습니다. 브라우저에서 재생 가능한 MP4를 선택하세요.'));
    const timeout = setTimeout(fail, 12000);
    media.addEventListener(event, () => finish(), options);
    media.addEventListener('error', fail, options);
    signal.addEventListener('abort', () => finish(signal.reason), options);
    try { action(); } catch (error) { finish(error); }
  });
}

function visible(point) {
  return point && point.visibility >= visibilityThreshold &&
    Number.isFinite(point.x) && Number.isFinite(point.y);
}


export function validateClip(file) {
  if (!/\.mp4$/i.test(file.name) || !file.size || file.size > 50 * 1024 * 1024) {
    throw new Error('50MB 이하의 비어 있지 않은 MP4를 선택하세요.');
  }
}

export async function loadClip(video, url, signal) {
  await waitForMedia(video, 'loadedmetadata', signal, () => { video.src = url; });
  if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 30) {
    throw new Error('길이가 30초 이하인 MP4 영상을 선택하세요.');
  }
}

let queue = Promise.resolve();

export function analyzeClip(url, signal, onProgress) {
  const task = queue.then(() => inferClip(url, signal, onProgress));
  queue = task.catch(() => {});
  return task;
}

async function inferClip(url, signal, onProgress) {
  signal.throwIfAborted();
  const decoder = document.createElement('video');
  decoder.muted = true;
  decoder.playsInline = true;
  decoder.preload = 'auto';
  let detector;
  let failure = 'MediaPipe 초기화 오류 · 인터넷 연결을 확인한 뒤 다시 시도하세요.';
  try {
    const { FilesetResolver, PoseLandmarker } = await import(assetRoot + '/vision_bundle.mjs');
    signal.throwIfAborted();
    const assets = await FilesetResolver.forVisionTasks(assetRoot + '/wasm');
    signal.throwIfAborted();
    detector = await PoseLandmarker.createFromOptions(assets, {
      baseOptions: { modelAssetPath: model, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1
    });
    signal.throwIfAborted();
    failure = '영상 파일 오류 · 분석할 영상 프레임을 읽지 못했습니다. 다른 MP4를 선택하세요.';
    await waitForMedia(decoder, 'loadeddata', signal, () => { decoder.src = url; });
    const total = Math.ceil(decoder.duration * sampleRate);
    const frames = [];
    let found = 0;
    onProgress(0, total);
    for (let index = 0; index < total; index++) {
      signal.throwIfAborted();
      const time = index / sampleRate;
      if (index) await waitForMedia(decoder, 'seeked', signal, () => { decoder.currentTime = time; });
      signal.throwIfAborted();
      let result;
      try { result = detector.detectForVideo(decoder, Math.round(time * 1000)); }
      catch { throw new Error('관절 추정 오류 · MediaPipe가 영상 프레임을 분석하지 못했습니다.'); }
      const landmarks = result.landmarks[0];
      const hasPose = landmarks?.length === 33;
      if (hasPose && landmarks.some(visible)) found++;
      frames.push({ time, landmarks: hasPose ? landmarks : null, worldLandmarks: hasPose ? result.worldLandmarks[0] : null });
      onProgress(index + 1, total);
      if (index % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { frames, found, connections: PoseLandmarker.POSE_CONNECTIONS };
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(error.message.startsWith('관절 추정 오류') ? error.message : failure);
  } finally {
    decoder.removeAttribute('src');
    decoder.load();
    detector?.close();
  }
}

export function frameIndex(time, frames) {
  return Math.max(0, Math.min(frames.length - 1, Math.round(time * sampleRate)));
}

export function drawOverlay(canvas, points, connections) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!points) return 0;
  const visiblePoints = points.filter(visible);
  context.strokeStyle = '#9fffe1';
  context.fillStyle = '#d7fb61';
  context.lineWidth = Math.max(2, width / 320);
  context.lineCap = 'round';
  for (const { start, end } of connections) {
    if (!visible(points[start]) || !visible(points[end])) continue;
    context.beginPath();
    context.moveTo(points[start].x * width, points[start].y * height);
    context.lineTo(points[end].x * width, points[end].y * height);
    context.stroke();
  }
  for (const point of visiblePoints) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, context.lineWidth * 1.25, 0, Math.PI * 2);
    context.fill();
  }
  return visiblePoints.length;
}
