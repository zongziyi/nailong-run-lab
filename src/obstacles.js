import {GAME,OBSTACLES,SPAWN_WEIGHTS,distanceAt,timeAtDistance,speedAt} from './game-config.js';
import {surfaceAt,sweptContact,obstacleEnd,bodyStart,passageWindow} from './collision.js';
import {RoutePlanner} from './route-planner.js';
export {frontAt,bodyStart,obstacleLength,obstacleEnd,surfaceHeight,surfaceAt,sweptContact,passageWindow} from './collision.js';

export class ObstacleCourse {
  constructor({random=Math.random}={}){
    this.random=random;this.pool=Array.from({length:GAME.maxObstacles},()=>({}));this.active=[];this.planner=new RoutePlanner();this.clear();
  }
  clear(){
    this.active.length=0;this.free=[...this.pool];this.nextId=1;this.nextRowId=1;this.hasGeneratedTrain=false;
    this.nextArrivalTime=GAME.warmupSeconds;this.nextFrontDistance=distanceAt(this.nextArrivalTime)+GAME.slidingDepth/2;
    this.lastOncomingTime=-Infinity;this.safeCommands=[];this.planner.clear();
    this.generationStats={attempts:0,fallbacks:0,skipped:0,groups:0,doubles:0};
  }
  begin(){this.clear();this.fillAhead(0,0);}
  record(kind,lane,arrivalTime){
    return {id:0,rowId:this.nextRowId,kind,lane,arrivalTime,
      frontDistance:distanceAt(arrivalTime)+GAME.slidingDepth/2,hasRamp:false,
      motionSpeed:kind==='oncoming'?GAME.oncomingSpeed:0,baseHeight:0,parentId:null,hit:false,hitAt:Infinity};
  }
  fitsLane(candidate){
    const window=passageWindow(candidate);
    return this.active.every(o=>{
      if(o.parentId!=null||o.lane!==candidate.lane)return true;
      const prior=passageWindow(o);
      return window.start>=prior.end+GAME.exitReactionSeconds-1e-8;
    });
  }
  weighted(options){
    const total=options.reduce((n,o)=>n+SPAWN_WEIGHTS[o.kind],0);let draw=this.random()*total;
    for(const o of options){draw-=SPAWN_WEIGHTS[o.kind];if(draw<0)return o;}
    return options.at(-1);
  }
  candidate(time){
    const lanes=[-1,0,1];for(let i=2;i>0;i--){const j=Math.floor(this.random()*(i+1));[lanes[i],lanes[j]]=[lanes[j],lanes[i]];}
    const count=this.random()<GAME.doubleProbability?2:1,result=[];
    for(const lane of lanes){
      const options=Object.keys(SPAWN_WEIGHTS).filter(kind=>kind!=='oncoming'||
        (time-this.lastOncomingTime>=GAME.oncomingCooldown-1e-8&&!result.some(o=>o.kind==='oncoming')))
        .map(kind=>this.record(kind,lane,time)).filter(o=>this.fitsLane(o));
      if(!options.length)continue;
      const o=this.weighted(options);
      if(o.kind==='train')o.hasRamp=!this.hasGeneratedTrain&&!result.some(p=>p.kind==='train')||this.random()<.5;
      result.push(o);if(result.length===count)break;
    }
    return result;
  }
  allocate(candidate){
    const o=this.free.pop();if(!o)throw new Error('Obstacle record pool exhausted');
    // Every field is assigned, including absent parent/motion data, on reuse.
    Object.assign(o,candidate,{id:this.nextId++});this.active.push(o);return o;
  }
  roofObstacles(parent){
    if(this.random()>=GAME.roofProbability)return;
    const body=bodyStart(parent),crestTime=timeAtDistance(body);
    let front=body+Math.max(4,speedAt(crestTime)*.35);
    const count=this.random()<.5?1:2;
    for(let i=0;i<count&&this.free.length;i++){
      const kind=this.random()<.5?'barrier':'overhead',spec=OBSTACLES[kind];
      if(front+spec.length>obstacleEnd(parent)-2+1e-8)break;
      const child=this.record(kind,parent.lane,timeAtDistance(front-GAME.slidingDepth/2));
      Object.assign(child,{frontDistance:front,baseHeight:OBSTACLES.train.top,parentId:parent.id});
      if(!this.validateCoins||this.validateCoins([...this.active,child]))this.allocate(child);
      front=distanceAt(timeAtDistance(front)+GAME.roofGapSeconds);
    }
  }
  fillAhead(distance,elapsed=timeAtDistance(distance)){
    // Complete coin detours (especially a train roof and its exit) need the
    // following rows known before any of their coins are made visible.
    const horizon=Math.max(distance+GAME.lookAhead,distanceAt(elapsed+GAME.coinLookAheadSeconds));
    while(this.nextFrontDistance<=horizon&&this.free.length>=2){
      const time=this.nextArrivalTime;let candidates=null,proposal=null;
      for(let attempt=0;attempt<GAME.generationAttempts;attempt++){
        this.generationStats.attempts++;
        const draw=this.candidate(time);if(!draw.length)continue;
        const route=this.planner.propose([...this.active,...draw],time);
        if(route&&(!this.validateCoins||this.validateCoins([...this.active,...draw]))){candidates=draw;proposal=route;break;}
      }
      if(!proposal){
        this.generationStats.fallbacks++;
        for(const lane of [-1,0,1]){
          const o=this.record('barrier',lane,time);if(!this.fitsLane(o))continue;
          const route=this.planner.propose([...this.active,o],time);
          if(route&&(!this.validateCoins||this.validateCoins([...this.active,o]))){candidates=[o];proposal=route;break;}
        }
      }
      if(proposal){
        this.planner.commit(proposal);this.safeCommands.push(...proposal.commands);
        const parents=[];
        for(const candidate of candidates){
          const o=this.allocate(candidate);
          if(o.kind==='train'){this.hasGeneratedTrain=true;parents.push(o);}
          if(o.kind==='oncoming')this.lastOncomingTime=time;
        }
        for(const parent of parents)this.roofObstacles(parent);
        this.generationStats.groups++;if(candidates.length===2)this.generationStats.doubles++;
      }else this.generationStats.skipped++;
      this.nextRowId++;this.nextArrivalTime+=GAME.rowSecondsMin+this.random()*(GAME.rowSecondsMax-GAME.rowSecondsMin);
      this.nextFrontDistance=distanceAt(this.nextArrivalTime)+GAME.slidingDepth/2;
    }
  }
  surfaces(distance,x){return this.active.map(o=>surfaceAt(o,distance,x)).filter(Boolean).sort((a,b)=>b.height-a.height);}
  contacts(from,to){
    return this.active.map(obstacle=>({obstacle,fraction:sweptContact(obstacle,from,to)}))
      .filter(c=>c.fraction!==null).sort((a,b)=>a.fraction-b.fraction||a.obstacle.id-b.obstacle.id);
  }
  touch(o,elapsed){
    if(o.hit)return;
    o.hit=true;o.hitAt=elapsed;
    for(const child of this.active)if(child.parentId===o.id&&!child.hit){child.hit=true;child.hitAt=elapsed;}
  }
  warnings(elapsed){
    return this.active.filter(o=>o.kind==='oncoming'&&!o.hit).map(o=>{
      const window=passageWindow(o);return {id:o.id,lane:o.lane,eta:Math.max(0,window.start-elapsed),end:window.end};
    }).filter(w=>w.eta<=GAME.warningSeconds+1e-8&&w.end>=elapsed).sort((a,b)=>a.eta-b.eta);
  }
  recycle(distance,elapsed=timeAtDistance(distance)){
    let write=0;
    for(const o of this.active){
      if(distance>obstacleEnd(o,elapsed)+GAME.recycleBehind)this.free.push(o);else this.active[write++]=o;
    }
    this.active.length=write;
    this.safeCommands=this.safeCommands.filter(c=>c.time>=elapsed-.5);
    this.fillAhead(distance,elapsed);
  }
}
