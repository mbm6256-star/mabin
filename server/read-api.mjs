import Tennis from '../core.js';

export class ApiError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export function configuration(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||env.SUPABASE_SECRET_KEY==='REPLACE_WITH_YOUR_SERVER_SECRET')
    throw new ApiError(503,'SUPABASE_NOT_CONFIGURED','서버 환경변수 SUPABASE_URL과 SUPABASE_SECRET_KEY를 설정해주세요.');
  let url;
  try{url=new URL(env.SUPABASE_URL);}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!env.SUPABASE_SECRET_KEY.startsWith('sb_secret_'))
    throw new ApiError(503,'SUPABASE_CONFIG_INVALID','Supabase HTTPS 프로젝트 URL과 sb_secret_ 서버 키를 확인해주세요.');
  return {url,key:env.SUPABASE_SECRET_KEY};
}
export async function query(config,table,select,order,fetchImpl,signal){
  const rows=[];
  for(;;){
    const url=new URL('/rest/v1/'+table,config.url);
    url.search=new URLSearchParams({select,order,limit:'500',offset:String(rows.length)});
    let response;
    try{
      response=await fetchImpl(url,{headers:{apikey:config.key,Prefer:'count=exact'},signal,redirect:'error'});
    }catch{
      throw new ApiError(502,signal.aborted?'SUPABASE_TIMEOUT':'SUPABASE_UNAVAILABLE',signal.aborted?'Supabase 조회 시간이 초과되었습니다.':'Supabase에 연결할 수 없습니다.');
    }
    if(!response.ok) throw new ApiError(502,'SUPABASE_REQUEST_FAILED',`Supabase 조회 실패 (HTTP ${response.status}). 키, Data API 및 테이블 조회 권한을 확인해주세요.`);
    let page;
    try{page=await response.json();}catch{
      if(signal.aborted) throw new ApiError(502,'SUPABASE_TIMEOUT','Supabase 조회 시간이 초과되었습니다.');
      throw new ApiError(502,'SUPABASE_INVALID_DATA','Supabase JSON 응답을 읽을 수 없습니다.');
    }
    const total=Number(response.headers.get('content-range')?.split('/')[1]);
    if(!Array.isArray(page)||!Number.isSafeInteger(total)||total<0||rows.length+page.length>total||(!page.length&&rows.length<total))
      throw new ApiError(502,'SUPABASE_INVALID_DATA','Supabase 응답 또는 페이지 범위가 올바르지 않습니다.');
    rows.push(...page);
    if(rows.length===total) return rows;
  }
}
function invalidData(){return new ApiError(502,'SUPABASE_INVALID_DATA','Supabase 선수, 경기 또는 세트 데이터가 올바르지 않습니다.');}
export function playersFrom(rows, includeMemberCodes = true){
  const ids=new Set();
  return rows.map(p=>{
    if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||(includeMemberCodes&&p.member_code!==null&&typeof p.member_code!=='string')) throw invalidData();
    ids.add(p.id);
    return {id:p.id,name:p.name,memberCode:includeMemberCodes ? p.member_code??'' : ''};
  });
}
function matchesFrom(rows,players){
  const ids=new Set();
  const seen=[];
  return rows.map(m=>{
    // Cast bigint to text in PostgREST before JSON parsing to preserve precision.
    if(!m||typeof m.id!=='string'||!/^\d+$/.test(m.id)||ids.has(m.id)||!Array.isArray(m.match_sets)) throw invalidData();
    ids.add(m.id);
    const sets=[...m.match_sets].sort((a,b)=>a.set_number-b.set_number);
    if(sets.some((s,i)=>s.set_number!==i+1)) throw invalidData();
    const result={id:m.id,date:m.played_at,a:m.player_a_id,b:m.player_b_id,sets:sets.map(s=>[s.player_a_games,s.player_b_games])};
    try{
      Tennis.validateMatch(result,players,seen);
      if(m.winner_id!==(Tennis.validateSets(result.sets).a===2?result.a:result.b)) throw Error();
    }catch{throw invalidData();}
    seen.push(result);
    return result;
  });
}

export async function readResponse(resource, method, {
  env = process.env, fetchImpl = fetch, timeoutMs = 10000, includeMemberCodes = false
} = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Data-Source': resource === 'config' ? 'server' : 'supabase'
  };
  const respond = (status, data) => new Response(method === 'HEAD' ? null : JSON.stringify(data), { status, headers });

  if (method !== 'GET' && method !== 'HEAD') {
    headers.Allow = 'GET, HEAD';
    return respond(405, { code: 'METHOD_NOT_ALLOWED', error: '공개 환경에서는 조회만 가능합니다.' });
  }
  if (resource === 'config') return respond(200, { matchWritesEnabled: false });

  try {
    const config = configuration(env);
    const signal = AbortSignal.timeout(timeoutMs);
    const fields = includeMemberCodes ? 'id,name,member_code' : 'id,name';
    const players = playersFrom(await query(config, 'players', fields, 'id.asc', fetchImpl, signal), includeMemberCodes);
    if (resource === 'players') return respond(200, players);
    const rows = await query(config, 'matches',
      'id::text,played_at,player_a_id,player_b_id,winner_id,match_sets(set_number,player_a_games,player_b_games)',
      'played_at.asc,id.asc', fetchImpl, signal);
    return respond(200, matchesFrom(rows, players));
  } catch (error) {
    const failure = error instanceof ApiError ? error : invalidData();
    return respond(failure.status, { source: 'supabase', code: failure.code, error: failure.message });
  }
}
