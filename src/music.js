const MUTE_KEY='nailong-run.music-muted';

// One media element follows the game; user gestures call play synchronously.
export class GameMusic {
  constructor(audio,{getStorage=()=>globalThis.localStorage,onChange=()=>{}}={}){
    this.audio=audio;this.getStorage=getStorage;this.onChange=onChange;
    this.state='stopped';this.issue=null;this.version=0;this.pending=false;
    try{this.muted=getStorage()?.getItem(MUTE_KEY)==='true';}catch{this.muted=false;}
    audio.loop=true;audio.volume=.35;audio.muted=this.muted;
    audio.addEventListener('error',()=>{
      this.issue='failed';this.silence();this.onChange();
    });
    // A superseded play request must never revive sound after pause or exit.
    audio.addEventListener('playing',()=>{if(!this.shouldPlay)audio.pause();});
  }
  get shouldPlay(){return this.state==='playing'&&!this.muted;}
  rewind(){try{this.audio.currentTime=0;}catch{/* Metadata may not be available yet. */}}
  silence(){this.version++;this.pending=false;this.audio.pause();}
  sync(game,{restart=false,retry=false}={}){
    const next=game.mode!=='run'||game.gameOver?'stopped':game.paused?'paused':'playing';
    const changed=next!==this.state;this.state=next;
    if(restart){this.silence();this.rewind();}
    if(!this.shouldPlay){
      if(changed&&!restart)this.silence();
      if(next==='stopped'&&(changed||restart))this.rewind();
    }else if(changed||restart||(retry&&!this.pending&&this.audio.paused))this.play(retry||restart);
    if(changed||restart)this.onChange();
  }
  play(retry=false){
    if(!this.shouldPlay||this.pending)return;
    const reload=this.issue==='failed';
    if(reload&&!retry)return;
    const version=++this.version;this.pending=true;
    const failed=error=>{
      if(version!==this.version)return;
      this.issue=error?.name==='NotAllowedError'?'blocked':'failed';
      this.silence();this.onChange();
    };
    try{
      if(reload)this.audio.load();
      this.issue=null;
      Promise.resolve(this.audio.play()).then(()=>{
        if(version!==this.version){if(!this.shouldPlay)this.audio.pause();return;}
        this.pending=false;this.issue=null;this.onChange();
      },failed);
    }catch(error){failed(error);}
  }
  toggleMuted(){
    this.muted=!this.muted;this.audio.muted=this.muted;
    try{this.getStorage()?.setItem(MUTE_KEY,String(this.muted));}catch{/* Storage is optional. */}
    if(this.muted)this.silence();else this.play(true);
    this.onChange();
  }
  snapshot(){return {state:this.state,muted:this.muted,issue:this.issue,playing:!this.audio.paused,
    currentTime:this.audio.currentTime,duration:Number.isFinite(this.audio.duration)?this.audio.duration:null,
    volume:this.audio.volume,loop:this.audio.loop};}
}
