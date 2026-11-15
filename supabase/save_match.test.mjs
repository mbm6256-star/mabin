// Optional embedded PostgreSQL tests. No network, secrets, or Supabase writes.
// Install @electric-sql/pglite in an isolated test folder and set PGLITE_MODULE
// to its dist/index.js, or install it locally as an optional test dependency.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPreviewServer} from '../preview.mjs';
let PGlite;
try{({PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite'));}catch{}

test('save_match SQL: real PostgreSQL validation, idempotency, permissions and atomic rollback',{
  skip:!PGlite&&'Optional PGlite test engine is not installed'
},async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.players (
        id text PRIMARY KEY, name text NOT NULL, member_code text UNIQUE,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.matches (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        player_a_id text NOT NULL REFERENCES public.players(id),
        player_b_id text NOT NULL REFERENCES public.players(id),
        winner_id text NOT NULL REFERENCES public.players(id),
        played_at date NOT NULL DEFAULT current_date,
        created_at timestamptz DEFAULT now(),
        CONSTRAINT different_players CHECK(player_a_id <> player_b_id),
        CONSTRAINT valid_winner CHECK(winner_id = player_a_id OR winner_id = player_b_id)
      );
      CREATE TABLE public.match_sets (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        match_id bigint NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
        set_number integer NOT NULL CHECK(set_number > 0),
        player_a_games integer NOT NULL CHECK(player_a_games >= 0),
        player_b_games integer NOT NULL CHECK(player_b_games >= 0),
        UNIQUE(match_id,set_number)
      );
      ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.match_sets ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
      INSERT INTO public.players(id,name,member_code)
      VALUES('p1','A','TL001'),('p2','B','TL002'),('p3','C','TL003'),('p4','D','TL004');
    `);
    const sql=await readFile(new URL('./save_match.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql); // function SQL can be applied again
    const sample=JSON.parse(await readFile(new URL('../sample-data.json',import.meta.url),'utf8'));
    const save=async m=>(await db.query('SELECT public.save_tennis_match($1,$2,$3::date,$4::jsonb) AS result',[m.a,m.b,m.date,JSON.stringify(m.sets)])).rows[0].result;
    const counts=async()=>(await db.query('SELECT (SELECT count(*)::int FROM public.matches) AS matches, (SELECT count(*)::int FROM public.match_sets) AS sets')).rows[0];
    await db.exec('SET ROLE service_role');
    for(const m of sample.matches){const result=await save(m);assert.equal(result.created,true);assert.deepEqual(result.match.sets,m.sets);}
    assert.deepEqual(await counts(),{matches:5,sets:10});
    const old=await db.query('SELECT id::text,player_a_id,player_b_id,winner_id,played_at::text FROM public.matches ORDER BY id');
    for(const m of sample.matches){
      assert.equal((await save(m)).created,false);
      assert.equal((await save({...m,a:m.b,b:m.a,sets:m.sets.map(([a,b])=>[b,a])})).created,false);
    }
    assert.deepEqual(await counts(),{matches:5,sets:10});
    assert.deepEqual(await db.query('SELECT id::text,player_a_id,player_b_id,winner_id,played_at::text FROM public.matches ORDER BY id'),old);
    const base={a:'p4',b:'p1',date:'2026-11-15',sets:[[6,4],[6,3]]};
    for(const m of [
      {...base,b:'p4'},{...base,b:'missing'},{...base,sets:[[6,5],[6,3]]},
      {...base,sets:[[6,4]]},{...base,sets:[[6,4],[6,3],[0,6]]},
      {...base,sets:[[6.1,4],[6,3]]},{...base,sets:[["6",4],[6,3]]},
      {...base,sets:[null,[6,3]]},{...base,sets:null}
    ]){
      await assert.rejects(save(m));assert.deepEqual(await counts(),{matches:5,sets:10});
    }
    const three=await save({...base,sets:[[7,6],[5,7],[6,0]]});
    assert.equal(three.winner_id,'p4');assert.equal(three.match.sets.length,3);
    await db.exec('RESET ROLE');
    await db.exec(`
      CREATE FUNCTION public.test_fail_set() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Test set insert failure'; END $$;
      CREATE TRIGGER test_set_failure BEFORE INSERT ON public.match_sets
      FOR EACH ROW EXECUTE FUNCTION public.test_fail_set();
    `);
    const before=await counts();
    await assert.rejects(save({...base,date:'2026-11-16'}));
    assert.deepEqual(await counts(),before); // no orphan match after failed sets
    await db.exec('DROP TRIGGER test_set_failure ON public.match_sets');
    for(const role of ['anon','authenticated']){
      await db.exec('SET ROLE '+role);
      await assert.rejects(save(base),error=>error.code==='42501');
      await db.exec('RESET ROLE');
    }
    const meta=(await db.query(`SELECT prosecdef AS definer, provolatile, proconfig FROM pg_proc WHERE oid='public.save_tennis_match(text,text,date,jsonb)'::regprocedure`)).rows[0];
    assert.equal(meta.definer,false);assert.equal(meta.provolatile,'v');
    assert(meta.proconfig.includes('search_path=pg_catalog'));
    assert((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('players','matches','match_sets')")).rows.every(r=>r.relrowsecurity));

    // Exercise the actual Node POST + SQL function together in this isolated DB.
    // PGlite serializes statements on one connection; real multi-session lock
    // scheduling still requires a separate PostgreSQL integration environment.
    const integrationInput={...base,date:'2026-11-18'};
    const integrationBefore=await counts();
    const fakeFetch=async(url,options)=>{
      if(url.pathname.includes('/rpc/')){
        const p=JSON.parse(options.body);
        return Response.json(await save({a:p.p_player_a_id,b:p.p_player_b_id,date:p.p_played_at,sets:p.p_sets}));
      }
      const rows=(await db.query('SELECT id,name,member_code FROM public.players ORDER BY id')).rows;
      return new Response(JSON.stringify(rows),{headers:{'content-range':`0-${rows.length-1}/${rows.length}`}});
    };
    const runServer=async run=>{
      const server=createPreviewServer({env:{NODE_ENV:'development',ENABLE_DEV_MATCH_WRITES:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_TEST_ONLY'},fetchImpl:fakeFetch});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const origin='http://127.0.0.1:'+server.address().port;
      try{
        const config=await(await fetch(origin+'/api/config')).json();
        await run(()=>fetch(origin+'/api/matches',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':config.csrfToken},body:JSON.stringify(integrationInput)}));
      }finally{await new Promise(resolve=>server.close(resolve));}
    };
    await runServer(async post=>{
      const responses=await Promise.all([post(),post()]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
      const results=await Promise.all(responses.map(r=>r.json()));
      assert.equal(results[0].match.id,results[1].match.id);
    });
    await runServer(async post=>assert.equal((await post()).status,200));
    assert.deepEqual(await counts(),{matches:integrationBefore.matches+1,sets:integrationBefore.sets+2});
  }finally{await db.close();}
});
