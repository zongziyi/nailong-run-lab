import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {LeaderboardClient,validateConfig} from '../src/leaderboard.js';
import {createUniCloudTransport} from '../src/unicloud-transport.js';
const require=createRequire(import.meta.url);
const {createHandler}=require('../uniCloud-aliyun/cloudfunctions/nailong-leaderboard/index.js');
const origin='https://zongziyi.github.io';
const config={provider:'unicloud',spaceId:'mp-6e5e447f-183a-4a77-9646-2a9e9f68753d',endpoint:'https://cloud.example.test/nailong-leaderboard'};
const nested=(value,path)=>path.split('.').reduce((v,key)=>v?.[key],value);

// A local SDK contract double, not a real cloud database. Transactions serialize
// the document snapshots so handler retries, permissions and races can be tested.
function fakeDatabase(){
  let records=new Map(),tail=Promise.resolve();const stats={transactions:0,conflicts:0};
  function collection(get){
    const state={where:{},order:[],skip:0,limit:Infinity};
    const api={
      where(value){state.where=value;return api;},orderBy(key,direction){state.order.push([key,direction]);return api;},
      skip(value){state.skip=value;return api;},limit(value){state.limit=value;return api;},field(){return api;},
      async add(doc){assert.ok(!get().has(doc._id));get().set(doc._id,structuredClone(doc));return {id:doc._id};},
      doc(id){return {
        async get(){const doc=get().get(id);return {data:doc?[structuredClone(doc)]:[]};},
        async update(value){const doc=get().get(id);if(!doc)throw new Error('Missing document');get().set(id,{...doc,...structuredClone(value)});return {updated:1};},
      };},
      async get(){
        const rows=[...get().values()].filter(row=>Object.entries(state.where).every(([key,condition])=>{
          const value=nested(row,key);return condition.op==='gte'?value>=condition.value:value>condition.value;
        })).sort((a,b)=>{
          for(const [key,direction] of state.order){const av=nested(a,key),bv=nested(b,key);if(av!==bv)return (av>bv?1:-1)*(direction==='desc'?-1:1);}return 0;
        });return {data:structuredClone(rows.slice(state.skip,state.skip+state.limit))};
      },
      async count(){const result=await api.get();return {total:result.data.length};},
    };return api;
  }
  return {command:{gte:value=>({op:'gte',value}),gt:value=>({op:'gt',value})},
    collection:()=>collection(()=>records),stats,
    async startTransaction(){
      const wait=tail;let release;tail=new Promise(resolve=>release=resolve);await wait;stats.transactions++;
      const copy=structuredClone(records);let done=false;
      return {collection:()=>collection(()=>copy),async commit(){
        if(stats.conflicts>0){stats.conflicts--;throw new Error('Write conflict');}
        records=copy;if(!done){done=true;release();}
      },async rollback(){if(!done){done=true;release();}}};
    },
  };
}
function setup(){
  const db=fakeDatabase();let time=1000;const handler=createHandler({db,now:()=>time++});
  async function request(action,args={},token,extra={}){
    const response=await handler({httpMethod:'POST',headers:{origin,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...args}),...extra});
    return {...response,json:response.body?JSON.parse(response.body):null};
  }
  const register=async name=>{const {data}=((await request('register')).json);if(name)await request('set_name',{nickname:name},data.token);return data;};
  return {db,handler,request,register};
}
test('Space ID alone leaves the board disabled; actual HTTPS endpoint enables uniCloud',()=>{
  assert.equal(validateConfig({...config,endpoint:''}),false);assert.equal(validateConfig(config),true);
  assert.throws(()=>validateConfig({...config,endpoint:'http://example.test'}));
  assert.throws(()=>validateConfig({...config,spaceId:'invalid'}));
});
test('single function authenticates opaque tokens, separates duplicate names and never exposes internal IDs',async()=>{
  const {request,register}=setup();const a=await register('奶龙'),b=await register('奶龙');
  assert.match(a.token,/^[a-f0-9]{64}$/);assert.notEqual(a.token,b.token);
  assert.equal((await request('submit_score',{mode:1,speedMode:'fast',distance:500},a.token)).statusCode,200);
  await request('submit_score',{mode:1,speedMode:'fast',distance:200},b.token);
  const board=(await request('board',{mode:1,speedMode:'fast'},a.token)).json.data;
  assert.equal(board.entries.length,2);assert.equal(board.me.distance,500);
  assert.deepEqual(Object.keys(board.entries[0]).sort(),['achieved_at','distance','nickname','player_code','rank']);
  assert.ok(!JSON.stringify(board).includes(a.token));assert.ok(!JSON.stringify(board).includes('_id'));
  await request('set_name',{nickname:'改名',userId:b.userId},a.token);
  const renamed=(await request('board',{mode:1,speedMode:'fast'})).json.data;
  assert.equal(renamed.entries[0].nickname,'改名');assert.equal(renamed.entries[1].nickname,'奶龙');
  assert.equal((await request('set_name',{nickname:'入侵'})).statusCode,401);
  assert.equal((await request('submit_score',{mode:1,speedMode:'fast',distance:999},'a'.repeat(64))).statusCode,401);
});
test('transactional maximum is per mode; repeated/lower results keep the original achievement time',async()=>{
  const {db,request,register}=setup();const player=await register('鱼叉');
  await request('submit_score',{mode:1,speedMode:'fast',distance:100},player.token);
  db.stats.conflicts=1;
  const replies=await Promise.all([500,200,300].map(distance=>request('submit_score',{mode:1,speedMode:'fast',distance},player.token)));
  assert.ok(replies.every(reply=>reply.statusCode===200));
  const before=(await request('board',{mode:1,speedMode:'fast'})).json.data.entries[0];
  await request('submit_score',{mode:1,speedMode:'fast',distance:500},player.token);
  await request('submit_score',{mode:1,speedMode:'normal',distance:80},player.token);
  const after=(await request('board',{mode:1,speedMode:'fast'})).json.data.entries[0];
  assert.equal(after.distance,500);assert.equal(after.achieved_at,before.achieved_at);
  assert.equal((await request('board',{mode:1,speedMode:'normal'})).json.data.entries[0].distance,80);
  assert.ok(db.stats.transactions>=6);
});
test('global competition rank continues across page boundaries including ties and personal best outside page',async()=>{
  const {request,register}=setup();let last;
  for(let i=0;i<23;i++){last=await register(`玩家${i}`);await request('submit_score',{mode:1,speedMode:'fast',distance:i<2?900:800-i},last.token);}
  const first=(await request('board',{mode:1,speedMode:'fast'},last.token)).json.data;
  assert.equal(first.entries.length,20);assert.equal(first.has_more,true);assert.equal(first.me.rank,23);
  assert.deepEqual(first.entries.slice(0,3).map(row=>row.rank),[1,1,3]);
  const tiePage=(await request('board',{mode:1,speedMode:'fast',offset:1,limit:1})).json.data;
  assert.equal(tiePage.entries[0].rank,1);
  const end=(await request('board',{mode:1,speedMode:'fast',offset:20})).json.data;
  assert.equal(end.entries[0].rank,21);assert.equal(end.has_more,false);
});
test('origin/method/body validation, preflight, malformed scores and internal error redaction',async()=>{
  const {handler,request,register}=setup();const a=await register('玩家');
  assert.equal((await request('health',{},null,{headers:{origin:'https://untrusted.test'}})).statusCode,403);
  const local=await request('health',{},null,{headers:{origin:'http://127.0.0.1:4188'}});
  assert.equal(local.statusCode,200);assert.equal(local.headers['access-control-allow-origin'],'http://127.0.0.1:4188');
  assert.equal((await request('health',{},null,{httpMethod:'GET'})).statusCode,405);
  const preflight=await request('health',{},null,{httpMethod:'OPTIONS'});assert.equal(preflight.statusCode,204);assert.equal(preflight.headers['access-control-allow-origin'],origin);
  assert.equal((await request('health',{},null,{body:'{broken'})).statusCode,400);
  assert.equal((await request('health',{},null,{body:'x'.repeat(9000)})).statusCode,413);
  assert.equal((await request('health',{},null,{body:Buffer.from('{"action":"health"}').toString('base64'),isBase64Encoded:true})).statusCode,200);
  for(const [mode,distance] of [[2,1],[1,-1],[3,1.2],[3,Number.MAX_SAFE_INTEGER+1]])assert.equal((await request('submit_score',{mode,distance},a.token)).statusCode,400);
  assert.equal((await request('set_name',{nickname:'\n'},a.token)).statusCode,400);
  const broken=createHandler({db:{collection(){throw new Error('secret internal details');}}});
  const response=await broken({httpMethod:'POST',headers:{origin},body:'{"action":"register"}'});
  assert.equal(response.statusCode,503);assert.ok(!response.body.includes('secret'));
  assert.equal((await handler({httpMethod:'POST',headers:{origin},body:'{"action":"health"}'})).statusCode,200);
});
test('gateway and function headers merge without duplicate CORS origins for local and hosted pages',async()=>{
  const {request}=setup();
  for(const source of ['http://127.0.0.1:4173','http://localhost:4173','http://127.0.0.1:4188','http://localhost:4188',origin]){
    const response=await request('health',{},null,{headers:{origin:source}});
    // Model the gateway adding lowercase CORS keys to allowed local requests.
    // HTTP treats case variants as the same field, while the JSON merge does not.
    const gateway=source.startsWith('http:')?{'access-control-allow-origin':source}:{};
    const headers=new Headers({...gateway,...response.headers});
    assert.equal(headers.get('access-control-allow-origin'),source);
    assert.equal(headers.get('access-control-allow-origin').includes(','),false);
  }
  const rejected=await request('health',{},null,{headers:{origin:'http://untrusted.test:4173'}});
  assert.equal(rejected.statusCode,403);
  assert.equal(new Headers(rejected.headers).has('access-control-allow-origin'),false);
});

