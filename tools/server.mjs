import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const localUrl=`http://127.0.0.1:${port}/`;
const autoOpen=process.argv.includes('--open');
function openPreview(){
  if(!autoOpen||process.platform!=='win32')return;
  const opener=spawn('rundll32.exe',['url.dll,FileProtocolHandler',localUrl],{windowsHide:true,stdio:'ignore'});
  opener.on('error',()=>console.log(`未能自动打开浏览器，请手动访问 ${localUrl}`));
  opener.unref();
}
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml' };
const server = http.createServer(async (req,res) => {
  try {
    let requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requestPath === '/') requestPath = '/index.html';
    const target = path.resolve(root, `.${requestPath}`);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(p=>p.startsWith('.')) || relative.startsWith(`assets${path.sep}source`)) {
      res.writeHead(403);res.end('Forbidden');return;
    }
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const body = await readFile(target);
    res.writeHead(200, {'Content-Type':types[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.on('error',async e=>{
  if(e.code==='EADDRINUSE'&&autoOpen){
    try{
      const response=await fetch(localUrl,{signal:AbortSignal.timeout(3000)});
      const html=await response.text();
      if(response.ok&&html.includes('NAILONG RUN LAB')&&html.includes('id="stage"')){
        console.log(`试玩服务已运行，正在打开 ${localUrl}`);openPreview();return;
      }
    }catch{}
  }
  console.error(e.code==='EADDRINUSE'?`端口 ${port} 已占用；请检查已有试玩窗口，或设置 PORT 后重试。`:e);
  process.exitCode=1;
});
server.listen(port,'127.0.0.1',()=>{console.log(`奶龙快跑 · 本机试玩 ${localUrl}`);openPreview();});
