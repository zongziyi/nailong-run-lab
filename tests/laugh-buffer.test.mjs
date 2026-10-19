import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CoinSound} from '../src/coin-sound.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const running={mode:'run',paused:false,gameOver:false,grounded:true,action:'Slide',slideFromDive:false,actionSerial:1};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Context {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.sources=[];this.resumes=0;this.decodes=0;this.events={};this.buffer={duration:1.05};}
  addEventListener(name,fn){this.events[name]=fn;}
  change(state){this.state=state;this.events.statechange?.();}
  resume(){this.resumes++;this.change('running');return Promise.resolve();}
  decodeAudioData(bytes){this.decodes++;assert.ok(bytes instanceof ArrayBuffer);return this.decodeImpl?.()??Promise.resolve(this.buffer);}
  createGain(){return {gain:{setValueAtTime(value){this.value=value;}},connect(){},disconnect(){this.disconnected=true;}};}
  createBufferSource(){const source={connect(){},start(time){this.started=time;},stop(){this.stopped=true;},disconnect(){this.disconnected=true;}};this.sources.push(source);return source;}
}
function setup(options={}){
  const context=new Context(),media={src:'https://game.test/assets/audio/nailong-laugh.wav',calls:0,events:{},addEventListener(name,fn){this.events[name]=fn;},pause(){},load(){},play(){this.calls++;return new Promise(()=>{});}};
  let loads=0;
  const sound=new CoinSound({laughAudio:media,createContext:()=>context,getStorage:()=>null,loadAudio:async()=>{loads++;return new ArrayBuffer(16);},...options});
  sound.sync(running);return {context,media,sound,loads:()=>loads};
}
async function ready(options){const fixture=setup(options);await tick();fixture.sound.unlock();await tick();return fixture;}

test('prefetched laughter uses the unlocked coin context without waiting for mobile media.play',async()=>{
  const {sound,context,media,loads}=await ready();
  assert.equal(loads(),1);assert.equal(context.decodes,1);assert.equal(sound.snapshot().laughReady,true);
  assert.equal(context.sources.length,0,'Preparing and unlocking must stay silent');
  sound.playLaugh(running);
  assert.equal(context.sources.length,1);assert.equal(context.sources[0].buffer,context.buffer);
  assert.equal(media.calls,0,'Do not enter the delayed/restricted mobile HTML audio pipeline');
  assert.equal(sound.snapshot().laughPlayed,1);assert.equal(sound.snapshot().laughBackend,'buffer');
  assert.equal(sound.laughVoice.gain.gain.value,.6);
});

test('consecutive laughs reuse the decoded buffer, never overlap or let an old ended event cancel the new laugh',async()=>{
  const {sound,context,loads}=await ready();sound.playLaugh(running);
  const previous=context.sources[0],oldEnded=previous.onended;
  sound.playLaugh(running);assert.equal(context.sources.length,1);
  sound.playLaugh({...running,actionSerial:2});assert.equal(context.sources.length,2);
  oldEnded();assert.equal(sound.snapshot().laughPlaying,true);
  assert.equal(previous.stopped,true);assert.equal(previous.disconnected,true);
  assert.equal(loads(),1);assert.equal(context.decodes,1);
  context.sources[1].onended();assert.equal(sound.snapshot().laughPlaying,false);
});

test('an iPhone interrupted context resumes on the next gesture and queued laughter starts only once',async()=>{
  const {sound,context}=await ready();context.change('interrupted');
  const resume=deferred();context.resume=()=>{context.resumes++;return resume.promise;};
  sound.unlock();sound.playLaugh(running);assert.equal(context.sources.length,0);
  context.change('running');resume.resolve();await tick();
  assert.equal(context.sources.length,1);assert.equal(sound.snapshot().laughPlayed,1);
});

test('pause and mute cancel a laugh awaiting context recovery without later replay',async()=>{
  for(const cancel of [sound=>sound.sync({...running,paused:true}),sound=>sound.toggleMuted()]){
    const {sound,context}=await ready();context.change('interrupted');
    const resume=deferred();context.resume=()=>resume.promise;
    sound.unlock();sound.playLaugh(running);cancel(sound);
    context.change('running');resume.resolve();await tick();assert.equal(context.sources.length,0);
  }
});

test('slow initial fetch is cached for the next laugh without replaying an expired action',async()=>{
  const fetch=deferred(),{sound,context,media}=setup({loadAudio:()=>fetch.promise});
  sound.unlock();sound.playLaugh(running);
  sound.sync({...running,action:'Run',actionSerial:2});
  fetch.resolve(new ArrayBuffer(16));await tick();
  assert.equal(context.sources.length,0);assert.equal(sound.snapshot().laughReady,true);
  sound.playLaugh({...running,actionSerial:3});assert.equal(context.sources.length,1);assert.equal(media.calls,0);
});

test('late decode after restart or exit prepares the cache without starting a stale voice',async()=>{
  const decode=deferred(),fixture=setup();fixture.context.decodeImpl=()=>decode.promise;
  await tick();fixture.sound.unlock();fixture.sound.playLaugh(running);await tick();
  fixture.sound.stop();fixture.sound.sync({mode:'inspect'});decode.resolve(fixture.context.buffer);await tick();
  assert.equal(fixture.context.sources.length,0);
  fixture.sound.sync(running);fixture.sound.playLaugh(running);assert.equal(fixture.context.sources.length,1);
});

test('jumping keeps a started laugh tail, while background interruption stops it and never resumes it',async()=>{
  const {sound,context}=await ready();sound.playLaugh(running);
  sound.sync({...running,grounded:false,action:'Jump',actionSerial:2});assert.equal(sound.snapshot().laughPlaying,true);
  context.change('interrupted');assert.equal(sound.snapshot().laughPlaying,false);assert.equal(context.sources[0].stopped,true);
  context.change('running');assert.equal(context.sources.length,1);
});

test('decode failure falls back on a later real gesture and a failed fetch can be retried',async()=>{
  const fixture=setup();fixture.context.decodeImpl=()=>Promise.reject(Error('unsupported decoder'));
  await tick();fixture.sound.unlock();await tick();
  assert.equal(fixture.sound.snapshot().laughBackend,'media');fixture.sound.playLaugh(running);assert.equal(fixture.media.calls,1);
  let loads=0;
  const other=setup({loadAudio:async()=>{if(++loads===1)throw Error('network');return new ArrayBuffer(16);}});
  await tick();other.sound.unlock();other.sound.playLaugh(running);await tick();
  assert.equal(loads,2);assert.equal(other.context.sources.length,1);
});

test('background media events cannot stop a buffer voice and closed contexts can decode cached bytes again',async()=>{
  const {sound,context,media,loads}=await ready();sound.playLaugh(running);
  media.events.error();media.events.ended();assert.equal(sound.snapshot().laughPlaying,true);
  context.change('closed');const replacement=new Context();sound.createContext=()=>replacement;
  sound.unlock();await tick();sound.playLaugh({...running,actionSerial:2});
  assert.equal(replacement.sources.length,1);assert.equal(replacement.decodes,1);assert.equal(loads(),1);
});
