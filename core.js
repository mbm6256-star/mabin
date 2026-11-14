/* Browser + Node: framework-free domain functions. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Tennis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function parseSets(text) {
    const chunks = text.trim().split(',').map(s => s.trim());
    if (!chunks.length || chunks.some(s => !/^\d{1,2}\s*-\s*\d{1,2}$/.test(s)))
      throw Error('세트 점수를 6-4, 6-3 형식으로 입력해주세요. 음수·소수·문자는 사용할 수 없습니다.');
    const sets = chunks.map(s => s.split('-').map(Number));
    validateSets(sets);
    return sets;
  }
  function validateSets(sets) {
    if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) throw Error('데모 규칙: 완료된 2~3세트를 입력해주세요.');
    let a = 0, b = 0;
    sets.forEach(pair => {
      if (a === 2 || b === 2) throw Error('이미 2세트 선승한 이후의 세트는 입력할 수 없습니다.');
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(n => !Number.isInteger(n) || n < 0)) throw Error('점수는 0 이상의 정수여야 합니다.');
      const [x,y] = pair, hi = Math.max(x,y), lo = Math.min(x,y);
      if (!((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6))))
        throw Error('데모 세트 규칙: 6-0~6-4, 7-5, 7-6 또는 반대 점수만 가능합니다.');
      if (x > y) a++; else b++;
    });
    if (a !== 2 && b !== 2) throw Error('2세트 선승으로 경기를 완료해주세요.');
    return {a,b};
  }
  function signature(m) {
    const normal = m.a < m.b;
    return JSON.stringify([m.date, ...[m.a,m.b].sort(), m.sets.map(s => normal ? s : [s[1],s[0]])]);
  }
  function validateMatch(m, players, matches) {
    if (!m.a || !m.b || !m.date) throw Error('두 선수와 경기일은 필수입니다.');
    if (m.a === m.b) throw Error('서로 다른 두 선수를 선택해주세요.');
    if (![m.a,m.b].every(id => players.some(p => p.id === id))) throw Error('등록된 선수를 선택해주세요.');
    const date = new Date(m.date+'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== m.date)
      throw Error('유효한 경기일을 입력해주세요.');
    validateSets(m.sets);
    if (matches.some(old => signature(old) === signature(m))) throw Error('같은 날짜·선수·세트 점수의 경기가 이미 있습니다. 중복 등록을 막았습니다.');
    return m;
  }
  function stats(players, matches) {
    const rows = players.map(p => ({...p, played:0, wins:0, losses:0, setsFor:0, setsAgainst:0, diff:0, rate:0, rank:null}));
    const byId = new Map(rows.map(p => [p.id,p]));
    matches.forEach(m => {
      const score = validateSets(m.sets), a = byId.get(m.a), b = byId.get(m.b);
      if (!a || !b) throw Error('경기에 존재하지 않는 선수가 있습니다.');
      a.played++; b.played++;
      a.setsFor += score.a; a.setsAgainst += score.b;
      b.setsFor += score.b; b.setsAgainst += score.a;
      if (score.a > score.b) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
    });
    rows.forEach(p => {p.rate = p.played ? p.wins / p.played * 100 : 0; p.diff = p.setsFor - p.setsAgainst;});
    const ranked = rows.filter(p => p.played).sort((a,b) => b.rate-a.rate || b.wins-a.wins || b.diff-a.diff || a.name.localeCompare(b.name,'ko') || a.id.localeCompare(b.id));
    ranked.forEach((p,i) => {const prev = ranked[i-1]; p.rank = prev && p.rate === prev.rate && p.wins === prev.wins && p.diff === prev.diff ? prev.rank : i+1;});
    return rows;
  }
  function validateData(data) {
    if (!data || data.version !== 1 || typeof data.club !== 'string' || !Array.isArray(data.players) || !data.players.length || !Array.isArray(data.matches) || !Array.isArray(data.reports)) throw Error('데이터 구조가 올바르지 않습니다.');
    const ids = new Set(), codes = new Set();
    data.players.forEach(p => {
      if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim() || typeof p.memberCode !== 'string' || !p.memberCode || ids.has(p.id) || codes.has(p.memberCode.toUpperCase())) throw Error('선수 데이터가 올바르지 않습니다.');
      ids.add(p.id); codes.add(p.memberCode.toUpperCase());
    });
    const seen = [], matchIds = new Set();
    data.matches.forEach(m => {if (typeof m.id !== 'string' || matchIds.has(m.id)) throw Error('경기 ID가 올바르지 않습니다.'); validateMatch(m,data.players,seen);seen.push(m);matchIds.add(m.id);});
    const reportIds = new Set();
    data.reports.forEach(r => {
      if (!r || typeof r.id !== 'string' || reportIds.has(r.id) || !ids.has(r.playerId) || r.demo !== true || !Number.isFinite(r.elbow) || !Number.isFinite(r.knee) || typeof r.summary !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) throw Error('리포트 데이터가 올바르지 않습니다.');
      reportIds.add(r.id);
    });
    if (!data.demoAnalysis || !Number.isFinite(data.demoAnalysis.elbow) || !Number.isFinite(data.demoAnalysis.knee) || typeof data.demoAnalysis.summary !== 'string') throw Error('데모 분석 데이터가 올바르지 않습니다.');
    return data;
  }
  return {parseSets,validateSets,validateMatch,signature,stats,validateData};
});
