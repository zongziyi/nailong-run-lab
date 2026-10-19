import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LeaderboardClient,normalizeName,validateConfig} from '../src/leaderboard.js';

const config={url:'https://leaderboard.example.test',publishableKey:'sb_publishable_test'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup({storage=new Map(),fail=false}={}){
  const api={session:null,signIns:0,calls:[],failure:fail,submitGate:null,best:{}};
  const backend={auth:{
    getSession:async()=>({data:{session:api.session}}),
    signInAnonymously:async()=>{api.signIns++;api.session={user:{id:`player-${api.signIns}`}};return {data:{session:api.session}};},
  },rpc:async(name,args)=>{
    api.calls.push({name,...args,owner:api.session?.user.id});
    if(api.failure)return {error:new Error('Offline')};
    if(name==='runner_leaderboard_capabilities')return {data:{speedModes:['normal','fast'],oneLifeOnly:true}};
    if(name==='set_runner_name')return {data:{nickname:args.p_nickname,player_code:'abcd1234-unique'}};
    if(name==='submit_runner_score'){
      if(api.submitGate){const gate=api.submitGate;api.submitGate=null;await gate.promise;}
      api.best[args.p_speed_mode]=Math.max(api.best[args.p_speed_mode]??0,args.p_distance);
      return {data:{distance:api.best[args.p_speed_mode]}};
    }
    if(name==='runner_leaderboard')return {data:{entries:[],has_more:false}};
    return {data:null};
  }};
  const options={config,loadSDK:async()=>()=>backend,getStorage:()=>({getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)})};
  return {client:new LeaderboardClient(options),api,storage,options};
}
test('unconfigured/invalid services do not load the SDK or pretend to show an online board',async()=>{
  let loads=0;
  const c=new LeaderboardClient({config:{url:'',publishableKey:''},loadSDK:()=>{loads++;},getStorage:()=>null});
  c.recordRun({mode:1,speedMode:'fast',distance:12.4});await c.flush();assert.equal(loads,0);assert.deepEqual(c.pending,{});
  await assert.rejects(c.page('fast'),/尚未启用/);
  assert.throws(()=>validateConfig({...config,publishableKey:'sb_secret_BAD'}));
  assert.throws(()=>validateConfig({...config,url:'http://example.test'}));
  assert.throws(()=>validateConfig({url:'https://example.test',publishableKey:''}));
});
test('a nickname draft survives refresh and cloud configuration without creating a player or score',async()=>{
  const {options,api}=setup();
  const unconfigured={...options,config:{url:'',publishableKey:''}};
  const first=new LeaderboardClient(unconfigured);assert.equal(first.saveNameDraft(' 鱼叉 '),'鱼叉');
  const refreshed=new LeaderboardClient(unconfigured);assert.equal(refreshed.nicknameDraft,'鱼叉');assert.equal(refreshed.nickname,'');
  const configured=new LeaderboardClient(options);assert.equal(configured.nicknameDraft,'鱼叉');
  await configured.flush();assert.equal(api.signIns,0);assert.deepEqual(configured.pending,{});
  await configured.setName(configured.nicknameDraft);assert.equal(api.signIns,1);assert.equal(configured.nickname,'鱼叉');
  assert.throws(()=>first.saveNameDraft(' '));assert.throws(()=>first.saveNameDraft('a'.repeat(17)));
});
test('first run is optional participation, rounds down meters and creates identity only on saving nickname',async()=>{
  const {client,api}=setup();client.recordRun({mode:1,speedMode:'fast',distance:125.99});await client.page('fast');
  assert.equal(api.signIns,0);assert.equal(client.pending.fast,125);
  await client.setName('  鱼叉  ');assert.equal(api.signIns,1);assert.equal(client.nickname,'鱼叉');
  assert.equal(api.best.fast,125);assert.deepEqual(client.pending,{});
  await client.setName('新昵称');assert.equal(api.signIns,1);
});
test('offline highest scores in each mode survive reload and retry under the same identity',async()=>{
  const {client,api,options}=setup();await client.setName('Runner');api.failure=true;
  client.recordRun({mode:1,speedMode:'fast',distance:600});await client.flush();client.recordRun({mode:1,speedMode:'fast',distance:400});
  client.recordRun({mode:1,speedMode:'normal',distance:100});await client.flush();
  assert.deepEqual(client.pending,{normal:100,fast:600});assert.match(client.statuses.fast,/暂存/);
  const restored=new LeaderboardClient(options);api.failure=false;await restored.flush();
  assert.equal(api.signIns,1);assert.deepEqual(restored.pending,{});assert.deepEqual(api.best,{normal:100,fast:600});
});
test('unnamed offline run remains queued across page reload until the player chooses to participate',async()=>{
  const {client,api,options}=setup();client.recordRun({mode:1,speedMode:'normal',distance:90});
  const restored=new LeaderboardClient(options);assert.equal(restored.pending.normal,90);
  await restored.setName('New runner');assert.equal(api.best.normal,90);
});
test('a slower response cannot erase a newer score or confuse mode after restarting',async()=>{
  const {client,api}=setup();await client.setName('Runner');
  const gate=deferred();api.submitGate=gate;client.recordRun({mode:1,speedMode:'fast',distance:200});await settle();
  client.recordRun({mode:1,speedMode:'fast',distance:700});client.recordRun({mode:1,speedMode:'normal',distance:50});
  assert.equal(client.pending.fast,700);gate.resolve();await client.flush();
  assert.deepEqual(api.best,{normal:50,fast:700});assert.deepEqual(client.pending,{});
  assert.equal(api.calls.filter(call=>call.name==='submit_runner_score'&&call.p_speed_mode==='fast').length,2);
});
test('lost browser identity never transfers the previous player pending score to a new identity',async()=>{
  const {client,api,options}=setup();await client.setName('Old player');api.failure=true;
  client.recordRun({mode:1,speedMode:'fast',distance:999});await client.flush();api.failure=false;api.session=null;
  const restored=new LeaderboardClient(options);await restored.flush();
  assert.deepEqual(restored.pending,{});assert.equal(restored.nickname,'');assert.equal(api.signIns,1);
  await restored.setName('New player');assert.equal(api.signIns,2);assert.deepEqual(api.best,{});
});
test('blocked browser storage falls back to one page memory without breaking participation',async()=>{
  const {api,options}=setup();const client=new LeaderboardClient({...options,getStorage:()=>{throw new Error('Denied');}});
  await client.setName('Memory');client.recordRun({mode:1,speedMode:'fast',distance:10});await client.flush();
  assert.equal(client.snapshot().persistent,false);assert.equal(api.best.fast,10);
  assert.throws(()=>normalizeName('a'.repeat(17)));assert.throws(()=>normalizeName('a\nb'));
  assert.equal(normalizeName('🙂'.repeat(16)),'🙂'.repeat(16));assert.equal(normalizeName('e\u0301'),'é');
  assert.throws(()=>client.recordRun({mode:2,distance:10}));assert.throws(()=>client.recordRun({mode:1,speedMode:'fast',distance:Infinity}));
});
test('a response for a lost identity cannot clear a newly created player queued result',async()=>{
  const {client,api}=setup();await client.setName('Old');
  const gate=deferred();api.submitGate=gate;client.recordRun({mode:1,speedMode:'fast',distance:999});await settle();
  api.session=null;await client.page('fast');assert.equal(client.nickname,'');
  const registration=client.setName('New');await settle();client.recordRun({mode:1,speedMode:'fast',distance:100});
  gate.resolve();await registration;await client.flush();
  assert.ok(api.calls.some(call=>call.name==='submit_runner_score'&&call.owner==='player-2'&&call.p_distance===100));
  assert.deepEqual(client.pending,{});
});


