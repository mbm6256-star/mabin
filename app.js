'use strict';
const $ = id => document.getElementById(id);
const KEY = 'tennis-lab-demo-reports-v2';
let data, currentReport = null, storageAvailable = true, loading = false;
let saving = false, writeConfig = {matchWritesEnabled:false};
const demoAnalysis = { elbow:112, knee:138, summary:'준비 자세와 임팩트 구간에서 팔꿈치·무릎의 변화를 살펴보세요. 이 값은 고정 샘플이며 선택한 영상에서 측정한 값이 아닙니다. 자세의 좋고 나쁨을 판정하지 않습니다.' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const nameOf = id => data.players.find(p => p.id === id)?.name || '알 수 없는 선수';
const rateOf = p => p.played ? p.rate.toFixed(1) + '%' : '—';
const formatDate = iso => new Date(iso).toLocaleString('ko-KR');
const scoreText = (m, reverse = false) => m.sets.map(s => (reverse ? [...s].reverse() : s).join('-')).join(', ');
function status(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
function commit(next) {
  if (storageAvailable) {
    try { localStorage.setItem(KEY, JSON.stringify(next.reports)); }
    catch { throw Error('브라우저 저장에 실패했습니다. 변경을 반영하지 않았습니다. 저장 공간·브라우저 설정을 확인해주세요.'); }
  }
  data = next;
  if (!storageAvailable) status('global-status', '브라우저 저장소를 사용할 수 없어 메모리에서만 작동합니다. 새로고침하면 변경 내용이 사라집니다.', true);
  render();
}
function updatePlayers() {
  document.querySelectorAll('select.players').forEach(select => {
    const previous = select.value;
    select.replaceChildren();
    data.players.forEach(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.memberCode ? p.name + ' · ' + p.memberCode : p.name; select.append(option); });
    if (data.players.some(p => p.id === previous)) select.value = previous;
  });
}
function matchTable(matches, playerId = null) {
  if (!matches.length) return '<p class="empty">DB에 조회된 경기 기록이 없습니다.</p>';
  return `<div class="tablewrap"><table><caption>${playerId ? esc(nameOf(playerId)) + '의 경기 기록' : '단식 경기 결과'}</caption><thead><tr><th>경기일</th><th>선수 A / 선수 B</th><th>${playerId ? '내 점수 − 상대 점수' : 'A − B 세트별 점수'}</th><th>${playerId ? '내 결과' : '승자'}</th></tr></thead><tbody>${[...matches].sort((a, b) => b.date.localeCompare(a.date)).map(m => {
    const wonA = Tennis.validateSets(m.sets).a === 2;
    const winner = wonA ? m.a : m.b;
    return `<tr><td>${esc(m.date)}</td><td>${esc(nameOf(m.a))} / ${esc(nameOf(m.b))}</td><td>${scoreText(m, playerId === m.b)}</td><td>${playerId ? (winner === playerId ? '승' : '패') : esc(nameOf(winner))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function metric(label, value) { return `<div class="card"><div class="metric-label">${label}</div><div class="number">${value}</div></div>`; }
function renderRanking(rows) {
  if (!rows.length) { $('ranking-table').innerHTML = '<p class="empty">DB에 등록된 선수가 없어 랭킹을 표시할 수 없습니다.</p>'; return; }
  const key = $('sort').value, direction = $('direction').value === 'desc' ? -1 : 1;
  const sorted = [...rows].sort((a, b) => {
    if (key === 'rank') {
      if (a.rank === null || b.rank === null) return a.rank === b.rank ? a.name.localeCompare(b.name, 'ko') : a.rank === null ? 1 : -1;
      return (a.rank - b.rank) * -direction || a.name.localeCompare(b.name, 'ko');
    }
    return (a[key] - b[key]) * direction || a.name.localeCompare(b.name, 'ko');
  });
  $('ranking-table').innerHTML = `<table><caption>Supabase DB 경기 결과 집계 · 정렬을 바꾸어도 순위 산식은 유지됩니다.</caption><thead><tr><th>순위</th><th>선수</th><th>경기</th><th>승 / 패</th><th>승률</th><th>세트 득 / 실</th><th>득실 차</th><th>기록</th></tr></thead><tbody>${sorted.map(p => `<tr><td>${p.rank ?? '미경기'}</td><td>${esc(p.name)}</td><td>${p.played}</td><td>${p.wins} / ${p.losses}</td><td>${rateOf(p)}</td><td>${p.setsFor} / ${p.setsAgainst}</td><td>${p.diff > 0 ? '+' : ''}${p.diff}</td><td><button class="btn secondary" data-profile="${esc(p.id)}" aria-label="${esc(p.name)} 개인 기록 보기">보기</button></td></tr>`).join('')}</tbody></table>`;
}
function renderDashboard(rows) {
  const p = rows.find(p => p.id === $('profile').value);
  if (!p) { $('dashboard-content').innerHTML = '<p class="empty">DB에 등록된 선수가 없습니다.</p>'; return; }
  const matches = data.matches.filter(m => m.a === p.id || m.b === p.id).sort((a, b) => a.date.localeCompare(b.date));
  let wins = 0;
  const trend = matches.map((m, i) => {
    if ((Tennis.validateSets(m.sets).a === 2 ? m.a : m.b) === p.id) wins++;
    return { date: m.date, value: wins / (i + 1) * 100 };
  });
  const reports = data.reports.filter(r => r.playerId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('dashboard-content').innerHTML = `<h2>${esc(p.name)}의 기록</h2><div class="metric-cards">${metric('경기 수', p.played)}${metric('승 / 패', `${p.wins} / ${p.losses}`)}${metric('승률', rateOf(p))}${metric('세트 득 / 실', `${p.setsFor} / ${p.setsAgainst}`)}</div><div class="grid sectiongap"><article class="card"><h2>경기별 누적 승률</h2><p class="muted">경기일 순서 · 같은 날짜는 등록 순서. 경기 성적 변화이며 자세 개선의 증거가 아닙니다.</p>${trend.length ? `<div class="chart" role="img" aria-label="${esc(trend.map(t => t.date + ' ' + t.value.toFixed(1) + '%').join(', '))}">${trend.map(t => `<div class="chart-col"><span class="chart-label">${t.value.toFixed(1)}%</span><div class="bar" style="height:${Math.max(2, t.value)}px"></div><small>${esc(t.date.slice(5))}</small></div>`).join('')}</div>` : '<p class="empty">경기 기록이 없어 성장 추이를 표시하지 않습니다.</p>'}<h3 class="sectiongap">개인 경기 이력</h3>${matchTable(matches, p.id)}</article><article class="card"><h2>저장된 포핸드 데모 결과</h2><p class="muted">고정 샘플이며 실제 영상 측정 결과가 아닙니다. 원본 영상은 보관하지 않습니다.</p>${reports.length ? reports.map(r => `<div class="report-item"><span class="badge">샘플 리포트</span><p>${esc(formatDate(r.createdAt))}</p><p>팔꿈치 ${r.elbow}° · 무릎 ${r.knee}°</p><button class="btn secondary" data-report="${esc(r.id)}">저장 결과 보기</button></div>`).join('') : '<p class="empty">저장된 결과가 없습니다. 영상 분석 화면에서 데모를 저장해보세요.</p>'}<a class="btn secondary" href="#analysis">분석 데모로 →</a></article></div>`;
}
function render() {
  updatePlayers();
  for (const id of ['analysis-player','profile','analyze','demo']) $(id).disabled = !data.players.length;
  const rows = Tennis.stats(data.players, data.matches);
  $('club-name').textContent = data.club;
  $('home-metrics').innerHTML = metric('DB 등록 회원·선수', data.players.length) + metric('DB 완료된 단식 경기', data.matches.length) + metric('이 브라우저의 데모 리포트', data.reports.length);
  $('home-matches').innerHTML = matchTable([...data.matches].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3));
  $('match-list').innerHTML = matchTable(data.matches);
  $('members').innerHTML = data.players.length ? '<p class="muted">DB 등록 선수 ' + data.players.length + '명</p><ul class="list">' + data.players.map(p => `<li>${esc(p.name)} <small>${esc(p.memberCode)}</small></li>`).join('') + '</ul>' : '<p class="empty">DB에 등록된 선수가 없습니다.</p>';
  renderRanking(rows); renderDashboard(rows);
  updateMatchForm();
}
function updateMatchForm() {
  $('match-form').querySelector('fieldset').disabled = !writeConfig.matchWritesEnabled || saving || loading || !data || data.players.length < 2;
  $('match-submit').textContent = saving ? 'DB 저장 중…' : '경기 결과 DB 저장';
  $('refresh').disabled = saving || loading;
  $('reset').disabled = saving || loading || !data;
}
async function loadWriteConfig() {
  try {
    const response = await fetch('/api/config', {cache:'no-store',signal:AbortSignal.timeout(5000)});
    const config = await response.json();
    if (!response.ok || config.matchWritesEnabled !== true || typeof config.csrfToken !== 'string') throw Error();
    writeConfig = config;
  } catch { writeConfig = {matchWritesEnabled:false}; }
  $('match-write-notice').textContent = writeConfig.matchWritesEnabled
    ? '개발용 DB 저장 · 관리자 인증 미구현. 저장하면 실제 DB에 경기와 세트가 추가됩니다. 공개 서비스용 기능이 아닙니다.'
    : '조회 전용 모드입니다. 로컬 개발 환경에서만 경기 저장을 활성화할 수 있습니다.';
}
function route(focus = true) {
  const id = ['home', 'analysis', 'matches', 'ranking', 'dashboard'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id);
  document.querySelectorAll('nav a').forEach(a => { if (a.hash === '#' + id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (focus && !$('app').hidden) $(id).querySelector('h1').focus();
}
function clearReport() { currentReport = null; $('report').hidden = true; $('report-placeholder').hidden = false; $('save-report').disabled = false; }
function showReport(report, saved = false) {
  currentReport = structuredClone(report);
  $('report').hidden = false; $('report-placeholder').hidden = true;
  $('report-angles').textContent = `팔꿈치 ${report.elbow}° · 무릎 ${report.knee}° (고정 샘플)`;
  $('report-summary').textContent = report.summary;
  $('report-meta').textContent = `${nameOf(report.playerId)} · ${formatDate(report.createdAt)} · 실제 관절 인식·각도 측정 아님`;
  $('save-report').disabled = saved;
}
function runDemo(withFile) {
  clearReport();
  const file = $('video').files[0];
  const mode = $('analysis-mode').value;
  if (withFile) {
    if (!file) { status('analysis-status', '먼저 영상을 선택하거나 영상 없이 샘플 보기를 눌러주세요.', true); return; }
    const type = file.type.toLowerCase();
    if (!/\.(mp4|webm)$/i.test(file.name) || (type && !['video/mp4', 'video/webm'].includes(type))) {
      $('video').value = ''; status('analysis-status', '데모에서는 MP4/WebM 파일만 선택할 수 있습니다. 파일 내용은 검증하지 않습니다.', true); return;
    }
    if (file.size === 0 || file.size > 50 * 1024 * 1024) { $('video').value = ''; status('analysis-status', '데모 파일은 0바이트 초과, 50MB 이하여야 합니다.', true); return; }
  }
  // Drop the input's file reference. Do not read bytes, create object URLs or upload.
  $('video').value = '';
  if (mode !== 'success') {
    status('analysis-status', mode === 'failure' ? '분석 실패 시연: 정상 결과를 생성하지 않았습니다. 실제 분석 요청은 없었습니다.' : '관절 인식 불충분 시연: 결과를 표시하지 않습니다. 실제 인식은 수행하지 않았습니다.', true); return;
  }
  showReport({ id: uid(), playerId: $('analysis-player').value, createdAt: new Date().toISOString(), demo: true, ...data.demoAnalysis });
  status('analysis-status', '고정 샘플을 표시했습니다. 선택한 영상을 분석한 결과가 아닙니다. 영상 파일 참조를 해제했습니다.');
}
async function load() {
  if (loading || saving) return;
  loading = true;
  $('load-error').hidden = true; $('retry').disabled = true; $('refresh').disabled = true;
  $('app').hidden = true; $('reset').disabled = true; $('load-state').hidden = false;
  $('app').setAttribute('aria-busy', 'true');
  $('club-name').textContent = 'DB 데이터 조회 중…';
  status('global-status', '');
  clearReport();
  try {
    const [players, matches] = await Promise.all([fetchApi('/api/players'), fetchApi('/api/matches'), loadWriteConfig()]);
    validateApiData(players, matches);
    data = {players, matches, reports:[], club:'TENNIS LAB · Supabase DB', demoAnalysis};
    storageAvailable = true;
    let stored;
    try { stored = localStorage.getItem(KEY); } catch { storageAvailable = false; }
    if (stored) {
      try {
        const reports = JSON.parse(stored);
        if (!Array.isArray(reports)) throw Error();
        const ids = new Set();
        data.reports = reports.filter(r => {
          if (!r || typeof r.id !== 'string' || ids.has(r.id) || r.demo !== true || !players.some(p => p.id === r.playerId) || !Number.isFinite(r.elbow) || !Number.isFinite(r.knee) || typeof r.summary !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) return false;
          ids.add(r.id); return true;
        });
      } catch { status('global-status', 'DB 조회 완료. 브라우저 데모 리포트 형식이 잘못되어 해당 리포트는 표시하지 않습니다.', true); }
    }
    if (!$('global-status').textContent) status('global-status', `Supabase DB 조회 완료 · 선수 ${players.length}명 · 경기 ${matches.length}건. 기존 브라우저 선수·경기 기록은 사용하지 않습니다.`);
    if (!storageAvailable) status('global-status', 'DB 조회 완료. 브라우저 저장소 접근이 차단되어 데모 리포트는 메모리에만 보관됩니다.', true);
    const now = new Date(); if (!$('date').value) $('date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    render(); if (data.players.length > 1 && $('player-a').value === $('player-b').value) $('player-b').value = data.players[1].id;
    $('app').hidden = false; $('reset').disabled = false; route(false);
  } catch (error) { data = undefined; $('club-name').textContent = 'DB 조회 실패'; $('load-error').hidden = false; $('load-message').textContent = error.message; }
  finally { loading = false; $('load-state').hidden = true; $('app').setAttribute('aria-busy', 'false'); $('retry').disabled = false; updateMatchForm(); previewWinner(); }
}
async function fetchApi(url) {
  let response;
  try { response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(15000)}); }
  catch { throw Error('DB API에 연결할 수 없습니다. 로컬 서버 실행 상태와 네트워크를 확인해주세요.'); }
  let body;
  try { body = await response.json(); } catch { throw Error(`DB API 응답을 읽을 수 없습니다 (${url}, HTTP ${response.status}).`); }
  if (!response.ok) throw Error(`${url}: ${typeof body?.error === 'string' ? body.error : 'DB 조회 실패'} (HTTP ${response.status})`);
  if (response.headers.get('X-Data-Source') !== 'supabase' || !Array.isArray(body)) throw Error('DB 출처 또는 API 응답 형식을 확인할 수 없습니다.');
  return body;
}
function validateApiData(players, matches) {
  const ids = new Set(), matchIds = new Set(), seen = [];
  players.forEach(p => {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || typeof p.memberCode !== 'string') throw Error('DB 선수 데이터 형식이 올바르지 않습니다.');
    ids.add(p.id);
  });
  matches.forEach(m => {
    if (!m || typeof m.id !== 'string' || !m.id || matchIds.has(m.id)) throw Error('DB 경기 ID 형식이 올바르지 않습니다.');
    Tennis.validateMatch(m, players, seen); seen.push(m); matchIds.add(m.id);
  });
}
for (const id of ['member-form']) {
  const form = $(id);
  for (const control of form.elements) control.disabled = true;
  form.addEventListener('submit', e => {
    e.preventDefault();
    status(id === 'match-form' ? 'match-status' : 'member-status', 'DB 저장 API 준비 중입니다. 등록하거나 저장하지 않았습니다.', true);
  });
}
function matchInput() {
  return {a:$('player-a').value,b:$('player-b').value,date:$('date').value,sets:Tennis.parseSets($('sets').value)};
}
function previewWinner() {
  if (!data || !$('sets').value.trim()) { $('match-preview').textContent = '선수와 완료된 세트 점수를 입력하면 예상 승자가 표시됩니다.'; return; }
  try {
    const input = matchInput(); Tennis.validateMatch(input,data.players,[]);
    $('match-preview').textContent = '예상 승자: ' + nameOf(Tennis.validateSets(input.sets).a === 2 ? input.a : input.b) + ' · 저장 시 서버와 DB에서 다시 검증합니다.';
  } catch (error) { $('match-preview').textContent = error.message; }
}
for (const id of ['player-a','player-b','date','sets']) $(id).addEventListener('input',previewWinner);
async function refreshAfterSave() {
  const [players,matches] = await Promise.all([fetchApi('/api/players'),fetchApi('/api/matches')]);
  validateApiData(players,matches);
  data = {...data,players,matches};
  render();
  status('global-status',`Supabase DB 조회 완료 · 선수 ${players.length}명 · 경기 ${matches.length}건.`);
}
$('match-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (saving || loading) return;
  if (!writeConfig.matchWritesEnabled) { status('match-status','조회 전용 모드에서는 저장할 수 없습니다.',true); return; }
  let input;
  try { input = matchInput(); Tennis.validateMatch(input,data.players,[]); }
  catch (error) { status('match-status',error.message,true); return; }
  saving = true; updateMatchForm();
  $('match-refresh').hidden = true;
  status('match-status','경기와 세트를 DB에 저장 중입니다…');
  let saved = false;
  try {
    let response;
    try {
      response = await fetch('/api/matches',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':writeConfig.csrfToken},
        body:JSON.stringify(input),signal:AbortSignal.timeout(15000)
      });
    } catch { throw Error('저장 결과를 확인할 수 없습니다. DB 새로 조회로 먼저 확인해주세요. 같은 입력 재시도는 중복 저장을 방지합니다.'); }
    let result;
    try { result = await response.json(); } catch { throw Error('저장 응답을 읽을 수 없습니다. DB 조회로 저장 여부를 먼저 확인해주세요.'); }
    if (!response.ok) throw Error(typeof result?.error === 'string' ? result.error : 'DB 저장 요청이 실패했습니다.');
    if (response.headers.get('X-Data-Source') !== 'supabase' || typeof result.created !== 'boolean' || !result.match || Tennis.signature(result.match) !== Tennis.signature(input))
      throw Error('저장 응답을 확인할 수 없습니다. DB 조회로 저장 여부를 먼저 확인해주세요.');
    saved = true;
    $('sets').value = ''; previewWinner();
    status('match-status',result.created ? 'DB 저장 완료. 경기 기록과 랭킹을 다시 조회 중입니다…' : '이미 저장된 동일 경기입니다. 중복 추가 없이 다시 조회 중입니다…');
    await refreshAfterSave();
    status('match-status',result.created ? 'DB 저장 완료 · 경기 기록, 랭킹, 개인 통계를 갱신했습니다.' : '이미 저장된 동일 경기입니다. 추가 저장 없이 기록과 랭킹을 갱신했습니다.');
  } catch (error) {
    status('match-status',saved ? 'DB 저장은 완료됐지만 화면 갱신에 실패했습니다. 다시 저장하지 말고 저장 결과 다시 조회를 눌러주세요.' : error.message,true);
    if (saved) {
      $('match-refresh').hidden = false;
      status('global-status','DB 저장 완료 · 현재 목록과 통계는 갱신 전 데이터입니다. 저장 결과 다시 조회가 필요합니다.',true);
    }
  } finally { saving = false; updateMatchForm(); }
});
$('match-refresh').onclick = async () => {
  if (saving || loading) return;
  saving = true; updateMatchForm(); $('match-refresh').disabled = true;
  try {
    await refreshAfterSave(); $('match-refresh').hidden = true;
    status('match-status','저장 결과 조회 완료 · 경기 기록과 랭킹을 갱신했습니다.');
    status('global-status',`Supabase DB 조회 완료 · 선수 ${data.players.length}명 · 경기 ${data.matches.length}건.`);
  } catch { status('match-status','저장 결과 조회에 실패했습니다. 다시 조회해주세요. 추가 저장 요청은 보내지 않았습니다.',true); }
  finally { saving = false; $('match-refresh').disabled = false; updateMatchForm(); }
};
$('sort').onchange = $('direction').onchange = () => renderRanking(Tennis.stats(data.players, data.matches));
$('profile').onchange = () => renderDashboard(Tennis.stats(data.players, data.matches));
$('analyze').onclick = () => runDemo(true); $('demo').onclick = () => runDemo(false);
['video', 'analysis-mode', 'analysis-player'].forEach(id => $(id).onchange = () => { clearReport(); status('analysis-status', '조건이 바뀌었습니다. 데모를 실행해주세요. 실제 AI 분석은 수행하지 않습니다.'); });
$('save-report').onclick = () => {
  if (!data || !currentReport) return;
  try {
    if (data.reports.some(r => r.id === currentReport.id)) throw Error('이미 저장된 결과입니다.');
    const next = structuredClone(data); next.reports.push(structuredClone(currentReport)); commit(next);
    $('save-report').disabled = true;
    status('analysis-status', storageAvailable ? '이 브라우저에 데모 리포트를 저장했습니다. DB에는 저장하지 않습니다. 개인 대시보드에서 다시 볼 수 있습니다.' : '결과를 메모리에만 반영했습니다. 새로고침하면 사라집니다.');
  } catch (error) { status('analysis-status', error.message, true); }
};
document.addEventListener('click', e => {
  const profile = e.target.closest('[data-profile]'), report = e.target.closest('[data-report]');
  if (profile) { $('profile').value = profile.dataset.profile; renderDashboard(Tennis.stats(data.players, data.matches)); location.hash = 'dashboard'; }
  if (report) { const r = data.reports.find(r => r.id === report.dataset.report); if (r) { $('analysis-player').value = r.playerId; $('video').value = ''; showReport(r, true); status('analysis-status', '저장된 데모 결과입니다. 실제 영상 분석 결과가 아닙니다.'); location.hash = 'analysis'; } }
});
$('reset').onclick = () => {
  if (!data || !confirm('이 브라우저의 포핸드 데모 리포트만 지울까요? DB 선수·경기 데이터는 유지됩니다.')) return;
  try {
    commit({...data, reports:[]}); clearReport(); $('video').value = '';
    status('analysis-status', '이 브라우저의 데모 리포트를 초기화했습니다. DB 데이터는 변경하지 않았습니다.');
  } catch (error) { status('global-status', error.message, true); }
};
$('refresh').onclick = load;
$('retry').onclick = load;
window.addEventListener('hashchange', () => route());
load();
