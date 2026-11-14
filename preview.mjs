// Read-only local static file preview. No application API or database.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=new Set(['index.html','styles.css','core.js','app.js','sample-data.json','STORYBOARD.html','PRD.md','ACCEPTANCE.md','README.md']);
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.md':'text/plain'};
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!files.has(file)){res.writeHead(404);res.end('Not found');return;}
  try{const body=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'text/plain')+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}
  catch{res.writeHead(500);res.end('Unable to read file');}
});
server.on('error',error=>{console.error('Preview failed:',error.message);process.exitCode=1;});
server.listen(4173,'127.0.0.1',()=>console.log('TENNIS LAB: http://127.0.0.1:4173 (Ctrl+C to stop)'));
