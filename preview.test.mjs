import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPreviewServer} from './preview.mjs';

const sample=JSON.parse(await readFile(new URL('./sample-data.json',import.meta.url),'utf8'));
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_TEST_ONLY'};
const players=sample.players.map(p=>({id:p.id,name:p.name,member_code:p.memberCode}));
const matches=sample.matches.map((m,i)=>({
  id:String(i+1),played_at:m.date,player_a_id:m.a,player_b_id:m.b,
  winner_id:m.sets.filter(([a,b])=>a>b).length===2?m.a:m.b,
  match_sets:m.sets.map(([a,b],j)=>({set_number:j+1,player_a_games:a,player_b_games:b})).reverse()
}));
function mockFetch({playerRows=players,matchRows=matches,pageSize=500,status=200}={}){
  return async(url,options)=>{
    assert.equal(url.origin,env.SUPABASE_URL);
    assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);
    assert.equal(options.redirect,'error');
    const rows=url.pathname.endsWith('/players')?playerRows:matchRows;
    if(url.pathname.endsWith('/matches')) assert.match(url.searchParams.get('select'),/id::text/);
    const start=Number(url.searchParams.get('offset'));
    const page=rows.slice(start,start+pageSize);
    return new Response(JSON.stringify(status===200?page:{message:env.SUPABASE_SECRET_KEY}),{
      status,headers:{'content-range':`${start}-${start+page.length-1}/${rows.length}`}
    });
  };
}
async function withServer(options,run){
  const server=createPreviewServer(options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port);}
  finally{await new Promise(resolve=>server.close(resolve));}
}

test('Supabase arrays preserve sample fields, sort ten sets, and paginate capped responses',async()=>{
  await withServer({env,fetchImpl:mockFetch({pageSize:2})},async base=>{
    const p=await fetch(base+'/api/players');
    assert.equal(p.status,200);
    assert.equal(p.headers.get('x-data-source'),'supabase');
    assert.deepEqual(await p.json(),sample.players);
    const m=await fetch(base+'/api/matches');
    assert.equal(m.status,200);
    const body=await m.json();
    assert.deepEqual(body,sample.matches.map((m,i)=>({...m,id:String(i+1)})));
    assert.equal(body.reduce((n,m)=>n+m.sets.length,0),10);
  });
});
test('bigint IDs retain precision; nullable member_code respects DB schema',async()=>{
  const rows=structuredClone(matches);
  rows[0].id='9007199254740993';
  await withServer({env,fetchImpl:mockFetch({matchRows:rows,playerRows:players.map(p=>({...p,member_code:null}))})},async base=>{
    assert.equal((await (await fetch(base+'/api/matches')).json())[0].id,'9007199254740993');
    assert.equal((await (await fetch(base+'/api/players')).json())[0].memberCode,'');
  });
});
test('missing or invalid settings return explicit 503 without reading sample data',async()=>{
  for(const config of [{},{...env,SUPABASE_URL:'http://test.supabase.co'},{...env,SUPABASE_SECRET_KEY:'publishable'}]){
    await withServer({env:config,fetchImpl:()=>assert.fail('must not request DB')},async base=>{
      for(const route of ['/api/players','/api/matches']){
        const res=await fetch(base+route);
        assert.equal(res.status,503);
        const body=await res.json();
        assert.equal(body.source,'supabase');
        assert.match(body.code,/^SUPABASE_(NOT_CONFIGURED|CONFIG_INVALID)$/);
        assert(!Array.isArray(body));
      }
    });
  }
});
test('upstream permission errors and network errors do not expose keys or fallback data',async()=>{
  for(const fetchImpl of [mockFetch({status:403}),async()=>{throw Error(env.SUPABASE_SECRET_KEY);}]){
    await withServer({env,fetchImpl},async base=>{
      const res=await fetch(base+'/api/matches');
      assert.equal(res.status,502);
      const text=await res.text();
      assert(!text.includes(env.SUPABASE_SECRET_KEY));
      assert.equal(JSON.parse(text).source,'supabase');
    });
  }
});
test('timeouts return SUPABASE_TIMEOUT',async()=>{
  await withServer({env,timeoutMs:10,fetchImpl:async(_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })},async base=>{
    const res=await fetch(base+'/api/players');
    assert.equal(res.status,502);
    assert.equal((await res.json()).code,'SUPABASE_TIMEOUT');
  });
});
test('invalid winners, missing players, invalid scores, missing/duplicate set numbers fail closed',async()=>{
  const changes=[
    m=>{m.winner_id='p1';},m=>{m.player_a_id='missing';},
    m=>{m.match_sets[0].player_a_games=8;},m=>{m.match_sets.pop();},
    m=>{m.match_sets[0].set_number=1;}
  ];
  for(const change of changes){
    const rows=structuredClone(matches);change(rows[0]);
    await withServer({env,fetchImpl:mockFetch({matchRows:rows})},async base=>{
      const res=await fetch(base+'/api/matches');
      assert.equal(res.status,502);
      assert.equal((await res.json()).code,'SUPABASE_INVALID_DATA');
    });
  }
});
test('malformed JSON and untrustworthy pagination fail explicitly',async()=>{
  for(const fetchImpl of [async()=>new Response('not json'),async()=>new Response('[]')]){
    await withServer({env,fetchImpl},async base=>{
      const res=await fetch(base+'/api/players');
      assert.equal(res.status,502);
      assert.equal((await res.json()).code,'SUPABASE_INVALID_DATA');
    });
  }
});
test('empty DB is an empty array, never sample data',async()=>{
  await withServer({env,fetchImpl:mockFetch({playerRows:[],matchRows:[]})},async base=>{
    for(const route of ['/api/players','/api/matches']) assert.deepEqual(await (await fetch(base+route)).json(),[]);
  });
});
test('static website is unchanged; environment and server files are private; methods remain read-only',async()=>{
  await withServer({env,fetchImpl:mockFetch()},async base=>{
    for(const file of ['index.html','app.js','core.js','styles.css','pose-analysis.js','pose-metrics.mjs','sample-data.json']){
      const res=await fetch(base+'/'+file);
      assert.equal(res.status,200);
      if (file==='pose-metrics.mjs') assert.match(res.headers.get('content-type'), /^text\/javascript/);
      assert.equal(await res.text(),await readFile(new URL('./'+file,import.meta.url),'utf8'));
    }
    for(const route of ['/.env','/.env.example','/preview.mjs','/api/missing']) assert.equal((await fetch(base+route)).status,404);
    assert.equal((await fetch(base+'/api/players',{method:'POST'})).status,405);
    const head=await fetch(base+'/api/matches',{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
  });
});
