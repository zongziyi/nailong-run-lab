const MUTE_KEY='nailong-run.coin-sound-muted';

export class CoinSound {
  constructor({createContext=()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)(),getStorage=()=>globalThis.localStorage,onChange=()=>{}}={}){
    this.createContext=createContext;this.getStorage=getStorage;this.onChange=onChange;
    this.context=null;this.voices=new Set();this.active=false;this.issue=null;this.version=0;this.played=0;
    try{this.muted=getStorage()?.getItem(MUTE_KEY)==='true';}catch{this.muted=false;}
  }
  sync(game){
    const active=game.mode==='run'&&!game.paused&&!game.gameOver;
    if(this.active&&!active)this.stop();this.active=active;
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
  stop(){this.version++;for(const voice of [...this.voices])this.release(voice);}
  toggleMuted(){
    this.muted=!this.muted;try{this.getStorage()?.setItem(MUTE_KEY,String(this.muted));}catch{}
    if(this.muted)this.stop();else this.unlock();this.onChange();
  }
  snapshot(){return {muted:this.muted,active:this.active,state:this.context?.state??'locked',issue:this.issue,voices:this.voices.size,played:this.played};}
}
