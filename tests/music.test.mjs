import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameMusic} from '../src/music.js';

const running={mode:'run',paused:false,gameOver:false};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class AudioStub {
  constructor(){this.paused=true;this.currentTime=0;this.duration=138;this.plays=0;this.loads=0;this.events=new Map();this.requests=[];}
  addEventListener(type,callback){this.events.set(type,callback);}
  emit(type){this.events.get(type)?.();}
  pause(){this.paused=true;}
  play(){this.plays++;this.paused=false;return this.requests.shift()?.()??Promise.resolve();}
  load(){this.loads++;this.currentTime=0;}
}
function setup(options={}){const audio=new AudioStub();const music=new GameMusic(audio,{getStorage:()=>null,...options});return {audio,music};}

test('one looping player starts at 35 percent only when the game runs',async()=>{
  const {audio,music}=setup();music.sync({mode:'inspect'});
  assert.equal(audio.plays,0);assert.equal(audio.volume,.35);assert.equal(audio.loop,true);
  music.sync(running,{restart:true});await settle();
  for(let i=0;i<100;i++)music.sync(running);
  assert.equal(audio.plays,1);assert.equal(audio.paused,false);
  audio.currentTime=17;music.sync({...running,paused:true});
  assert.equal(audio.paused,true);assert.equal(audio.currentTime,17);
  music.sync(running,{retry:true});await settle();
  assert.equal(audio.paused,false);assert.equal(audio.currentTime,17);
  music.sync(running,{restart:true});await settle();assert.equal(audio.currentTime,0);
  audio.currentTime=12;music.sync({...running,gameOver:true});
  assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
  music.sync(running,{restart:true});await settle();
  music.sync({mode:'inspect'});assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
});

test('mute is persisted and unmuting continues the same track only during a run',async()=>{
  const values=new Map(),getStorage=()=>({getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)});
  const {audio,music}=setup({getStorage});music.sync(running);await settle();audio.currentTime=23;
  music.toggleMuted();assert.equal(audio.muted,true);assert.equal(audio.paused,true);
  music.sync(running,{restart:true});assert.equal(audio.plays,1);
  const restored=setup({getStorage});assert.equal(restored.music.muted,true);
  music.toggleMuted();await settle();assert.equal(audio.paused,false);
  audio.currentTime=23;music.toggleMuted();music.toggleMuted();await settle();assert.equal(audio.currentTime,23);
  music.sync({...running,paused:true});const plays=audio.plays;
  music.toggleMuted();music.toggleMuted();assert.equal(audio.plays,plays);
  assert.equal(setup({getStorage}).music.muted,false);
});

test('unavailable storage does not prevent playing or toggling mute',async()=>{
  for(const getStorage of [()=>{throw new Error('blocked');},()=>({getItem(){throw new Error('read blocked');},setItem(){throw new Error('write blocked');}})]){
    const {music,audio}=setup({getStorage});music.sync(running);await settle();
    music.toggleMuted();music.toggleMuted();await settle();assert.equal(audio.paused,false);
  }
});

test('delayed play cannot revive music after pause, mute, exit or game over',async()=>{
  for(const stop of [music=>music.sync({...running,paused:true}),music=>music.toggleMuted(),
    music=>music.sync({mode:'inspect'}),music=>music.sync({...running,gameOver:true})]){
    const {audio,music}=setup(),request=deferred();audio.requests.push(()=>request.promise);
    music.sync(running);stop(music);
    audio.paused=false;audio.emit('playing');assert.equal(audio.paused,true);
    audio.paused=false;request.resolve();await settle();assert.equal(audio.paused,true);
  }
});

test('stale rejection cannot interrupt a newer play request',async()=>{
  const {audio,music}=setup(),old=deferred();audio.requests.push(()=>old.promise);
  music.sync(running);music.sync(running,{restart:true});await settle();
  old.reject(new Error('old request aborted'));await settle();
  assert.equal(audio.paused,false);assert.equal(music.issue,null);
});

test('autoplay denial waits for an explicit retry rather than retrying every frame',async()=>{
  const {audio,music}=setup();audio.requests.push(()=>Promise.reject(Object.assign(new Error('gesture needed'),{name:'NotAllowedError'})));
  music.sync(running);await settle();assert.equal(music.issue,'blocked');assert.equal(audio.paused,true);
  for(let i=0;i<100;i++)music.sync(running);assert.equal(audio.plays,1);
  music.sync(running,{retry:true});await settle();assert.equal(audio.paused,false);assert.equal(music.issue,null);
});

test('load errors and synchronous play failures remain recoverable without throwing',async()=>{
  const {audio,music}=setup();audio.requests.push(()=>{throw new Error('decode failed');});
  music.sync(running);assert.equal(music.issue,'failed');assert.equal(audio.paused,true);
  music.sync(running,{retry:true});await settle();assert.equal(audio.loads,1);assert.equal(audio.paused,false);
  audio.emit('error');assert.equal(audio.paused,true);assert.equal(music.issue,'failed');
  music.sync(running);assert.equal(audio.loads,1);
  const load=audio.load;audio.load=()=>{throw new Error('load unavailable');};
  assert.doesNotThrow(()=>music.sync(running,{retry:true}));assert.equal(music.issue,'failed');
  audio.load=load;
  music.sync(running,{retry:true});await settle();assert.equal(audio.loads,2);assert.equal(music.issue,null);
});
