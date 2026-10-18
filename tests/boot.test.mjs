import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/boot.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(protocol='http:',reject=null){
  const children=Object.fromEntries(['.loading-ring','b','small'].map(key=>[key,{hidden:false,textContent:''}]));
  const loader={hidden:false,querySelector:key=>children[key]};
  const retry={hidden:true,textContent:'重新加载',addEventListener(type,fn){this[type]=fn;}};
  const timers=new Map(),events=new Map();let imports=0,reloads=0;
  const context={document:{querySelector:key=>key==='#loader'?loader:retry},window:{addEventListener:(key,fn)=>events.set(key,fn)},
    location:{protocol,href:protocol==='file:'?'file:///D:/game/index.html':'http://127.0.0.1:4173/',reload(){reloads++;}},
    console:{error(){}},setTimeout(fn){timers.set(1,fn);return 1;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(source,context,{importModuleDynamically:async()=>{
    imports++;if(reject)throw reject;return import('node:path');
  }});
  return {context,loader,retry,children,timers,events,imports:()=>imports,reloads:()=>reloads};
}

test('opening index as file stops module loading and provides the working HTTP destination',async()=>{
  const p=page('file:');await settle();
  assert.equal(p.imports(),0);assert.equal(p.children['.loading-ring'].hidden,true);
  assert.match(p.children.small.textContent,/本地文件/);assert.equal(p.retry.hidden,false);
  assert.equal(p.retry.textContent,'打开本机试玩');p.retry.click();
  assert.equal(p.context.location.href,'http://127.0.0.1:4173/');
});

test('entry-module rejection displays its reason instead of leaving a permanent spinner',async()=>{
  const p=page('http:',new SyntaxError('missing module export'));await settle();
  assert.equal(p.imports(),1);assert.match(p.children.small.textContent,/missing module export/);
  assert.equal(p.children['.loading-ring'].hidden,true);assert.equal(p.retry.hidden,false);
  assert.equal(p.timers.size,0);p.retry.click();assert.equal(p.reloads(),1);
});

test('a stalled initialization times out with a recovery action',async()=>{
  const p=page();await settle();p.timers.get(1)();
  assert.match(p.children.small.textContent,/30 秒/);assert.equal(p.retry.hidden,false);
  assert.equal(p.children['.loading-ring'].hidden,true);
});

test('online loading errors suggest a network retry without asking visitors to start a local server',async()=>{
  const failed=page('https:',new Error('network unavailable'));await settle();
  assert.match(failed.children.small.textContent,/network unavailable/);
  assert.doesNotMatch(failed.children.small.textContent,/启动试玩|本机地址|启动窗口/);
  const stalled=page('https:');await settle();stalled.timers.get(1)();
  assert.match(stalled.children.small.textContent,/网络连接/);
  assert.doesNotMatch(stalled.children.small.textContent,/启动试玩|本机地址|启动窗口/);
});

test('startup progress is visible and successful model initialization clears its timeout',async()=>{
  const p=page();await settle();p.context.window.nailongBoot.phase('模型已读取 50%');
  assert.equal(p.children.small.textContent,'模型已读取 50%');
  p.context.window.nailongBoot.ready();assert.equal(p.timers.size,0);
  p.events.get('error')({message:'later unrelated error'});assert.equal(p.retry.hidden,true);
});
