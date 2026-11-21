const jointCount = 33;
const threshold = 0.5;
const leftJoints = new Set([1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
const rightJoints = new Set([4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]);

export function scenePoint(frame, index) {
  const image = frame?.landmarks?.[index];
  const world = frame?.worldLandmarks?.[index];
  if (!(image?.visibility >= threshold && world?.visibility >= threshold) ||
      !(image.x >= 0 && image.x <= 1 && image.y >= 0 && image.y <= 1) ||
      ![world.x, world.y, world.z].every(Number.isFinite)) return null;
  // Preserve image-right X and landmark IDs. Rotate Y-down/Z-away into Y-up/Z-toward.
  return [world.x, -world.y, -world.z];
}

export function skeletonFrame(frames, index) {
  return Array.from({ length: jointCount }, (_, joint) => {
    const point = scenePoint(frames[index], joint);
    if (!point) return null;
    const previous = scenePoint(frames[index - 1], joint);
    const next = scenePoint(frames[index + 1], joint);
    if (!previous || !next) return point;
    // Centered smoothing reduces jitter without adding playback delay or filling gaps.
    return point.map((axis, i) => axis * 0.7 + (previous[i] + next[i]) * 0.15);
  });
}

export async function createPoseViewer(host, connections, reset, status) {
  const [THREE, { OrbitControls }] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js')
  ]);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor('#142c26');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('aria-label', '골반 중심 기준 3D 관절 골격');
  renderer.domElement.setAttribute('role', 'img');
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(0, 0.15, 3.3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 0.5;
  controls.maxDistance = 8;
  controls.update();
  controls.saveState();

  const jointGeometry = new THREE.SphereGeometry(0.018, 10, 8);
  const jointMaterials = ['#f7faf3', '#8be8ff', '#ffc28f'].map(color => new THREE.MeshBasicMaterial({ color }));
  const joints = Array.from({ length: jointCount }, (_, index) => {
    const material = leftJoints.has(index) ? 1 : rightJoints.has(index) ? 2 : 0;
    const joint = new THREE.Mesh(jointGeometry, jointMaterials[material]);
    joint.visible = false;
    scene.add(joint);
    return joint;
  });

  const buffers = new Float32Array(connections.length * 6);
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(buffers, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#d8ede2' }));
  lines.frustumCulled = false;
  scene.add(lines);

  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  const resetView = () => controls.reset();
  reset.addEventListener('click', resetView);
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  });
  observer.observe(host);

  function show(points, time) {
    let count = 0;
    joints.forEach((joint, index) => {
      const point = points?.[index];
      joint.visible = Boolean(point);
      if (point) {
        joint.position.fromArray(point);
        count++;
      }
    });
    let offset = 0;
    for (const { start, end } of connections) {
      if (!points?.[start] || !points[end]) continue;
      buffers.set(points[start], offset);
      buffers.set(points[end], offset + 3);
      offset += 6;
    }
    positions.needsUpdate = true;
    geometry.setDrawRange(0, offset / 3);
    status.textContent = time === undefined ? '3D 골격을 표시할 시점을 기다리는 중입니다.' :
      count ? time.toFixed(2) + '초 · 관절 ' + count + '/33개 표시' : time.toFixed(2) + '초 · 3D 관절 추정 불가';
    render();
  }

  return { show };
}
