import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewServer} from './preview.mjs';
import http from 'node:http';
const env={NODE_ENV:'development',ENABLE_DEV_MATCH_WRITES:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_TEST_ONLY'};
const input={a:'p1',b:'p2',date:'2026-11-15',sets:[[6,4],[6,3]]};
const players=[{id:'p1',name:'A',member_code:'TL001'},{id:'p2',name:'B',member_code:'TL002'}];
async function withServer(options,run){
  const server=createPreviewServer(options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{await run(base);}finally{await new Promise(resolve=>server.close(resolve));}
}
function upstream({rpcResponse,rpcStatus=200}={}){
  const calls=[];
  return {calls,fetchImpl:async(url,options)=>{
    calls.push({path:url.pathname,options});
    assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);
    if(url.pathname.endsWith('/players'))return new Response(JSON.stringify(players),{headers:{'content-range':'0-1/2'}});
    assert.equal(url.pathname,'/rest/v1/rpc/save_tennis_match');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    const p=JSON.parse(options.body);
    assert.deepEqual(Object.keys(p).sort(),['p_played_at','p_player_a_id','p_player_b_id','p_sets']);
    return new Response(JSON.stringify(rpcResponse??{created:true,winner_id:'p1',match:{id:'9007199254740993',...input}}),{status:rpcStatus});
  }};
}
async function post(base,body=input,extra={}){
  const config=await (await fetch(base+'/api/config')).json();
  return fetch(base+'/api/matches',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':config.csrfToken??'',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
}
test('writes default off and production off even with enable flag; no secret in config',async()=>{
  for(const config of [{...env,NODE_ENV:'production'},{...env,NODE_ENV:undefined},{...env,ENABLE_DEV_MATCH_WRITES:'false'}]){
    await withServer({env:config,fetchImpl:()=>assert.fail('DB must not be contacted')},async base=>{
      const res=await fetch(base+'/api/config');const body=await res.json();
      assert.deepEqual(body,{matchWritesEnabled:false});
      assert.equal(res.headers.get('cache-control'),'no-store');
      assert.equal((await post(base)).status,403);
    });
  }
});
test('origin, Host, CSRF, proxy and cross-site guards reject before DB access',async()=>{
  await withServer({env,fetchImpl:()=>assert.fail('DB must not be contacted')},async base=>{
    for(const headers of [{Origin:'https://evil.test'},{'X-CSRF-Token':'bad'},
      {'X-Forwarded-For':'127.0.0.1'},{Forwarded:'for=127.0.0.1'},{'Sec-Fetch-Site':'cross-site'}]){
      assert.equal((await post(base,input,headers)).status,403,JSON.stringify(headers));
    }
    const config=await(await fetch(base+'/api/config')).json();
    const badHost=await new Promise((resolve,reject)=>{
      const req=http.request(base+'/api/matches',{method:'POST',headers:{Host:'evil.test',Origin:base,'Content-Type':'application/json','X-CSRF-Token':config.csrfToken}},res=>{res.resume();resolve(res.statusCode);});
      req.on('error',reject);req.end(JSON.stringify(input));
    });
    assert.equal(badHost,403);
    assert.equal((await fetch(base+'/api/matches',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':config.csrfToken},body:JSON.stringify(input)})).status,403);
    const cross=await(await fetch(base+'/api/config',{headers:{Origin:'https://evil.test'}})).json();
    assert.deepEqual(cross,{matchWritesEnabled:false});
  });
});
test('body format, size, scores, dates, same player, extra fields and unknown players rejected',async()=>{
  const mock=upstream();
  await withServer({env,fetchImpl:mock.fetchImpl},async base=>{
    assert.equal((await post(base,input,{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post(base,'{broken')).status,400);
    assert.equal((await post(base,'x'.repeat(8193))).status,413);
    const invalid=[null,[],{...input,b:'p1'},{...input,date:'2026-02-30'},
      {...input,sets:[[6,5],[6,3]]},{...input,sets:[[6,4]]},
      {...input,sets:[[6,4],[6,3],[0,6]]},{...input,sets:[[-1,6],[6,3]]},
      {...input,winner_id:'p2'},{...input,id:'123'},{...input,a:42}];
    for(const value of invalid)assert.equal((await post(base,JSON.stringify(value))).status,400);
    assert.equal(mock.calls.length,0);
    assert.equal((await post(base,{...input,b:'unknown'})).status,400);
    assert.equal(mock.calls.length,1); // roster read only, no RPC
  });
});
test('created and duplicate responses, reversed players, and bigint IDs',async()=>{
  for(const created of [true,false]){
    const mock=upstream({rpcResponse:{created,winner_id:'p1',match:{id:'9007199254740993',...input}}});
    await withServer({env,fetchImpl:mock.fetchImpl},async base=>{
      const res=await post(base,created?input:{...input,a:'p2',b:'p1',sets:[[4,6],[3,6]]});
      assert.equal(res.status,created?201:200);
      assert.equal(res.headers.get('x-data-source'),'supabase');
      assert.equal((await res.json()).match.id,'9007199254740993');
      assert.equal(mock.calls.length,2);
    });
  }
});
test('RPC errors are mapped without leaking upstream body or key',async()=>{
  for(const [code,status,expected] of [['PGRST202',404,503],['22023',400,400],['23503',409,400],['23514',400,409],['23505',409,409],['55P03',500,503],['42501',403,502]]){
    const mock=upstream({rpcResponse:{code,message:env.SUPABASE_SECRET_KEY},rpcStatus:status});
    await withServer({env,fetchImpl:mock.fetchImpl},async base=>{
      const res=await post(base);assert.equal(res.status,expected);
      assert(!(await res.text()).includes(env.SUPABASE_SECRET_KEY));
    });
  }
});
test('unconfirmed commit, malformed success and conflicting winner are never reported as success',async()=>{
  for(const mode of ['network','json','winner']){
    const mock=upstream({rpcResponse:{created:true,winner_id:'p2',match:{id:'1',...input}}});
    await withServer({env,fetchImpl:async(url,options)=>{
      if(url.pathname.includes('/rpc/')&&mode==='network')throw Error(env.SUPABASE_SECRET_KEY);
      if(url.pathname.includes('/rpc/')&&mode==='json')return new Response('bad json');
      return mock.fetchImpl(url,options);
    }},async base=>{
      const res=await post(base);assert.equal(res.status,502);
      assert.equal((await res.json()).code,'SAVE_OUTCOME_UNKNOWN');
    });
  }
});