test('HTTP transport persists one browser identity, combines board and me, and clears rejected tokens',async()=>{
  const {handler}=setup();const values=new Map(),calls=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const fetch=async(url,init)=>{
    calls.push(JSON.parse(init.body));const response=await handler({httpMethod:'POST',headers:{origin,...init.headers},body:init.body});
    return new Response(response.body,{status:response.statusCode});
  };
  const a=createUniCloudTransport(config,{storage,storageKey:'auth-a',fetch});
  assert.equal((await a.auth.getSession()).data.session,null);
  await a.auth.signInAnonymously();await a.rpc('set_runner_name',{p_nickname:'玩家'});await a.rpc('submit_runner_score',{p_mode:1,p_speed_mode:'fast',p_distance:77});
  const reloaded=createUniCloudTransport(config,{storage,storageKey:'auth-a',fetch});
  assert.ok((await reloaded.auth.getSession()).data.session);const board=await reloaded.getBoard('fast',0);
  assert.equal(board.me.distance,77);assert.equal(calls.filter(call=>call.action==='register').length,1);
  const bad=createUniCloudTransport(config,{storage,storageKey:'invalid',fetch:async()=>new Response('{"ok":false,"error":"expired"}',{status:401})});
  await assert.rejects(bad.getBoard('fast',0),/expired/);
});
test('real client uses uniCloud transport without Supabase SDK and preserves pending retries',async()=>{
  const {handler}=setup();const original=globalThis.fetch,values=new Map();let offline=false,loads=0;
  globalThis.fetch=async(url,init)=>{
    if(offline)throw new Error('Offline');
    const response=await handler({httpMethod:'POST',headers:{origin,...init.headers},body:init.body});return new Response(response.body,{status:response.statusCode});
  };
  try{
    const options={config,getStorage:()=>({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}),loadSDK:()=>{loads++;throw new Error('Not expected');}};
    const a=new LeaderboardClient(options);a.recordRun({mode:1,speedMode:'fast',distance:125.9});await a.setName('鱼叉');assert.equal(loads,0);
    offline=true;a.recordRun({mode:1,speedMode:'fast',distance:500});await a.flush();assert.equal(a.pending.fast,500);
    offline=false;const refreshed=new LeaderboardClient(options);await refreshed.flush();const board=await refreshed.page('fast');
    assert.equal(board.me.distance,500);assert.deepEqual(refreshed.pending,{});assert.equal(loads,0);
  }finally{globalThis.fetch=original;}
});


