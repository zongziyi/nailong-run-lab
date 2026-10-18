import {GAME} from './game-config.js';

export const COINS=Object.freeze({capacity:384,radius:.23,flashSeconds:.28});
const slab=(a,b,lo,hi)=>{
  if(Math.abs(b-a)<1e-12)return a>=lo&&a<=hi?[0,1]:null;
  const p=(lo-a)/(b-a),q=(hi-a)/(b-a),enter=Math.max(0,Math.min(p,q)),exit=Math.min(1,Math.max(p,q));
  return enter<=exit?[enter,exit]:null;
};
export function coinContact(coin,from,to){
  const dt=to.elapsed-from.elapsed,cuts=[0,1];
  const safeStart=from.slideFromDive?GAME.diveSlideSafeStart:GAME.slideSafeStart;
  if(from.action==='Slide'&&dt>0)for(const age of [safeStart,GAME.slideSafeEnd]){
    const f=(age-from.actionTime)/dt;if(f>0&&f<1)cuts.push(f);
  }
  cuts.sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
    const age=from.actionTime+dt*(cuts[i-1]+cuts[i])/2;
    const sliding=from.action==='Slide'&&age>=safeStart&&age<=GAME.slideSafeEnd;
    const height=sliding?GAME.slidingHeight:GAME.standingHeight,depth=sliding?GAME.slidingDepth:GAME.playerDepth;
    const intervals=[[cuts[i-1],cuts[i]],
      slab(from.x,to.x,coin.x-GAME.playerWidth/2-COINS.radius,coin.x+GAME.playerWidth/2+COINS.radius),
      slab(from.distance,to.distance,coin.distance-depth/2-COINS.radius,coin.distance+depth/2+COINS.radius),
      slab(from.y,to.y,coin.y-height-COINS.radius+.12,coin.y+COINS.radius-.12)];
    if(intervals.some(v=>v===null))continue;
    const enter=Math.max(...intervals.map(v=>v[0])),exit=Math.min(...intervals.map(v=>v[1]));
    if(enter<=exit)return enter;
  }
  return null;
}

export class CoinCourse {
  constructor(){this.pool=Array.from({length:COINS.capacity},()=>({}));this.active=[];this.clear();}
  clear(){this.active.length=0;this.free=[...this.pool];this.nextId=1;}
  add(points){
    if(points.length>this.free.length)return false;
    for(const point of points){const record=this.free.pop();Object.assign(record,point,{id:this.nextId++,collectedAt:null});this.active.push(record);}
    return true;
  }
  collect(from,to,obstacles,{fatal=false}={}){
    const events=[];
    for(const coin of this.active){
      if(coin.collectedAt!==null)continue;
      const fraction=coinContact(coin,from,to);if(fraction===null||(fatal&&fraction>=1-1e-9))continue;
      const elapsed=from.elapsed+(to.elapsed-from.elapsed)*fraction;
      const support=coin.supportId==null?null:obstacles.find(o=>o.id===coin.supportId);
      if(coin.supportId!=null&&(!support||(support.hit&&support.hitAt<=elapsed)))continue;
      coin.collectedAt=elapsed;events.push({id:coin.id,elapsed,x:coin.x,y:coin.y});
    }
    return events.sort((a,b)=>a.elapsed-b.elapsed||a.id-b.id);
  }
  recycle(distance,elapsed,obstacles){
    const supports=new Map(obstacles.map(o=>[o.id,o]));let write=0;
    for(const coin of this.active){
      const support=coin.supportId==null?null:supports.get(coin.supportId);
      const invalid=coin.supportId!=null&&(!support||support.hit);
      if(invalid||distance>coin.distance+GAME.recycleBehind||
        (coin.collectedAt!==null&&elapsed-coin.collectedAt>COINS.flashSeconds))this.free.push(coin);
      else this.active[write++]=coin;
    }
    this.active.length=write;
  }
}
