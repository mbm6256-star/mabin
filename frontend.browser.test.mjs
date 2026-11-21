// Real Edge/Chrome headless browser checks against the running local server.
// Default: live GET-only. Mock-write mode never connects to real Supabase.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Tennis from './core.js';
const mockWrites=process.env.TENNIS_LAB_BROWSER_MOCK_WRITES==='true';
let mockServer,base='http://127.0.0.1:4173',mock;
if(mockWrites){
  const {createPreviewServer}=await import('./preview.mjs');
  const sample=JSON.parse(await readFile(new URL('./sample-data.json',import.meta.url),'utf8'));
  const original=sample.matches.map((m,i)=>({...m,id:String(i+1)}));
  mock={matches:structuredClone(original),posts:0,mode:'ok',failRead:false};
  const fetchImpl=async(url,options)=>{
    if(url.pathname.includes('/rpc/')){
      mock.posts++;await new Promise(resolve=>setTimeout(resolve,150));
      if(mock.mode==='fail')return new Response(JSON.stringify({code:'XX000'}),{status:500});
      const p=JSON.parse(options.body);
      const input={a:p.p_player_a_id,b:p.p_player_b_id,date:p.p_played_at,sets:p.p_sets};
      let match=mock.matches.find(m=>Tennis.signature(m)===Tennis.signature(input));
      const created=!match;
      if(!match){match={id:String(mock.matches.length+1),...input};mock.matches.push(match);}
      if(mock.mode==='unknown')throw Error('Simulated lost response after commit');
      if(mock.mode==='refresh-fail')mock.failRead=true;
      return Response.json({created,match,winner_id:Tennis.validateSets(match.sets).a===2?match.a:match.b});
    }
    if(url.pathname.endsWith('/matches')&&mock.failRead){mock.failRead=false;return Response.json({},{status:503});}
    const rows=url.pathname.endsWith('/players')?sample.players.map(p=>({id:p.id,name:p.name,member_code:p.memberCode})):
      mock.matches.map(m=>({id:m.id,played_at:m.date,player_a_id:m.a,player_b_id:m.b,winner_id:Tennis.validateSets(m.sets).a===2?m.a:m.b,match_sets:m.sets.map(([a,b],i)=>({set_number:i+1,player_a_games:a,player_b_games:b}))}));
    return new Response(JSON.stringify(rows),{headers:{'content-range':`0-${rows.length-1}/${rows.length}`}});
  };
  mockServer=createPreviewServer({env:{NODE_ENV:'development',ENABLE_DEV_MATCH_WRITES:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_TEST_ONLY'},fetchImpl});
  await new Promise(resolve=>mockServer.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+mockServer.address().port;
  mock.reset=()=>{mock.matches=structuredClone(original);mock.mode='ok';mock.failRead=false;};
}
const executable=process.env.BROWSER_EXECUTABLE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile=await mkdtemp(path.join(os.tmpdir(),'tennis-lab-browser-'));
const browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
  let port;
  for(let i=0;i<100;i++){
    try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await sleep(100);}
  }
  assert(port,'Browser debugging endpoint did not start');
  const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket=new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let nextId=0, session, mode='live';
  const pending=new Map(), held=[], requests=[], errors=[];
  function send(method,params={},sessionId=session){
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
      socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  async function fulfill(requestId,body,status=200,source=true){
    await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'},...(source?[{name:'X-Data-Source',value:'supabase'}]:[])],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  }
  socket.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
    if(m.method==='Runtime.exceptionThrown') errors.push('Uncaught browser exception');
    if(m.method==='Network.requestWillBeSent') requests.push({url:m.params.request.url,method:m.params.request.method});
    if(m.method==='Fetch.requestPaused'){
      const id=m.params.requestId;
      const work=mode==='hold'?(held.push(id),Promise.resolve()):mode==='live'?send('Fetch.continueRequest',{requestId:id}):mode==='error'?fulfill(id,{error:'Test DB unavailable'},502):mode==='wrong-source'?fulfill(id,[],200,false):fulfill(id,[]);
      work.catch(()=>errors.push('Request interception failed'));
    }
  };
  const target=await send('Target.createTarget',{url:'about:blank'},null);
  session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/players'},{urlPattern:base+'/api/matches'}]});
  const legacy='{"players":[{"id":"old-only","name":"OLD LOCAL PLAYER"}],"matches":[]}';
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('tennis-lab-prototype-v1',${JSON.stringify(legacy)});`});
  async function evaluate(expression){
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails) throw Error('Browser evaluation failed');
    return result.result.value;
  }
  async function waitFor(expression){
    for(let i=0;i<150;i++){if(await evaluate(expression))return;await sleep(100);}
    throw Error('Browser condition timed out: '+expression);
  }
  await send('Page.navigate',{url:base+'/'});
  await waitFor("!document.getElementById('app').hidden");
  assert.deepEqual(await evaluate("[data.players.length,data.matches.length,data.matches.reduce((n,m)=>n+m.sets.length,0)]"),[4,5,10]);
  assert.equal(await evaluate("document.querySelectorAll('#home-matches tbody tr').length"),3);
  assert.equal(await evaluate("document.querySelectorAll('#match-list tbody tr').length"),5);
  assert.equal(await evaluate("document.querySelectorAll('#ranking-table tbody tr').length"),4);
  assert.equal(await evaluate("localStorage.getItem('tennis-lab-prototype-v1')"),legacy);
  assert(!await evaluate("document.getElementById('app').textContent.includes('OLD LOCAL PLAYER')"));
  assert(await evaluate("[...document.querySelectorAll('#member-form input,#member-form button')].every(el=>el.matches(':disabled'))"));
  assert.equal(await evaluate("document.querySelector('#match-form fieldset').disabled"),!mockWrites);
  await evaluate("document.getElementById('profile').value='p1';document.getElementById('profile').dispatchEvent(new Event('change'))");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#dashboard-content .number')].map(el=>el.textContent)"),['4','2 / 2','50.0%','4 / 4']);
  const first=await evaluate("document.querySelector('#ranking-table tbody tr').textContent");assert(first.includes('박지우'));assert(first.includes('66.7%'));
  console.log(`PASS ${mockWrites?'mock':'live'} DB: 4 players, 5 matches, 10 sets; home, ranking, dashboard; old storage ignored; registration mode checked`);
  await evaluate("location.hash='analysis';document.getElementById('demo').click();document.getElementById('save-report').click()");
  assert.equal(await evaluate('data.reports.length'),1);
  assert.deepEqual(await evaluate("Object.keys(JSON.parse(localStorage.getItem('tennis-lab-demo-reports-v2'))[0]).sort()"),['createdAt','demo','elbow','id','knee','playerId','summary']);
  const before=requests.filter(r=>r.url.includes('/api/')).length;
  await send('Page.reload',{ignoreCache:true});
  await waitFor("!document.getElementById('app').hidden");
  assert.equal(await evaluate('data.reports.length'),1);
  assert(requests.filter(r=>r.url.includes('/api/')).length>=before+2);
  console.log('PASS reload fetches DB again; demo reports persist separately');
  if(mockWrites){
    const fill=async(a='p4',b='p1',date='2026-11-15',sets='6-0, 6-0')=>evaluate(`
      location.hash='matches';
      document.getElementById('player-a').value=${JSON.stringify(a)};
      document.getElementById('player-b').value=${JSON.stringify(b)};
      document.getElementById('date').value=${JSON.stringify(date)};
      document.getElementById('sets').value=${JSON.stringify(sets)};
      document.getElementById('sets').dispatchEvent(new Event('input'));
    `);
    const submit=()=>evaluate("document.getElementById('match-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))");
    await fill('p4','p4');await submit();assert.equal(mock.posts,0);
    await fill();assert(await evaluate("document.getElementById('match-preview').textContent.includes('최유진')"));
    await submit();await submit();
    assert(await evaluate("document.querySelector('#match-form fieldset').disabled"));
    await waitFor('!saving');assert.equal(mock.posts,1);assert.equal(mock.matches.length,6);
    assert.equal(await evaluate('data.matches.length'),6);
    assert((await evaluate("document.querySelector('#ranking-table tbody tr').textContent")).includes('최유진'));
    await fill('p1','p4','2026-11-15','0-6, 0-6');await submit();await waitFor('!saving');
    assert.equal(mock.matches.length,6);assert(await evaluate("document.getElementById('match-status').textContent.includes('동일 경기')"));
    mock.mode='fail';await fill('p4','p1','2026-11-16');await submit();await waitFor('!saving');
    assert.equal(mock.matches.length,6);assert.equal(await evaluate("document.getElementById('sets').value"),'6-0, 6-0');
    mock.mode='unknown';await submit();await waitFor('!saving');
    assert.equal(mock.matches.length,7);assert(await evaluate("document.getElementById('match-status').textContent.includes('저장 결과를 확인할 수 없')"));
    mock.mode='ok';await submit();await waitFor('!saving');
    assert.equal(mock.matches.length,7);assert.equal(await evaluate('data.matches.length'),7);
    mock.mode='refresh-fail';await fill('p4','p1','2026-11-17');await submit();await waitFor('!saving');
    assert.equal(mock.matches.length,8);assert(await evaluate("!document.getElementById('match-refresh').hidden"));
    assert(await evaluate("document.getElementById('match-status').textContent.includes('저장은 완료')"));
    const posts=mock.posts;
    mock.mode='ok';await evaluate("document.getElementById('match-refresh').click()");await waitFor('!saving');
    assert.equal(mock.posts,posts);assert.equal(await evaluate('data.matches.length'),8);
    console.log('PASS mock writes: winner preview, double-click protection, atomic refresh and ranking; duplicate A/B swap; failed input preserved; unknown commit retry; read-only recovery after saved refresh failure');
    mock.reset();await evaluate("document.getElementById('refresh').click()");await waitFor("!document.getElementById('app').hidden");
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const hash of ['home','matches','ranking','dashboard','analysis']){
    await evaluate(`location.hash=${JSON.stringify(hash)}`);await sleep(50);
    assert(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Mobile overflow: '+hash);
  }
  console.log('PASS mobile 390px: all five screens have no page-width overflow');
  mode='hold';await evaluate("document.getElementById('refresh').click()");
  await waitFor(''+"!document.getElementById('load-state').hidden && document.getElementById('app').hidden");
  await waitFor('true');
  for(let i=0;i<50&&held.length<2;i++)await sleep(50);
  assert.equal(held.length,2);
  mode='empty';await Promise.all(held.splice(0).map(id=>fulfill(id,[])));
  await waitFor("!document.getElementById('app').hidden");
  assert.deepEqual(await evaluate('[data.players.length,data.matches.length]'),[0,0]);
  for(const id of ['match-list','ranking-table','dashboard-content']) assert(await evaluate(`document.getElementById('${id}').textContent.includes('없')`));
  assert(await evaluate("document.getElementById('demo').disabled"));
  console.log('PASS loading and empty DB states; no sample fallback');
  mode='error';await evaluate("document.getElementById('refresh').click()");
  await waitFor("!document.getElementById('load-error').hidden");
  assert(await evaluate("document.getElementById('app').hidden"));
  assert(await evaluate("document.getElementById('load-message').textContent.includes('502')"));
  mode='wrong-source';await evaluate("document.getElementById('retry').click()");
  await waitFor("!document.getElementById('load-error').hidden && !document.getElementById('retry').disabled");
  assert(await evaluate("document.getElementById('app').hidden"));
  mode='live';await evaluate("document.getElementById('retry').click()");
  await waitFor("!document.getElementById('app').hidden");
  assert.equal(await evaluate('data.matches.length'),5);
  assert(requests.filter(r=>r.url.includes('/api/')).every(r=>r.method==='GET'||(mockWrites&&r.method==='POST'&&r.url===base+'/api/matches')));
  assert(!requests.some(r=>/supabase\.(co|com)|sample-data\.json/.test(r.url)));
  assert.deepEqual(errors,[]);
  console.log('PASS API failure, rejected unknown source, retry recovery; browser uses only local APIs; no JS exceptions');
  if (mockWrites) {
    await evaluate("location.hash = 'analysis'");
    await evaluate(`window.selectPoseTestFile = (parts, name) => {
      const input = document.getElementById('pose-file');
      const files = new DataTransfer();
      files.items.add(new File(parts, name, { type: 'video/mp4' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
    }`);
    await evaluate("selectPoseTestFile(['invalid contents'], 'broken.mp4')");
    await waitFor("document.getElementById('pose-status').textContent.startsWith('영상 파일 오류')");
    assert(await evaluate("document.getElementById('pose-start').disabled"));
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Network.setBlockedURLs', {urls:['*tasks-vision*','*pose-metrics.mjs']});
    await send('Page.reload');
    await waitFor("!document.getElementById('app').hidden");
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      const stream = canvas.captureStream(20);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' });
      const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      let light = false;
      const timer = setInterval(() => {
        light = !light;
        context.fillStyle = light ? '#fff' : '#000';
        context.fillRect(0, 0, 64, 64);
      }, 50);
      await new Promise(resolve => setTimeout(resolve, 1200));
      clearInterval(timer);
      recorder.stop();
      await stopped;
      stream.getTracks().forEach(track => track.stop());
      const input = document.getElementById('pose-file');
      const files = new DataTransfer();
      files.items.add(new File(chunks, 'valid.mp4', { type: 'video/mp4' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    await waitFor("!document.getElementById('pose-start').disabled || document.getElementById('pose-status').textContent.startsWith('영상 파일 오류')");
    assert(await evaluate("!document.getElementById('pose-preview').hidden"), await evaluate("document.getElementById('pose-status').textContent"));
    await evaluate("document.getElementById('pose-start').click()");
    await waitFor("document.getElementById('pose-status').textContent.startsWith('MediaPipe 초기화 오류')");
    assert(await evaluate("!document.getElementById('pose-start').disabled"));
    assert.deepEqual(errors, []);
    console.log('PASS MP4 change events, file errors, readiness without metrics, and MediaPipe startup errors');
  }

  await send('Browser.close',{},null);
} finally {
  socket?.close();
  browser.kill();
  if(mockServer)await new Promise(resolve=>mockServer.close(resolve));
  // Only remove the unique test profile we just created beneath the OS temp dir.
  if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('tennis-lab-browser-')){
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
  }
}
