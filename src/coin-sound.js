const MUTE_KEY='nailong-run.coin-sound-muted';

export class CoinSound {
  constructor({createContext=()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)(),getStorage=()=>globalThis.localStorage,onChange=()=>{},laughAudio=null}={}){
    this.createContext=createContext;this.getStorage=getStorage;this.onChange=onChange;
    this.context=null;this.voices=new Set();this.active=false;this.issue=null;this.version=0;this.played=0;
    try{this.muted=getStorage()?.getItem(MUTE_KEY)==='true';}catch{this.muted=false;}
    this.laughAudio=laughAudio;this.laughVersion=0;this.laughRequested=false;this.laughStarted=false;
    this.laughPending=false;this.laughIssue=null;this.laughPlayed=0;this.lastLaughSerial=null;
    if(laughAudio){
      laughAudio.preload='auto';laughAudio.loop=false;laughAudio.volume=.6;laughAudio.muted=this.muted;
      laughAudio.addEventListener('playing',()=>{
        if(!this.active||this.muted||!this.laughRequested){this.stopLaugh();return;}
        this.beginLaugh();
      });
      laughAudio.addEventListener('ended',()=>{this.stopLaugh();this.onChange();});
      laughAudio.addEventListener('error',()=>{this.laughIssue='failed';this.stopLaugh();this.onChange();});
    }
  }
  sync(game){
    const active=game.mode==='run'&&!game.paused&&!game.gameOver;
    if(this.active&&!active)this.stop();this.active=active;
    if(this.laughPending&&(!this.isLaugh(game)||game.actionSerial!==this.lastLaughSerial))this.stopLaugh();
  }
  isLaugh(game){return game.mode==='run'&&!game.paused&&!game.gameOver&&game.grounded&&game.action==='Slide'&&!game.slideFromDive;}
  beginLaugh(){
    if(!this.laughStarted){this.laughStarted=true;this.laughPlayed++;}
    this.laughPending=false;this.laughIssue=null;this.onChange();
  }
  playLaugh(game){
    if(!this.laughAudio||!this.active||this.muted||!this.isLaugh(game)||game.actionSerial===this.lastLaughSerial)return false;
    this.stopLaugh();this.lastLaughSerial=game.actionSerial;
    const audio=this.laughAudio,version=this.laughVersion;
    const failed=error=>{
      if(version!==this.laughVersion)return;
      this.laughIssue=error?.name==='NotAllowedError'?'blocked':'failed';this.stopLaugh();this.onChange();
    };
    try{
      if(this.laughIssue==='failed')audio.load();
      this.laughIssue=null;this.laughRequested=true;this.laughPending=true;
      // Called synchronously by the accepted down gesture, never by a frame
      // loop or pause recovery. One media element prevents overlapping laughs.
      Promise.resolve(audio.play()).then(()=>{
        if(version===this.laughVersion&&this.laughRequested)this.beginLaugh();
      },failed);
    }catch(error){failed(error);}
    return true;
  }
  stopLaugh(){
    this.laughVersion++;this.laughRequested=false;this.laughStarted=false;this.laughPending=false;
    if(this.laughAudio){this.laughAudio.pause();try{this.laughAudio.currentTime=0;}catch{}}
  }
  retry(){
    this.unlock();
    if(this.laughIssue&&this.laughAudio){
      this.stopLaugh();
      try{this.laughAudio.load();this.laughIssue=null;}catch{this.laughIssue='failed';}
      this.onChange();
    }
  }
  unlock(){
    if(this.muted||!this.active)return;
    try{
      this.context??=this.createContext();const version=++this.version;
      const resumed=this.context.state==='suspended'?this.context.resume():undefined;
      Promise.resolve(resumed).then(()=>{if(version===this.version){this.issue=null;this.onChange();}},()=>{
        if(version===this.version){this.issue='blocked';this.onChange();}
      });
    }catch{this.issue='unavailable';this.onChange();}
  }
  play(events){
    if(!events.length||!this.active||this.muted||!this.context||this.context.state!=='running')return;
    const context=this.context;
    for(let i=0;i<events.length;i++){
      while(this.voices.size>=12)this.release(this.voices.values().next().value);
      const start=context.currentTime+Math.min(i*.025,.15);
      const voice={nodes:[],gain:null};
      try{
        const gain=context.createGain();voice.gain=gain;gain.connect(context.destination);
        gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.085,start+.006);
        gain.gain.exponentialRampToValueAtTime(.0001,start+.13);
        for(const [frequency,delay] of [[1320,0],[1760,.035]]){
          const oscillator=context.createOscillator();oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);
          oscillator.connect(gain);voice.nodes.push(oscillator);oscillator.start(start+delay);oscillator.stop(start+.14);
        }
        voice.nodes.at(-1).onended=()=>this.release(voice);this.voices.add(voice);this.played++;
      }catch{this.release(voice);this.issue='unavailable';this.onChange();break;}
    }
  }
  release(voice){
    this.voices.delete(voice);
    for(const node of voice.nodes){node.onended=null;try{node.stop();}catch{}try{node.disconnect();}catch{}}
    try{voice.gain?.disconnect();}catch{}
  }
  stop(){this.version++;for(const voice of [...this.voices])this.release(voice);this.stopLaugh();this.lastLaughSerial=null;}
  toggleMuted(){
    this.muted=!this.muted;try{this.getStorage()?.setItem(MUTE_KEY,String(this.muted));}catch{}
    if(this.laughAudio)this.laughAudio.muted=this.muted;
    if(this.muted)this.stop();else this.unlock();this.onChange();
  }
  snapshot(){return {muted:this.muted,active:this.active,state:this.context?.state??'locked',issue:this.issue,voices:this.voices.size,played:this.played,
    laughPlayed:this.laughPlayed,laughPlaying:this.laughStarted&&this.laughRequested,laughPending:this.laughPending,laughIssue:this.laughIssue};}
}
