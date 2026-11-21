// Local preview with Supabase reads and explicitly enabled development writes.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import Tennis from './core.js';
import {ApiError, configuration, playersFrom, query, readResponse} from './server/read-api.mjs';
import {randomBytes} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
try{process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT') throw Error('Unable to load server .env file');}
const files=new Set(['index.html','styles.css','core.js','app.js','pose-analysis.js','pose-metrics.mjs','pose-3d.mjs','pose-engine.mjs','pose-compare.mjs','pose-phases.mjs','pose-labels.mjs','sample-data.json','STORYBOARD.html','PRD.md','ACCEPTANCE.md','README.md']);
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.md':'text/plain'};
function localRequest(req){
  const origin=`http://127.0.0.1:${req.socket.localPort}`;
  return req.socket.localAddress==='127.0.0.1'&&req.socket.remoteAddress==='127.0.0.1'
    &&req.headers.host===`127.0.0.1:${req.socket.localPort}`
    &&(!req.headers.origin||req.headers.origin===origin)
    &&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin'||req.headers['sec-fetch-site']==='none')
    &&!Object.keys(req.headers).some(name=>name==='forwarded'||name.startsWith('x-forwarded-'));
}
function jsonResponse(req,res,status,body,source='supabase'){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Data-Source':source});
  res.end(req.method==='HEAD'?undefined:JSON.stringify(body));
}
function readJson(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0,done=false;
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(new ApiError(408,'REQUEST_TIMEOUT','요청 본문 수신 시간이 초과되었습니다.')),5000);
    req.on('data',chunk=>{
      if(done)return;
      size+=chunk.length;
      if(size>8192)finish(new ApiError(413,'BODY_TOO_LARGE','요청 본문은 8KB 이하만 허용합니다.'));
      else chunks.push(chunk);
    });
    req.on('end',()=>{
      if(done)return;
      try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch{finish(new ApiError(400,'INVALID_JSON','올바른 JSON 본문을 입력해주세요.'));}
    });
    req.on('error',()=>finish(new ApiError(400,'INVALID_REQUEST','요청을 읽을 수 없습니다.')));
    req.on('aborted',()=>finish(new ApiError(400,'INVALID_REQUEST','요청이 중단되었습니다.')));
  });
}
async function saveMatch(config,input,players,fetchImpl,signal){
  let response;
  const unknown=()=>new ApiError(502,'SAVE_OUTCOME_UNKNOWN','저장 결과를 확인할 수 없습니다. 먼저 DB 새로 조회로 확인해주세요. 같은 입력을 재시도해도 동일 경기는 중복 저장하지 않습니다.');
  try{
    response=await fetchImpl(new URL('/rest/v1/rpc/save_tennis_match',config.url),{
      method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},
      body:JSON.stringify({p_player_a_id:input.a,p_player_b_id:input.b,p_played_at:input.date,p_sets:input.sets}),
      signal,redirect:'error'
    });
  }catch{throw unknown();}
  let body;
  try{body=await response.json();}catch{throw unknown();}
  if(!response.ok){
    if(body?.code==='PGRST202') throw new ApiError(503,'SAVE_FUNCTION_NOT_INSTALLED','저장 함수가 없습니다. supabase/save_match.sql을 SQL Editor에서 먼저 실행해주세요.');
    if(['22023','22007','22008','22P02','23503'].includes(body?.code))throw new ApiError(400,'INVALID_MATCH','선수, 날짜 또는 세트 점수를 확인해주세요.');
    if(['23505','23514'].includes(body?.code))throw new ApiError(409,'MATCH_CONFLICT','기존 경기 데이터가 충돌합니다. DB 기록을 확인해주세요.');
    if(['55P03','57014','40001','40P01'].includes(body?.code))throw new ApiError(503,'SAVE_RETRY_REQUIRED','저장이 완료되지 않았습니다. 잠시 후 같은 입력으로 재시도해주세요.');
    throw new ApiError(502,'SUPABASE_SAVE_FAILED','Supabase 저장 요청이 실패했습니다. 서버 설정과 저장 함수 실행 권한을 확인해주세요.');
  }
  try{
    const m=body.match;
    if(typeof body.created!=='boolean'||typeof m.id!=='string'||!/^\d+$/.test(m.id))throw Error();
    Tennis.validateMatch(m,players,[]);
    if(Tennis.signature(m)!==Tennis.signature(input)||body.winner_id!==(Tennis.validateSets(m.sets).a===2?m.a:m.b))throw Error();
  }catch{throw unknown();}
  return body;
}
export function createPreviewServer({env=process.env,fetchImpl=fetch,timeoutMs=10000}={}){
const csrfToken=randomBytes(32).toString('hex');
const writesEnabled=()=>env.NODE_ENV==='development'&&env.ENABLE_DEV_MATCH_WRITES==='true';
return http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/config'&&['GET','HEAD'].includes(req.method)){
    const enabled=writesEnabled()&&localRequest(req);
    jsonResponse(req,res,200,{matchWritesEnabled:enabled,...(enabled?{csrfToken}:{})},'server');return;
  }
  if(pathname==='/api/matches'&&req.method==='POST'){
    try{
      if(!writesEnabled()||!localRequest(req)||req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`||req.headers['x-csrf-token']!==csrfToken)
        throw new ApiError(403,'DEV_WRITES_FORBIDDEN','경기 저장은 명시적으로 활성화한 로컬 개발 환경에서만 가능합니다.');
      if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))
        throw new ApiError(415,'JSON_REQUIRED','Content-Type: application/json 요청만 허용합니다.');
      const input=await readJson(req);
      if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).sort().join(',')!=='a,b,date,sets'
         ||typeof input.a!=='string'||typeof input.b!=='string'||typeof input.date!=='string'||input.a.length>200||input.b.length>200)
        throw new ApiError(400,'INVALID_MATCH','선수 2명, 날짜, 세트 점수만 입력해주세요. ID와 승자는 서버에서 결정합니다.');
      // Validate structure and scores before any DB request; validate references again below.
      try{Tennis.validateMatch(input,[{id:input.a},{id:input.b}],[]);}catch(error){throw new ApiError(400,'INVALID_MATCH',error.message);}
      const config=configuration(env),signal=AbortSignal.timeout(timeoutMs);
      const players=playersFrom(await query(config,'players','id,name,member_code','id.asc',fetchImpl,signal));
      try{Tennis.validateMatch(input,players,[]);}catch(error){throw new ApiError(400,'INVALID_MATCH',error.message);}
      const result=await saveMatch(config,input,players,fetchImpl,signal);
      jsonResponse(req,res,result.created?201:200,result);
    }catch(error){
      const failure=error instanceof ApiError?error:new ApiError(500,'SAVE_FAILED','경기 저장 처리 중 오류가 발생했습니다.');
      jsonResponse(req,res,failure.status,{source:'supabase',code:failure.code,error:failure.message});
    }
    return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':pathname==='/api/matches'?'GET, HEAD, POST':'GET, HEAD'});res.end();return;}
  if(pathname==='/api/players'||pathname==='/api/matches'){
    const response=await readResponse(pathname.slice('/api/'.length),req.method,{
      env,fetchImpl,timeoutMs,includeMemberCodes:true
    });
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(req.method==='HEAD'?undefined:await response.text());
    return;
  }
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!files.has(file)){res.writeHead(404);res.end('Not found');return;}
  try{const body=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'text/plain')+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}
  catch{res.writeHead(500);res.end('Unable to read file');}
});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const server=createPreviewServer();
server.on('error',error=>{console.error('Preview failed:',error.message);process.exitCode=1;});
server.listen(4173,'127.0.0.1',()=>console.log('TENNIS LAB: http://127.0.0.1:4173 (Ctrl+C to stop)'));
}
