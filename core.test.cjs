const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const T=require('./core.js');
const sample=()=>JSON.parse(fs.readFileSync(__dirname+'/sample-data.json','utf8'));
test('sample validates; every player total derives from matches',()=>{
  const d=T.validateData(sample()),s=T.stats(d.players,d.matches),p=s.find(p=>p.id==='p1');
  assert.equal(d.matches.length,5);
  assert.deepEqual([p.played,p.wins,p.losses,p.rate,p.setsFor,p.setsAgainst,p.diff,p.rank],[4,2,2,50,4,4,0,2]);
  assert.equal(s.find(p=>p.id==='p3').rank,1);
  const empty=s.find(p=>p.id==='p4');assert.equal(empty.rank,null);assert.equal(empty.rate,0);
  assert.equal(s.reduce((n,p)=>n+p.played,0),d.matches.length*2);
  assert.equal(s.reduce((n,p)=>n+p.wins,0),d.matches.length);
  assert.equal(s.reduce((n,p)=>n+p.diff,0),0);
});
test('invalid scores, unfinished matches and extra sets rejected',()=>{
  for(const v of ['', '-1-6, 6-4','6.5-4, 6-3','abc','6-5, 6-3','8-6, 6-3','7-4, 6-0','6-4','6-4, 3-6','6-4, 6-3, 0-6','6-6, 6-3','6-4, 3-6, 6-6'])assert.throws(()=>T.parseSets(v),v);
  assert.deepEqual(T.parseSets('7-6, 5-7, 6-0'),[[7,6],[5,7],[6,0]]);
});
test('duplicate including reversed players and same player rejected',()=>{
  const d=sample(),first=d.matches[0];
  assert.throws(()=>T.validateMatch(first,d.players,d.matches),/중복/);
  assert.throws(()=>T.validateMatch({...first,a:first.b,b:first.a,sets:first.sets.map(s=>[s[1],s[0]])},d.players,d.matches),/중복/);
  assert.throws(()=>T.validateMatch({...first,b:first.a},d.players,[]));
  assert.throws(()=>T.validateMatch({...first,date:''},d.players,[]));
  assert.throws(()=>T.validateMatch({...first,date:'2026-02-30'},d.players,[]));
  assert.throws(()=>T.validateMatch({...first,a:'missing'},d.players,[]));
});
test('adding a match updates both players and all aggregates; JSON round trip',()=>{
  const d=sample(),m={id:'new',a:'p4',b:'p3',date:'2026-11-14',sets:T.parseSets('6-0, 6-0')};
  T.validateMatch(m,d.players,d.matches);d.matches.push(m);
  const restored=T.validateData(JSON.parse(JSON.stringify(d))),s=T.stats(restored.players,restored.matches);
  assert.deepEqual(T.stats(d.players,d.matches),s);
  const p4=s.find(p=>p.id==='p4'),p3=s.find(p=>p.id==='p3');
  assert.deepEqual([p4.played,p4.wins,p4.rate,p4.diff,p4.rank],[1,1,100,2,1]);
  assert.deepEqual([p3.played,p3.wins,p3.losses,p3.rate],[4,2,2,50]);
});
test('equal stats share competition ranks and zero-match player excluded',()=>{
  const players=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'},{id:'d',name:'D'}];
  const matches=[{a:'a',b:'c',sets:[[6,0],[6,0]]},{a:'b',b:'c',sets:[[6,0],[6,0]]}];
  const s=T.stats(players,matches);assert.deepEqual(s.map(p=>p.rank),[1,1,3,null]);
});
test('corrupt and mismatched saved data rejected',()=>{
  assert.throws(()=>T.validateData({version:2}));
  const d=sample();d.players.push({...d.players[0]});assert.throws(()=>T.validateData(d));
  const r=sample();r.reports.push({id:'r',playerId:'p1',demo:false});assert.throws(()=>T.validateData(r));
});
