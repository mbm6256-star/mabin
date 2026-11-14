'use strict';
const $ = id => document.getElementById(id);
const KEY = 'tennis-lab-prototype-v1';
let data, seed, currentReport = null, storageAvailable = true;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const nameOf = id => data.players.find(p => p.id === id)?.name || '알 수 없는 선수';
const rateOf = p => p.played ? p.rate.toFixed(1)+'%' : '—';
const formatDate = iso => new Date(iso).toLocaleString('ko-KR');
const scoreText = (m, reverse=false) => m.sets.map(s => (reverse ? [...s].reverse() : s).join('-')).join(', ');
function status(id, text, error=false) {$(id).textContent=text;$(id).classList.toggle('error',error);}
function commit(next) {
  Tennis.validateData(next);
  if (storageAvailable) {
    try {localStorage.setItem(KEY,JSON.stringify(next));}
    catch {throw Error('브라우저 저장에 실패했습니다. 변경을 반영하지 않았습니다. 저장 공간·브라우저 설정을 확인해주세요.');}
  }
  data = next;
  if (!storageAvailable) status('global-status','브라우저 저장소를 사용할 수 없어 메모리에서만 작동합니다. 새로고침하면 변경 내용이 사라집니다.',true);
  render();
}
function updatePlayers() {
  document.querySelectorAll('select.players').forEach(select => {
    const previous = select.value;
    select.replaceChildren();
    data.players.forEach(p => {const option = document.createElement('option');option.value=p.id;option.textContent=p.name+' · '+p.memberCode;select.append(option);});
    if (data.players.some(p=>p.id===previous)) select.value=previous;
  });
}
function matchTable(matches, playerId=null) {
  if (!matches.length) return '<p class="empty">아직 경기 기록이 없습니다. 첫 경기를 등록해보세요.</p>';
  return `<div class="tablewrap"><table><caption>${playerId ? esc(nameOf(playerId))+'의 경기 기록' : '단식 경기 결과'}</caption><thead><tr><th>경기일</th><th>선수 A / 선수 B</th><th>${playerId?'내 점수 − 상대 점수':'A − B 세트별 점수'}</th><th>${playerId?'내 결과':'승자'}</th></tr></thead><tbody>${[...matches].sort((a,b)=>b.date.localeCompare(a.date)).map(m=>{
    const wonA = Tennis.validateSets(m.sets).a===2;
    const winner = wonA ? m.a : m.b;
    return `<tr><td>${esc(m.date)}</td><td>${esc(nameOf(m.a))} / ${esc(nameOf(m.b))}</td><td>${scoreText(m,playerId===m.b)}</td><td>${playerId ? (winner===playerId?'승':'패') : esc(nameOf(winner))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function metric(label, value) {return `<div class="card"><div class="metric-label">${label}</div><div class="number">${value}</div></div>`;}
function renderRanking(rows) {
  const key = $('sort').value, direction = $('direction').value==='desc' ? -1 : 1;
  const sorted = [...rows].sort((a,b) => {
    if(key==='rank') {
      if(a.rank===null || b.rank===null) return a.rank===b.rank ? a.name.localeCompare(b.name,'ko') : a.rank===null ? 1 : -1;
      return (a.rank-b.rank)*-direction || a.name.localeCompare(b.name,'ko');
    }
    return (a[key]-b[key])*direction || a.name.localeCompare(b.name,'ko');
  });
  $('ranking-table').innerHTML=`<table><caption>가상 동아리 집계 · 정렬을 바꾸어도 데모 순위 산식은 유지됩니다.</caption><thead><tr><th>데모 순위</th><th>선수</th><th>경기</th><th>승 / 패</th><th>승률</th><th>세트 득 / 실</th><th>득실 차</th><th>기록</th></tr></thead><tbody>${sorted.map(p=>`<tr><td>${p.rank??'미경기'}</td><td>${esc(p.name)}</td><td>${p.played}</td><td>${p.wins} / ${p.losses}</td><td>${rateOf(p)}</td><td>${p.setsFor} / ${p.setsAgainst}</td><td>${p.diff>0?'+':''}${p.diff}</td><td><button class="btn secondary" data-profile="${esc(p.id)}" aria-label="${esc(p.name)} 개인 기록 보기">보기</button></td></tr>`).join('')}</tbody></table>`;
}
function renderDashboard(rows) {
  const p = rows.find(p => p.id===$('profile').value);
  if (!p) return;
  const matches = data.matches.filter(m=>m.a===p.id||m.b===p.id).sort((a,b)=>a.date.localeCompare(b.date));
  let wins = 0;
  const trend = matches.map((m,i)=>{
    if((Tennis.validateSets(m.sets).a===2 ? m.a : m.b)===p.id)wins++;
    return {date:m.date,value:wins/(i+1)*100};
  });
  const reports = data.reports.filter(r=>r.playerId===p.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('dashboard-content').innerHTML=`<h2>${esc(p.name)}의 기록</h2><div class="metric-cards">${metric('경기 수',p.played)}${metric('승 / 패',`${p.wins} / ${p.losses}`)}${metric('승률',rateOf(p))}${metric('세트 득 / 실',`${p.setsFor} / ${p.setsAgainst}`)}</div><div class="grid sectiongap"><article class="card"><h2>경기별 누적 승률</h2><p class="muted">경기일 순서 · 같은 날짜는 등록 순서. 경기 성적 변화이며 자세 개선의 증거가 아닙니다.</p>${trend.length?`<div class="chart" role="img" aria-label="${esc(trend.map(t=>t.date+' '+t.value.toFixed(1)+'%').join(', '))}">${trend.map(t=>`<div class="chart-col"><span class="chart-label">${t.value.toFixed(1)}%</span><div class="bar" style="height:${Math.max(2,t.value)}px"></div><small>${esc(t.date.slice(5))}</small></div>`).join('')}</div>`:'<p class="empty">경기 기록이 없어 성장 추이를 표시하지 않습니다.</p>'}<h3 class="sectiongap">개인 경기 이력</h3>${matchTable(matches,p.id)}</article><article class="card"><h2>저장된 포핸드 데모 결과</h2><p class="muted">고정 샘플이며 실제 영상 측정 결과가 아닙니다. 원본 영상은 보관하지 않습니다.</p>${reports.length?reports.map(r=>`<div class="report-item"><span class="badge">샘플 리포트</span><p>${esc(formatDate(r.createdAt))}</p><p>팔꿈치 ${r.elbow}° · 무릎 ${r.knee}°</p><button class="btn secondary" data-report="${esc(r.id)}">저장 결과 보기</button></div>`).join(''):'<p class="empty">저장된 결과가 없습니다. 영상 분석 화면에서 데모를 저장해보세요.</p>'}<a class="btn secondary" href="#analysis">분석 데모로 →</a></article></div>`;
}
function render() {
  updatePlayers();
  const rows = Tennis.stats(data.players,data.matches);
  $('club-name').textContent=data.club;
  $('home-metrics').innerHTML=metric('등록 회원·선수',data.players.length)+metric('완료된 단식 경기',data.matches.length)+metric('저장된 데모 리포트',data.reports.length);
  $('home-matches').innerHTML=matchTable([...data.matches].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3));
  $('match-list').innerHTML=matchTable(data.matches);
  $('members').innerHTML='<p class="muted">등록 선수 '+data.players.length+'명</p><ul class="list">'+data.players.map(p=>`<li>${esc(p.name)} <small>${esc(p.memberCode)}</small></li>`).join('')+'</ul>';
  renderRanking(rows);renderDashboard(rows);
}
function route(focus=true) {
  const id = ['home','analysis','matches','ranking','dashboard'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('.screen').forEach(s=>s.hidden=s.id!==id);
  document.querySelectorAll('nav a').forEach(a=>{if(a.hash==='#'+id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  if(focus)$(id).querySelector('h1').focus();
}
function clearReport() {currentReport=null;$('report').hidden=true;$('report-placeholder').hidden=false;$('save-report').disabled=false;}
function showReport(report, saved=false) {
  currentReport = structuredClone(report);
  $('report').hidden=false;$('report-placeholder').hidden=true;
  $('report-angles').textContent=`팔꿈치 ${report.elbow}° · 무릎 ${report.knee}° (고정 샘플)`;
  $('report-summary').textContent=report.summary;
  $('report-meta').textContent=`${nameOf(report.playerId)} · ${formatDate(report.createdAt)} · 실제 관절 인식·각도 측정 아님`;
  $('save-report').disabled=saved;
}
function runDemo(withFile) {
  clearReport();
  const file=$('video').files[0];
  const mode=$('analysis-mode').value;
  if(withFile) {
    if(!file){status('analysis-status','먼저 영상을 선택하거나 영상 없이 샘플 보기를 눌러주세요.',true);return;}
    const type = file.type.toLowerCase();
    if(!/\.(mp4|webm)$/i.test(file.name) || (type && !['video/mp4','video/webm'].includes(type))) {
      $('video').value='';status('analysis-status','데모에서는 MP4/WebM 파일만 선택할 수 있습니다. 파일 내용은 검증하지 않습니다.',true);return;
    }
    if(file.size===0 || file.size>50*1024*1024){$('video').value='';status('analysis-status','데모 파일은 0바이트 초과, 50MB 이하여야 합니다.',true);return;}
  }
  // Drop the input's file reference. Do not read bytes, create object URLs or upload.
  $('video').value='';
  if(mode!=='success') {
    status('analysis-status',mode==='failure'?'분석 실패 시연: 정상 결과를 생성하지 않았습니다. 실제 분석 요청은 없었습니다.':'관절 인식 불충분 시연: 결과를 표시하지 않습니다. 실제 인식은 수행하지 않았습니다.',true);return;
  }
  showReport({id:uid(),playerId:$('analysis-player').value,createdAt:new Date().toISOString(),demo:true,...data.demoAnalysis});
  status('analysis-status','고정 샘플을 표시했습니다. 선택한 영상을 분석한 결과가 아닙니다. 영상 파일 참조를 해제했습니다.');
}
async function load() {
  $('load-error').hidden=true;$('retry').disabled=true;
  try {
    const response=await fetch('./sample-data.json',{cache:'no-store'});
    if(!response.ok)throw Error('샘플 파일 응답 오류: '+response.status);
    seed=Tennis.validateData(await response.json());
    data=structuredClone(seed);
    storageAvailable=true;
    let stored;
    try {stored=localStorage.getItem(KEY);}catch{storageAvailable=false;}
    if(stored) {
      try {data=Tennis.validateData(JSON.parse(stored));}
      catch {status('global-status','저장된 데이터 형식에 문제가 있어 샘플을 표시합니다. 기존 저장 내용은 아직 바꾸지 않았습니다. 다음 저장 또는 초기화 시 교체됩니다.',true);}
    }
    if(!storageAvailable)status('global-status','저장소 접근이 차단되어 메모리로 작동합니다. 새로고침하면 변경이 사라집니다.',true);
    const now=new Date();$('date').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    render();if(data.players.length>1)$('player-b').value=data.players[1].id;
    $('app').hidden=false;$('reset').disabled=false;route(false);
  } catch(error) {$('load-error').hidden=false;$('load-message').textContent=error.message;}
  finally {$('retry').disabled=false;}
}
$('match-form').addEventListener('submit',e=>{
  e.preventDefault();
  try {
    const m={id:uid(),date:$('date').value,a:$('player-a').value,b:$('player-b').value,sets:Tennis.parseSets($('sets').value)};
    Tennis.validateMatch(m,data.players,data.matches);
    const next=structuredClone(data);next.matches.push(m);commit(next);
    $('sets').value='';status('match-status',storageAvailable?'경기를 저장했습니다. 기록·통계·랭킹을 갱신했습니다.':'경기를 메모리에 반영했습니다. 새로고침하면 사라집니다.');
  }catch(error){status('match-status',error.message,true);}
});
$('member-form').addEventListener('submit',e=>{
  e.preventDefault();
  try {
    const name=$('member-name').value.trim(),memberCode=$('member-code').value.trim().toUpperCase();
    if(!name || name.length>30 || !/^[A-Z0-9-]{2,20}$/.test(memberCode))throw Error('이름(1~30자)과 회원 코드(영문·숫자·하이픈 2~20자)를 확인해주세요.');
    if(data.players.some(p=>p.memberCode.toUpperCase()===memberCode))throw Error('이미 등록된 회원 코드입니다. 다른 코드를 입력해주세요.');
    const next=structuredClone(data);next.players.push({id:uid(),name,memberCode});commit(next);
    $('member-form').reset();status('member-status',name+' 회원·선수를 등록했습니다. 경기와 분석 화면에서 선택할 수 있습니다.'+(storageAvailable?'':' 메모리에만 반영했습니다.'));
  }catch(error){status('member-status',error.message,true);}
});
$('sort').onchange=$('direction').onchange=()=>renderRanking(Tennis.stats(data.players,data.matches));
$('profile').onchange=()=>renderDashboard(Tennis.stats(data.players,data.matches));
$('analyze').onclick=()=>runDemo(true);$('demo').onclick=()=>runDemo(false);
['video','analysis-mode','analysis-player'].forEach(id=>$(id).onchange=()=>{clearReport();status('analysis-status','조건이 바뀌었습니다. 데모를 실행해주세요. 실제 AI 분석은 수행하지 않습니다.');});
$('save-report').onclick=()=>{
  if(!currentReport)return;
  try {
    if(data.reports.some(r=>r.id===currentReport.id))throw Error('이미 저장된 결과입니다.');
    const next=structuredClone(data);next.reports.push(structuredClone(currentReport));commit(next);
    $('save-report').disabled=true;
    status('analysis-status',storageAvailable?'샘플 결과만 저장했습니다. 개인 대시보드에서 다시 볼 수 있습니다. 원본 영상은 저장하지 않았습니다.':'결과를 메모리에만 반영했습니다. 새로고침하면 사라집니다.');
  }catch(error){status('analysis-status',error.message,true);}
};
document.addEventListener('click',e=>{
  const profile=e.target.closest('[data-profile]'),report=e.target.closest('[data-report]');
  if(profile){$('profile').value=profile.dataset.profile;renderDashboard(Tennis.stats(data.players,data.matches));location.hash='dashboard';}
  if(report){const r=data.reports.find(r=>r.id===report.dataset.report);if(r){$('analysis-player').value=r.playerId;$('video').value='';showReport(r,true);status('analysis-status','저장된 데모 결과입니다. 실제 영상 분석 결과가 아닙니다.');location.hash='analysis';}}
});
$('reset').onclick=()=>{
  if(!confirm('이 브라우저에서 추가한 선수·경기·샘플 리포트를 지우고 초기 가상 데이터로 돌아갈까요?'))return;
  try {commit(structuredClone(seed));clearReport();$('video').value='';$('member-form').reset();$('sets').value='';status('analysis-status','초기화했습니다. 새 데모를 실행해주세요.');status('match-status','초기 가상 경기로 돌아왔습니다.');status('member-status','초기 가상 선수로 돌아왔습니다.');status('global-status',storageAvailable?'초기 샘플 데이터로 돌아왔습니다.':'샘플로 초기화했습니다. 저장소가 차단되어 메모리에서만 작동합니다.',!storageAvailable);}
  catch(error){status('global-status',error.message,true);}
};
$('retry').onclick=load;
window.addEventListener('hashchange',()=>route());
load();
