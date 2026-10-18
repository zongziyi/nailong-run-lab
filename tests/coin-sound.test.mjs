import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CoinSound} from '../src/coin-sound.js';

const running={mode:'run',paused:false,gameOver:false};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
class Context {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.nodes=[];this.gains=[];this.resumes=0;}
  resume(){this.resumes++;this.state='running';return Promise.resolve();}
  createGain(){const node={gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){this.disconnected=true;}};this.gains.push(node);return node;}
  createOscillator(){const node={frequency:{setValueAtTime(){}},connect(){},start(time){this.started=time;},stop(){this.stopped=true;},disconnect(){this.disconnected=true;}};this.nodes.push(node);return node;}
}
function setup(options={}){const context=new Context(),sound=new CoinSound({createContext:()=>context,getStorage:()=>null,...options});return {context,sound};}

test('pickup audio unlocks only during active play, plays two short tones and stays separate from music',async()=>{
  const {context,sound}=setup();sound.unlock();assert.equal(sound.context,null);
  sound.sync(running);sound.play([{}]);assert.equal(context.nodes.length,0);
  sound.unlock();await settle();assert.equal(context.resumes,1);
  sound.play([{},{}]);assert.equal(context.nodes.length,4);assert.equal(sound.snapshot().played,2);
  assert.ok(context.nodes[2].started>context.nodes[0].started);
  assert.equal(sound.voices.size,2);
  context.nodes[1].onended();assert.equal(sound.voices.size,1);assert.equal(context.gains[0].disconnected,true);
});

test('pause, mute, game over and exit clear all queued voices without replaying pickups',async()=>{
  for(const game of [{...running,paused:true},{...running,gameOver:true},{mode:'inspect'}]){
    const {context,sound}=setup();sound.sync(running);sound.unlock();await settle();sound.play([{},{}]);
    sound.sync(game);assert.equal(sound.voices.size,0);assert.ok(context.nodes.every(n=>n.stopped&&n.disconnected));
    sound.play([{}]);assert.equal(sound.played,2);sound.sync(running);assert.equal(sound.played,2);
  }
  const {sound}=setup();sound.sync(running);sound.unlock();await settle();sound.play([{}]);sound.toggleMuted();
  assert.equal(sound.voices.size,0);sound.play([{}]);assert.equal(sound.played,1);
});

test('effect mute persists independently and storage failures do not break play',async()=>{
  const values=new Map(),getStorage=()=>({getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)});
  const {sound}=setup({getStorage});sound.toggleMuted();assert.equal(values.get('nailong-run.coin-sound-muted'),'true');
  assert.equal(values.has('nailong-run.music-muted'),false);assert.equal(setup({getStorage}).sound.muted,true);
  const failed=setup({getStorage:()=>{throw Error('storage disabled');}}).sound;
  failed.sync(running);failed.unlock();await settle();failed.play([{}]);failed.toggleMuted();failed.toggleMuted();
  assert.equal(failed.muted,false);assert.equal(failed.played,1);
});

test('unavailable or denied audio is recoverable; a stale unlock cannot resume cancelled voices',async()=>{
  const unavailable=setup({createContext:()=>{throw Error('no audio');}}).sound;
  unavailable.sync(running);assert.doesNotThrow(()=>unavailable.unlock());assert.equal(unavailable.issue,'unavailable');
  const {context,sound}=setup();context.resume=()=>Promise.reject(Error('gesture required'));
  sound.sync(running);sound.unlock();await settle();assert.equal(sound.issue,'blocked');
  context.resume=()=>{context.state='running';return Promise.resolve();};sound.unlock();await settle();assert.equal(sound.issue,null);
  let finish;context.state='suspended';context.resume=()=>new Promise(resolve=>{finish=resolve;});
  sound.unlock();sound.sync({...running,paused:true});finish();await settle();assert.equal(sound.voices.size,0);assert.equal(sound.active,false);
});

test('continuous pickups keep the voice pool bounded and clean up nodes',async()=>{
  const {context,sound}=setup();sound.sync(running);sound.unlock();await settle();sound.play(Array.from({length:100},()=>({})));
  assert.equal(sound.voices.size,12);assert.equal(sound.played,100);
  sound.stop();assert.equal(sound.voices.size,0);assert.ok(context.nodes.every(n=>n.disconnected));
});
