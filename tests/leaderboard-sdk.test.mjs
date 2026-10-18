import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {LeaderboardClient} from '../src/leaderboard.js';

test('the shipped official UMD SDK creates an anonymous session and sends authenticated RPCs (no real network)',async()=>{
  const source=await readFile(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js',import.meta.url),'utf8');
  const dom=new JSDOM('',{url:'https://game.example.test/',runScripts:'outside-only'});
  for(const key of ['Headers','Request','Response','AbortController'])dom.window[key]=globalThis[key];
  dom.window.eval(source);assert.equal(typeof dom.window.supabase.createClient,'function');
  const originalFetch=globalThis.fetch,calls=[],storage=new Map();let sdk;
  const user={id:'00000000-0000-4000-8000-000000000001',is_anonymous:true,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated'})}.test-signature`;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)),headers=new Headers(init.headers),body=JSON.parse(init.body||'{}');
    calls.push({url,headers,body});
    let result;
    if(url.pathname==='/auth/v1/signup')result={user,access_token:token,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer'};
    else if(url.pathname.endsWith('/set_runner_name'))result={nickname:body.p_nickname,player_code:'public-code'};
    else if(url.pathname.endsWith('/submit_runner_score'))result={distance:body.p_distance,improved:true};
    else if(url.pathname.endsWith('/runner_leaderboard'))result={entries:[],has_more:false};
    else if(url.pathname.endsWith('/runner_personal_best'))result={nickname:'SDK test',player_code:'public-code',distance:123,rank:1};
    else throw new Error(`Unexpected request: ${url.pathname}`);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const client=new LeaderboardClient({config:{url:'https://project.example.test',publishableKey:'sb_publishable_test'},
      getStorage:()=>({getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}),
      loadSDK:async()=>(...args)=>{sdk=dom.window.supabase.createClient(...args);return sdk;}});
    client.recordRun({mode:3,distance:123.9});await client.setName('SDK test');const board=await client.page(3);
    assert.equal(board.me.distance,123);assert.deepEqual(client.pending,{});
    assert.equal(calls.filter(call=>call.url.pathname==='/auth/v1/signup').length,1);
    const submit=calls.find(call=>call.url.pathname.endsWith('/submit_runner_score'));
    assert.equal(submit.headers.get('apikey'),'sb_publishable_test');
    assert.equal(submit.headers.get('authorization'),`Bearer ${token}`);
    assert.deepEqual(submit.body,{p_mode:3,p_distance:123});
    assert.ok([...storage.keys()].some(key=>key.endsWith(':auth')));
  }finally{sdk?.auth.stopAutoRefresh();dom.window.close();globalThis.fetch=originalFetch;}
});
