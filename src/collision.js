import {GAME,OBSTACLES,distanceAt,timeAtDistance,speedAt} from './game-config.js';

const EPS=1e-9;
export const frontAt=(o,elapsed=0)=>o.frontDistance-(o.motionSpeed??0)*(elapsed-(o.arrivalTime??0));
export const bodyStart=(o,elapsed=0)=>frontAt(o,elapsed)+(o.kind==='train'&&o.hasRamp?GAME.rampLength:0);
export const obstacleLength=o=>OBSTACLES[o.kind].length+(o.kind==='train'&&o.hasRamp?GAME.rampLength:0);
export const obstacleEnd=(o,elapsed=0)=>frontAt(o,elapsed)+obstacleLength(o);
export const surfaceHeight=(o,distance)=>o.hasRamp?
  Math.max(0,Math.min(1,(distance-o.frontDistance)/GAME.rampLength))*OBSTACLES.train.top:OBSTACLES.train.top;

// The same relative longitudinal position drives scheduling, rendering and sweeps.
export function passageWindow(o,margin=0,depth=GAME.slidingDepth){
  const moving=o.motionSpeed??0;
  const solve=target=>{
    if(!moving)return timeAtDistance(target);
    let t=Math.max(0,timeAtDistance(Math.max(0,target)));
    for(let i=0;i<12;i++)t=Math.max(0,t-(distanceAt(t)+moving*(t-(o.arrivalTime??0))-target)/(speedAt(t)+moving));
    return t;
  };
  return {start:solve(o.frontDistance-depth/2-margin),
    end:solve(o.frontDistance+obstacleLength(o)+depth/2+margin)};
}

export function surfaceAt(o,distance,x){
  if(o.hit||o.kind!=='train')return null;
  if(Math.abs(x-o.lane*GAME.laneSpacing)>(OBSTACLES.train.width+GAME.playerWidth)/2+EPS)return null;
  if(distance<o.frontDistance-GAME.playerDepth/2-EPS||distance>obstacleEnd(o)+GAME.playerDepth/2+EPS)return null;
  return {id:o.id,type:o.hasRamp&&distance<bodyStart(o)-1e-7?'ramp':'roof',height:surfaceHeight(o,distance),obstacle:o};
}
function slab(from,to,min,max){
  if(Math.abs(to-from)<EPS)return from>=min-EPS&&from<=max+EPS?[0,1]:null;
  const a=(min-from)/(to-from),b=(max-from)/(to-from);
  const enter=Math.max(0,Math.min(a,b)),exit=Math.min(1,Math.max(a,b));
  return enter<=exit+EPS?[enter,exit]:null;
}
function intersect(...intervals){
  if(intervals.some(i=>!i))return null;
  const enter=Math.max(...intervals.map(i=>i[0])),exit=Math.min(...intervals.map(i=>i[1]));
  return enter<=exit+EPS?[enter,exit]:null;
}
export function sweptContact(o,from,to){
  if(o.hit)return null;
  const spec=OBSTACLES[o.kind],dt=to.elapsed-from.elapsed,base=o.baseHeight??0;
  const lateral=slab(from.x,to.x,o.lane*GAME.laneSpacing-(spec.width+GAME.playerWidth)/2,
    o.lane*GAME.laneSpacing+(spec.width+GAME.playerWidth)/2);
  if(!lateral)return null;
  const onTop=state=>state.supportId===o.id||
    (state.jumpSourceId===o.id&&state.action==='Jump'&&surfaceAt(o,state.distance,state.x)&&
      state.y>=surfaceHeight(o,state.distance)-1e-6);
  if(o.kind==='train'&&(onTop(from)||onTop(to)))return null;
  const cuts=[0,1];
  const slideSafeStart=from.slideFromDive?GAME.diveSlideSafeStart:GAME.slideSafeStart;
  if(from.action==='Slide'&&dt>0)for(const time of [slideSafeStart,GAME.slideSafeEnd]){
    const t=(time-from.actionTime)/dt;if(t>EPS&&t<1-EPS)cuts.push(t);
  }
  cuts.sort((a,b)=>a-b);
  for(let i=0;i<cuts.length-1;i++){
    const segment=[cuts[i],cuts[i+1]],mid=(segment[0]+segment[1])/2;
    const sliding=from.action==='Slide'&&from.actionTime+dt*mid>=slideSafeStart-EPS&&
      from.actionTime+dt*mid<=GAME.slideSafeEnd+EPS;
    const h=sliding?GAME.slidingHeight:GAME.standingHeight,depth=sliding?GAME.slidingDepth:GAME.playerDepth;
    const a=from.distance-frontAt(o,from.elapsed),b=to.distance-frontAt(o,to.elapsed);
    const bodyOffset=o.kind==='train'&&o.hasRamp?GAME.rampLength:0;
    // Ramp support uses the height beneath the character's centre. Extending
    // the full-height body into that slope creates an invisible vertical lip.
    const z=slab(a,b,bodyOffset?bodyOffset:-depth/2,obstacleLength(o)+depth/2);
    const clearance=o.kind==='barrier'?GAME.barrierClearance:spec.clearance;
    const vertical=clearance!==undefined?
      slab(from.y,to.y,base-h+1e-6,base+clearance-1e-7):
      slab(from.y,to.y,base+spec.bottom-h+1e-6,base+spec.top-1e-6);
    const solid=intersect(segment,lateral,z,vertical);
    let ramp=null;
    if(o.kind==='train'&&o.hasRamp){
      const slope=spec.top/GAME.rampLength;
      ramp=intersect(segment,lateral,slab(a,b,0,GAME.rampLength),
        slab(from.y-slope*a,to.y-slope*b,-Infinity,-1e-6));
    }
    if(solid||ramp)return Math.min(solid?.[0]??Infinity,ramp?.[0]??Infinity);
  }
  return null;
}
