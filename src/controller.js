import {GAME,OBSTACLES,speedAt,distanceAt,gravity,jumpVelocity} from './game-config.js';
import {ObstacleCourse,surfaceAt,surfaceHeight,bodyStart,obstacleEnd} from './obstacles.js';

export class RunnerController {
  constructor(options={}){this.course=new ObstacleCourse(options);this.maxLives=GAME.maxLives;this.reset();}
  reset(){
    this.mode='inspect';this.paused=false;this.lane=0;this.x=0;this.y=0;this.lean=0;
    this.action='Idle';this.actionTime=0;this.actionSerial=0;this.slideFromDive=false;this.elapsed=0;
    this.verticalVelocity=0;this.grounded=true;this.supportId=null;this.supportType='ground';
    this.jumpSourceId=null;
    this.lives=this.maxLives;this.gameOver=false;this.protectedUntil=0;
    this.lastDamageAt=-Infinity;this.lastDamageKind=null;this.damageSerial=0;this.course.clear();
  }
  get speed(){return speedAt(this.elapsed);}
  get distance(){return distanceAt(this.elapsed);}
  get invincibleRemaining(){return Math.max(0,this.protectedUntil-this.elapsed);}
  get hitFeedback(){return Math.max(0,1-(this.elapsed-this.lastDamageAt)/.3);}
  get lastDamageLabel(){return this.lastDamageKind?OBSTACLES[this.lastDamageKind].label:'';}
  start({maxLives=this.maxLives}={}){
    if(maxLives!==1&&maxLives!==GAME.maxLives)throw new RangeError('生命模式只能选择一条命或三条命');
    this.maxLives=maxLives;this.reset();this.mode='run';this.action='Run';this.course.begin();
  }
  inspect(){this.reset();}
  togglePause(){if(this.mode==='run'&&!this.gameOver)this.paused=!this.paused;}
  pause(){if(this.mode==='run'&&!this.gameOver)this.paused=true;}
  input(command){
    if(this.mode!=='run'||this.paused||this.gameOver)return false;
    if(command==='left'||command==='right'){
      const next=Math.max(-1,Math.min(1,this.lane+(command==='left'?-1:1)));
      const changed=next!==this.lane;this.lane=next;return changed;
    }
    if(command==='jump'&&this.grounded&&(this.action==='Run'||this.action==='Slide')){
      this.setAction('Jump');this.jumpSourceId=this.supportId;
      this.verticalVelocity=jumpVelocity;this.grounded=false;this.supportId=null;this.supportType='air';
      return true;
    }
    if(command==='slide'){
      if(this.grounded&&this.action==='Run'){this.setAction('Slide');return true;}
      if(!this.grounded&&this.action!=='Dive'){
        this.setAction('Dive');this.jumpSourceId=null;
        this.verticalVelocity=Math.min(this.verticalVelocity,-GAME.diveSpeed);
        return true;
      }
    }
    return false;
  }
  setAction(action,slideFromDive=false){
    this.action=action;this.actionTime=0;this.actionSerial++;this.slideFromDive=slideFromDive;
  }
  collisionState(){return {elapsed:this.elapsed,distance:this.distance,x:this.x,y:this.y,action:this.action,
    actionTime:this.actionTime,slideFromDive:this.slideFromDive,supportId:this.supportId,jumpSourceId:this.jumpSourceId,
    grounded:this.grounded,supportType:this.supportType,verticalVelocity:this.verticalVelocity};}
  land(surface=null){
    this.y=surface?.height??0;this.verticalVelocity=0;this.grounded=true;
    this.supportId=surface?.id??null;this.supportType=surface?.type??'ground';this.jumpSourceId=null;
    if(this.action==='Dive')this.setAction('Slide',true);
    else if(this.action==='Jump')this.setAction('Run');
  }
  landingWithin(dt){
    if(this.grounded)return null;
    const xAt=t=>this.lane*GAME.laneSpacing+(this.x-this.lane*GAME.laneSpacing)*Math.exp(-13*t);
    const source=this.action==='Jump'?this.course.surfaces(distanceAt(this.elapsed+dt),xAt(dt))
      .find(s=>s.id===this.jumpSourceId):null;
    const acceleration=gravity*(this.action==='Dive'?GAME.diveGravityScale:1);
    const velocity=this.jumpSourceId!==null&&!source?jumpVelocity-gravity*this.actionTime:this.verticalVelocity;
    const yAt=source?t=>{
      const age=Math.min(this.actionTime+t,GAME.jumpSeconds);
      return surfaceHeight(source.obstacle,distanceAt(this.elapsed+t))+Math.max(0,jumpVelocity*age-.5*gravity*age*age);
    }:t=>this.y+velocity*t-.5*acceleration*t*t;
    let landing=null;
    // Use feet relative to each top, including a slope rising faster than an
    // ascending character. Split at the earliest valid crossing for both jumps
    // and dives, so airborne time cannot age the following run or slide.
    const crossing=(heightAt,surfaceAtTime)=>{
      if(yAt(0)<heightAt(0)-1e-7||yAt(dt)>heightAt(dt)+1e-9)return;
      let a=0,b=dt;
      for(let i=0;i<36;i++){const m=(a+b)/2;if(yAt(m)>heightAt(m))a=m;else b=m;}
      const surface=surfaceAtTime(b);
      if(surface!==undefined&&(!landing||b<landing.dt))landing={dt:b,surface};
    };
    crossing(()=>0,()=>null);
    for(const o of this.course.active)if(o.kind==='train'&&!o.hit){
      crossing(t=>surfaceHeight(o,distanceAt(this.elapsed+t)),
        t=>surfaceAt(o,distanceAt(this.elapsed+t),xAt(t))??undefined);
    }
    return landing;
  }
  update(rawDt){
    if(this.mode!=='run'||this.paused||this.gameOver||!Number.isFinite(rawDt)||rawDt<=0)return;
    let remaining=Math.min(rawDt,GAME.maxFrameSeconds);
    while(remaining>1e-10&&!this.gameOver){
      let dt=Math.min(remaining,GAME.physicsStep);
      if(this.jumpSourceId!==null&&this.actionTime<GAME.jumpSeconds-1e-9){
        dt=Math.min(dt,GAME.jumpSeconds-this.actionTime);
      }
      if(this.action==='Slide'&&this.actionTime<GAME.slideSeconds-1e-9)dt=Math.min(dt,GAME.slideSeconds-this.actionTime);
      // Split at longitudinal terrain boundaries as well as the small step.
      for(const o of this.course.active)if(o.kind==='train'&&!o.hit){
        for(const boundary of [o.frontDistance-GAME.playerDepth/2,o.frontDistance,bodyStart(o),obstacleEnd(o)+GAME.playerDepth/2]){
          if(boundary>this.distance+1e-7&&boundary<distanceAt(this.elapsed+dt)-1e-7){
            let a=0,b=dt;
            for(let i=0;i<30;i++){const m=(a+b)/2;if(distanceAt(this.elapsed+m)<boundary)a=m;else b=m;}
            dt=b;
          }
        }
        // Keep takeoff-source membership constant inside a step. Landing
        // prediction and integration must agree when a lane change leaves it.
        const targetX=this.lane*GAME.laneSpacing,offset=this.x-targetX;
        const halfWidth=(OBSTACLES.train.width+GAME.playerWidth)/2;
        if(Math.abs(offset)>1e-9)for(const edge of [o.lane*GAME.laneSpacing-halfWidth,o.lane*GAME.laneSpacing+halfWidth]){
          const ratio=(edge-targetX)/offset;
          if(ratio>0&&ratio<1){
            const crossing=-Math.log(ratio)/13;
            if(crossing>1e-9&&crossing<dt)dt=crossing;
          }
        }
      }
      const landing=this.landingWithin(dt);
      if(landing){
        if(landing.dt<1e-10){this.land(landing.surface);continue;}
        dt=landing.dt;
      }
      this.step(dt,landing);remaining-=dt;
    }
  }
  step(dt,airLanding=null){
    const previous=this.collisionState(),previousLean=this.lean;
    this.elapsed+=dt;
    const diff=this.lane*GAME.laneSpacing-this.x;
    this.x+=diff*(1-Math.exp(-dt*13));
    this.lean+=(Math.max(-.24,Math.min(.24,-diff*.15))-this.lean)*(1-Math.exp(-dt*12));
    if(['Jump','Slide','Dive'].includes(this.action))this.actionTime+=dt;
    if(this.action==='Slide'&&this.actionTime>=GAME.slideSeconds-1e-9)this.setAction('Run');

    const surfaces=this.course.surfaces(this.distance,this.x);
    let support=this.grounded?surfaces.find(s=>s.id===this.supportId):null;
    if(this.grounded&&!support){
      // Enter at the ramp toe, never magnetically from halfway up its side.
      support=surfaces.find(s=>s.type==='ramp'&&s.height<.04&&previous.distance<=s.obstacle.frontDistance+1e-6&&this.y<.04);
      if(!support&&this.y<=1e-6){this.y=0;this.supportId=null;this.supportType='ground';}
      else if(!support){
        this.grounded=false;this.supportId=null;this.supportType='air';this.verticalVelocity=0;
        if(this.action==='Run'){this.setAction('Jump');this.actionTime=GAME.jumpSeconds/2;}
      }
    }
    if(airLanding){
      this.land(airLanding.surface);
    }else if(support){
      this.land(support);
    }else if(!this.grounded){
      const source=this.action==='Jump'?surfaces.find(s=>s.id===this.jumpSourceId):null;
      if(source){
        // Keep the normal jump arc relative to the continuous ramp/roof top.
        // This prevents a rising slope from overtaking an otherwise valid hop.
        const t=Math.min(this.actionTime,GAME.jumpSeconds);
        this.y=source.height+Math.max(0,jumpVelocity*t-.5*gravity*t*t);
        this.verticalVelocity=(source.height-surfaceHeight(source.obstacle,previous.distance))/dt+jumpVelocity-gravity*t;
        if(this.actionTime>=GAME.jumpSeconds-1e-9)this.land(source);
      }else{
        if(this.jumpSourceId!==null){
          // Leave at the current world height, retaining only the jump's own
          // vertical velocity, not the additional upward motion of the slope.
          this.jumpSourceId=null;this.verticalVelocity=jumpVelocity-gravity*previous.actionTime;
        }
        const acceleration=gravity*(this.action==='Dive'?GAME.diveGravityScale:1);
        const nextY=this.y+this.verticalVelocity*dt-.5*acceleration*dt*dt;
        this.verticalVelocity-=acceleration*dt;
        // A grounded character can lose support during this step. Relative
        // height also covers an immediate transfer onto a neighbouring top.
        const landing=previous.grounded?surfaces.find(s=>nextY<=s.height+1e-7&&
          previous.y>=surfaceHeight(s.obstacle,previous.distance)-1e-7):null;
        if(landing||nextY<=1e-9)this.land(landing);
        else this.y=nextY;
      }
    }
    const current=this.collisionState();
    for(const {obstacle,fraction} of this.course.contacts(previous,current)){
      const contactAt=previous.elapsed+dt*fraction;
      this.course.touch(obstacle,contactAt);
      if(contactAt+1e-9<this.protectedUntil)continue;
      this.lives--;this.lastDamageAt=contactAt;this.lastDamageKind=obstacle.kind;this.damageSerial++;
      this.protectedUntil=contactAt+GAME.protectionSeconds;
      if(this.lives===0){
        this.gameOver=true;this.paused=false;this.elapsed=contactAt;
        for(const key of ['x','y','verticalVelocity'])this[key]=previous[key]+(current[key]-previous[key])*fraction;
        this.lean=previousLean+(this.lean-previousLean)*fraction;
        this.action=previous.action;this.actionTime=previous.actionTime+dt*fraction;
        this.slideFromDive=previous.slideFromDive;
        this.grounded=previous.grounded;this.supportId=previous.supportId;this.supportType=previous.supportType;this.jumpSourceId=previous.jumpSourceId;
        break;
      }
    }
    // Faded trains cannot remain as invisible support, even during immunity.
    if(this.supportId!==null&&this.course.active.find(o=>o.id===this.supportId)?.hit){
      this.supportId=null;this.supportType='air';this.grounded=false;this.verticalVelocity=0;
    }
    if(this.jumpSourceId!==null&&this.course.active.find(o=>o.id===this.jumpSourceId)?.hit){
      this.jumpSourceId=null;this.verticalVelocity=jumpVelocity-gravity*this.actionTime;
    }
    this.course.recycle(this.distance,this.elapsed);
  }
}
