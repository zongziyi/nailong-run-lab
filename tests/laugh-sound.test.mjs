import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CoinSound} from '../src/coin-sound.js';
import {RunnerController} from '../src/controller.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const running={mode:'run',paused:false,gameOver:false,grounded:true,action:'Slide',slideFromDive:false,actionSerial:1};
class Media {
  constructor(){this.listeners={};this.paused=true;this.currentTime=0;this.calls=0;this.loads=0;this.playImpl=null;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  emit(name){this.listeners[name]?.();}
  play(){this.calls++;if(this.playImpl)return this.playImpl();this.paused=false;this.emit('playing');return Promise.resolve();}
  pause(){this.paused=true;}
  load(){this.loads++;}
}
function setup(options={}){
  const audio=new Media(),sound=new CoinSound({laughAudio:audio,getStorage:()=>null,...options});
  sound.sync(running);return {audio,sound};
}

test('the extracted WAV is the documented short mono PCM clip with fades and a safe peak',async()=>{
  const bytes=await readFile(new URL('../assets/audio/nailong-laugh.wav',import.meta.url));
  const report=JSON.parse(await readFile(new URL('../artifacts/laugh-audio-report.json',import.meta.url),'utf8'));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),1);
  assert.equal(bytes.readUInt32LE(24),44100);assert.equal(bytes.readUInt16LE(34),16);
  assert.equal(bytes.length,92654);assert.equal((bytes.length-44)/2/44100,1.05);
  const samples=Array.from({length:(bytes.length-44)/2},(_,i)=>bytes.readInt16LE(44+i*2));
  assert.equal(samples[0],0);assert.equal(samples.at(-1),0);
  const peak=Math.max(...samples.map(Math.abs))/32767;
  assert.ok(Math.abs(20*Math.log10(peak)+3)<.01);assert.equal(report.clipped_samples,0);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),report.wav_sha256);
  assert.ok(samples.slice(0,7056).some(sample=>Math.abs(sample)>30),'The laugh must be audible by the end of the 160 ms pose entry');
});

test('a grounded laugh plays once per accepted action, including on a train roof',async()=>{
  for(const supportType of ['ground','roof']){
    const {audio,sound}=setup();
    assert.equal(audio.preload,'auto');assert.equal(audio.volume,.6);assert.equal(audio.loop,false);
    assert.equal(sound.playLaugh({...running,supportType}),true);
    assert.equal(sound.playLaugh({...running,supportType}),false);await settle();
    assert.equal(audio.calls,1);assert.equal(sound.snapshot().laughPlayed,1);
    sound.playLaugh({...running,actionSerial:2});await settle();
    assert.equal(audio.calls,2);assert.equal(sound.snapshot().laughPlayed,2);assert.equal(audio.currentTime,0);
  }
});

test('air dive, landing tackle, run, idle and inactive states never play a laugh',()=>{
  const {audio,sound}=setup();
  for(const state of [{action:'Dive',grounded:false},{slideFromDive:true},{action:'Run'},
    {action:'Idle',mode:'inspect'},{paused:true},{gameOver:true}])sound.playLaugh({...running,...state});
  assert.equal(audio.calls,0);
});

test('the real controller input chain laughs once and never on ignored input or a dive landing',async()=>{
  const {audio,sound}=setup(),runner=new RunnerController();runner.start();runner.course.clear();
  const input=command=>{const accepted=runner.input(command);if(accepted&&command==='slide')sound.playLaugh(runner);sound.sync(runner);return accepted;};
  assert.equal(input('slide'),true);assert.equal(input('slide'),false);assert.equal(input('left'),true);
  assert.equal(audio.calls,1);await settle();
  input('jump');assert.equal(audio.paused,false,'An already playing short laugh may finish through a jump');
  input('slide');runner.land();sound.sync(runner);
  assert.equal(runner.slideFromDive,true);assert.equal(audio.calls,1);
});

test('pause, background auto-pause, exit, game over and restart stop both pending and playing laughs',async()=>{
  for(const state of [{...running,paused:true},{mode:'inspect'},{...running,gameOver:true}]){
    const {audio,sound}=setup();sound.playLaugh(running);await settle();audio.currentTime=.3;
    sound.sync(state);assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
    sound.sync(running);await settle();assert.equal(audio.calls,1,'Resume must not replay a laugh');
  }
  const {audio,sound}=setup();sound.playLaugh(running);sound.stop();assert.equal(audio.paused,true);
  sound.playLaugh(running);assert.equal(audio.calls,2,'A restarted run may reuse action serials');
});

test('the shared mute key controls both effects and preserves the existing setting',async()=>{
  const values=new Map([['nailong-run.coin-sound-muted','true']]);
  const {audio,sound}=setup({getStorage:()=>({getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)})});
  assert.equal(audio.muted,true);sound.playLaugh(running);assert.equal(audio.calls,0);
  // No Web Audio context is needed to play the prerecorded media clip.
  sound.toggleMuted();assert.equal(audio.muted,false);assert.equal(audio.calls,0);
  sound.playLaugh(running);await settle();sound.toggleMuted();
  assert.equal(audio.paused,true);assert.equal(audio.muted,true);assert.equal(values.get('nailong-run.coin-sound-muted'),'true');
  assert.equal(values.has('nailong-run.music-muted'),false);
});

test('stale play completion and late playing events cannot revive a cancelled laugh',async()=>{
  const {audio,sound}=setup();let finish;
  audio.playImpl=()=>new Promise(resolve=>{finish=resolve;});sound.playLaugh(running);
  sound.sync({...running,paused:true});finish();await settle();
  audio.paused=false;audio.emit('playing');assert.equal(audio.paused,true);assert.equal(sound.laughPlayed,0);
});

test('an unloaded pending laugh is cancelled when its action is already over',async()=>{
  const {audio,sound}=setup();let finish;
  audio.playImpl=()=>new Promise(resolve=>{finish=resolve;});sound.playLaugh(running);
  sound.sync({...running,grounded:false,action:'Jump',actionSerial:2});finish();await settle();
  assert.equal(sound.snapshot().laughPending,false);assert.equal(audio.paused,true);assert.equal(sound.laughPlayed,0);
});

test('old rejected requests cannot stop a newer laugh; load and autoplay failures are recoverable without replay',async()=>{
  const {audio,sound}=setup();let fail;
  audio.playImpl=()=>new Promise((resolve,reject)=>{fail=reject;});sound.playLaugh(running);
  audio.playImpl=null;sound.playLaugh({...running,actionSerial:2});await settle();
  fail(Error('old request cancelled'));await settle();assert.equal(audio.paused,false);assert.equal(sound.laughIssue,null);
  audio.emit('ended');assert.equal(sound.snapshot().laughPlaying,false);
  audio.playImpl=()=>Promise.reject(Object.assign(Error('gesture'),{name:'NotAllowedError'}));
  sound.playLaugh({...running,actionSerial:3});await settle();assert.equal(sound.laughIssue,'blocked');
  sound.retry();assert.equal(audio.calls,3,'Retry preloads without playing');assert.equal(audio.loads,1);
  audio.playImpl=null;sound.playLaugh({...running,actionSerial:4});await settle();assert.equal(sound.laughIssue,null);
  audio.emit('error');assert.equal(audio.paused,true);assert.equal(sound.laughIssue,'failed');
});