test('old ordinary one-life records survive while fast scores, rankings and timestamps stay independent',async()=>{
  const {db,request,register}=setup();const a=await register('Keep');
  const key=(await import('node:crypto')).createHash('sha256').update(a.token).digest('hex');
  await db.collection('nailong-players').doc(key).update({best_1:{distance:123,at:1000},best_3:{distance:999,at:900}});
  assert.equal((await request('board',{mode:1})).json.data.entries[0].distance,123);
  assert.equal((await request('board',{mode:1,speedMode:'fast'})).json.data.entries.length,0);
  await request('submit_score',{mode:1,speedMode:'fast',distance:800},a.token);
  assert.equal((await request('board',{mode:1})).json.data.entries[0].distance,123);
  assert.equal((await request('board',{mode:1,speedMode:'fast'})).json.data.entries[0].distance,800);
  for(const action of ['board','submit_score']){
    assert.equal((await request(action,{mode:3,distance:100},a.token)).statusCode,400);
    assert.equal((await request(action,{mode:1,speedMode:'invalid',distance:100},a.token)).statusCode,400);
  }
  assert.equal((await db.collection('nailong-players').doc(key).get()).data[0].best_3.distance,999);
  const health=(await request('health')).json.data;assert.equal(health.oneLifeOnly,true);assert.deepEqual(health.speedModes,['normal','fast']);
});