test('storage migration preserves identity/auth and only carries old one-life pending scores once',()=>{
  const {options,storage}=setup(),key='nailong-leaderboard:'+config.url+':v1';
  storage.set(key,JSON.stringify({ownerId:'old-user',nickname:'Keep',playerCode:'keep-code',pending:{1:123,3:999}}));
  storage.set(key+':auth','unchanged-auth-token');
  const a=new LeaderboardClient(options);assert.equal(a.ownerId,'old-user');assert.equal(a.nickname,'Keep');assert.equal(a.playerCode,'keep-code');
  assert.deepEqual(a.pending,{normal:123});assert.equal(storage.get(key+':auth'),'unchanged-auth-token');
  assert.equal(JSON.parse(storage.get(key)).schemaVersion,2);
  a.recordRun({mode:1,speedMode:'fast',distance:222});
  const b=new LeaderboardClient(options);assert.deepEqual(b.pending,{normal:123,fast:222});
  assert.throws(()=>b.recordRun({mode:3,speedMode:'normal',distance:100}),/一条命/);
  assert.throws(()=>b.recordRun({mode:1,speedMode:'typo',distance:100}),/模式/);
});

test('legacy server cannot receive fast scores or masquerade as the fast board; normal submissions still work',async()=>{
  const {client,api}=setup();await client.setName('Runner');
  const backend=await client.client(),original=backend.rpc;let upgraded=false;
  backend.rpc=async(name,args)=>name==='runner_leaderboard_capabilities'?{data:upgraded?{speedModes:['normal','fast'],oneLifeOnly:true}:{version:1}}:original(name,args);
  client.recordRun({mode:1,speedMode:'fast',distance:1000});await client.flush();
  assert.equal(api.calls.filter(c=>c.name==='submit_runner_score').length,0);assert.equal(client.pending.fast,1000);
  assert.match(client.statuses.fast,/待升级/);await assert.rejects(client.page('fast'),/待升级/);
  client.recordRun({mode:1,speedMode:'normal',distance:42});await client.flush();
  assert.equal(api.best.normal,42);assert.equal(api.best.fast,undefined);assert.equal(client.pending.fast,1000);
  upgraded=true;await client.flush();assert.equal(api.best.fast,1000);assert.deepEqual(client.pending,{});
});


test('losing identity during a fast capability check cannot transfer the old score to the next player',async()=>{
  const {client,api}=setup();await client.setName('Old');
  const backend=await client.client(),original=backend.rpc,gate=deferred();
  backend.rpc=async(name,args)=>{if(name==='runner_leaderboard_capabilities')await gate.promise;return original(name,args);};
  client.recordRun({mode:1,speedMode:'fast',distance:999});await settle();
  api.session=null;await client.page('normal');
  const registration=client.setName('New');await settle();client.recordRun({mode:1,speedMode:'fast',distance:100});
  gate.resolve();await registration;await client.flush();
  const submissions=api.calls.filter(c=>c.name==='submit_runner_score');
  assert.ok(submissions.every(c=>c.p_distance!==999));assert.equal(api.best.fast,100);assert.deepEqual(client.pending,{});
});
