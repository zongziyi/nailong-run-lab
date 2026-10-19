import {GAME,OBSTACLES} from './game-config.js';
import {passageWindow} from './collision.js';

/** Time-expanded ground corridor. Every edge checks the complete continuous
 * exponential lane sweep against occupied time slabs, with extra margin.
 * Committing one witness prefix prevents later rows from rewriting past turns. */
export class RoutePlanner {
  constructor({speedMode='normal'}={}){this.speedMode=speedMode;this.clear();}
  clear(){this.anchor={tick:0,lane:0,x:0,parent:null};}
  propose(obstacles,arrivalTime){
    const grid=GAME.routeGrid,commitTick=Math.floor((arrivalTime+1e-8)/grid);
    const occupied=obstacles.filter(o=>!o.hit&&(o.baseHeight??0)<GAME.standingHeight&&
      (o.baseHeight??0)+OBSTACLES[o.kind].top>0).map(o=>({lane:o.lane,
        half:(OBSTACLES[o.kind].width+GAME.playerWidth)/2+GAME.routeMargin,
        ...passageWindow(o,GAME.routeMargin,GAME.playerDepth,this.speedMode)}));
    const endTick=Math.ceil(Math.max(arrivalTime+GAME.rowSecondsMax,
      ...occupied.map(o=>o.end+GAME.routeChangeSeconds))/grid);
    const frames=Array.from({length:endTick-this.anchor.tick+1},()=>new Map());
    frames[0].set(this.anchor.lane,this.anchor);
    const clearEdge=(node,lane,end)=>{
      const start=node.tick*grid,target=lane*GAME.laneSpacing;
      const at=t=>target+(node.x-target)*Math.exp(-13*(t-start));
      for(const o of occupied){
        const a=Math.max(start,o.start),b=Math.min(end,o.end);if(a>b+1e-9)continue;
        const x1=at(a),x2=at(b),center=o.lane*GAME.laneSpacing;
        if(Math.min(x1,x2)<=center+o.half&&Math.max(x1,x2)>=center-o.half)return false;
      }
      return true;
    };
    for(let tick=this.anchor.tick;tick<endTick;tick++)for(const node of frames[tick-this.anchor.tick].values()){
      for(const lane of [node.lane,node.lane-1,node.lane+1]){
        if(lane< -1||lane>1)continue;
        const ticks=lane===node.lane?1:Math.round(GAME.routeChangeSeconds/grid),to=tick+ticks;
        if(to>endTick||(tick<commitTick&&to>commitTick))continue;
        if(!clearEdge(node,lane,to*grid))continue;
        const cost=(node.cost??0)+(lane===node.lane?0:1),frame=frames[to-this.anchor.tick];
        if(frame.has(lane)&&frame.get(lane).cost<=cost)continue;
        frame.set(lane,{tick:to,lane,x:lane*GAME.laneSpacing+(node.x-lane*GAME.laneSpacing)*Math.exp(-13*ticks*grid),parent:node,cost});
      }
    }
    const endings=[...frames.at(-1).values()].sort((a,b)=>a.cost-b.cost);
    if(!endings.length)return null;
    let committed=endings[0];while(committed.tick>commitTick)committed=committed.parent;
    const commands=[];let node=committed;
    while(node.parent){
      if(node.lane!==node.parent.lane)commands.push({time:node.parent.tick*grid,lane:node.lane});
      if(node.parent===this.anchor)break;node=node.parent;
    }
    return {committed,commands:commands.reverse()};
  }
  commit(proposal){
    const {tick,lane,x}=proposal.committed;this.anchor={tick,lane,x,parent:null};
  }
}
