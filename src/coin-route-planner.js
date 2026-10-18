import {GAME,OBSTACLES,timeAtDistance} from './game-config.js';
import {passageWindow,obstacleEnd,frontAt,surfaceHeight} from './collision.js';
import {COINS,coinContact} from './coins.js';

const order=commands=>commands.sort((a,b)=>a.time-b.time||(a.lane===undefined?1:-1));
const eligible=o=>!o.hit&&o.parentId==null&&o.kind!=='oncoming'&&(o.kind!=='train'||o.hasRamp);
const centerTime=o=>timeAtDistance(o.frontDistance+OBSTACLES[o.kind].length/2);
const recovery=o=>o.kind==='train'?timeAtDistance(obstacleEnd(o))+.72:centerTime(o)+.52;

// Each published detour returns to the committed ground corridor. Both ends of
// the tiny remaining lateral interval are carried forward after a fork, so the
// next detour is validated from either branch, using the real controller.
export class CoinRoutePlanner {
  constructor(simulate){this.simulate=simulate;this.clear();}
  clear(state=null){this.anchors=state?[state]:[];this.baseLane=0;this.seen=new Set();this.knownIds=new Set();this.commands=[];this.routes=[];this.nextId=1;this.version=-1;}
  laneAt(course,time){let lane=this.baseLane;for(const c of course.safeCommands)if(c.time<=time+1e-8)lane=c.lane;return lane;}
  baseline(course,end){return course.safeCommands.filter(c=>c.time>=this.anchors[0].elapsed-1e-8&&c.time<=end).map(c=>({...c}));}
  advanceBaseline(course,end){
    const commands=this.baseline(course,end),results=this.anchors.map(state=>this.simulate({state,obstacles:course.active,commands,end}));
    if(results.some(r=>!r.safe))return false;
    this.commands.push(...commands);this.anchors=results.map(r=>r.state);this.baseLane=this.laneAt(course,end);return true;
  }
  template(course,targets,end){
    const start=this.anchors[0].elapsed,lead=targets[0].arrivalTime<20?.72:.52;
    const entry=Math.max(start,passageWindow(targets[0]).start-lead),restore=Math.max(...targets.map(recovery));
    const commands=this.baseline(course,end).filter(c=>c.time<entry-1e-8||c.time>restore+1e-8);
    const samples=[];
    for(const o of targets){
      const enter=Math.max(entry,passageWindow(o).start-lead);
      commands.push({time:enter,lane:o.lane});
      const hazards=o.kind==='train'?course.active.filter(p=>p.parentId===o.id&&!p.hit):[o];
      for(const hazard of hazards){
        const center=centerTime(hazard),jump=hazard.kind!=='overhead';
        commands.push({time:center-(jump?.43:.42),action:jump?'jump':'slide'});
        for(let i=-2;i<=2;i++)samples.push({time:center+i*.12,obstacleId:hazard.id,supportId:hazard.parentId??null});
      }
      if(o.kind==='train'){
        const a=timeAtDistance(o.frontDistance)+.08,b=timeAtDistance(obstacleEnd(o))-.12;
        const count=Math.min(12,Math.max(5,Math.ceil((b-a)/.22)));
        for(let i=0;i<count;i++)samples.push({time:a+(b-a)*i/(count-1),obstacleId:o.id,supportId:o.id});
      }
    }
    commands.push({time:restore,lane:this.laneAt(course,restore)});
    return {commands:order(commands),samples:samples.filter(s=>s.time>=start&&s.time<=end).sort((a,b)=>a.time-b.time),entry};
  }
  outside(point,obstacles,time){
    const r=COINS.radius;
    return obstacles.every(o=>{
      if(o.hit)return true;
      const spec=OBSTACLES[o.kind],front=frontAt(o,time),base=o.baseHeight??0;
      if(Math.abs(point.x-o.lane*GAME.laneSpacing)>spec.width/2+r||point.distance<front-r||point.distance>obstacleEnd(o,time)+r)return true;
      const top=o.kind==='train'&&o.hasRamp?surfaceHeight(o,point.distance):base+spec.top;
      return point.y-r>top+.02||point.y+r<base+spec.bottom-.02;
    });
  }
  candidate(course,targets,end){
    const template=this.template(course,targets,end);
    if(template.commands.some(c=>c.time<this.anchors[0].elapsed-1e-8||c.time>end+1e-8))return null;
    const results=this.anchors.map(state=>this.simulate({state,obstacles:course.active,commands:template.commands,end,samples:template.samples.map(s=>s.time)}));
    if(results.some(r=>!r.safe||!r.state.grounded||r.state.y>1e-6||r.state.action!=='Run'||r.state.lane!==this.laneAt(course,end)))return null;
    const points=[];
    template.samples.forEach((sample,i)=>{
      const pose=results[0].samples[i];if(!pose)return;
      const point={x:pose.x,y:pose.y+(pose.action==='Slide'?.55:1.05),distance:pose.distance,
        obstacleId:sample.obstacleId,supportId:sample.supportId,challenge:true};
      if(!this.outside(point,course.active,sample.time))return;
      if(points.some(p=>Math.abs(p.distance-point.distance)<.85&&Math.abs(p.y-point.y)<.4))return;
      // All branch-entry states must actually reach every coin in this string.
      if(results.some(r=>coinContact(point,r.samples[i],r.samples[i])===null))return;
      points.push(point);
    });
    if(points.length<3)return null;
    return {commands:template.commands,points,states:results.map(r=>r.state),startStates:this.anchors.map(s=>({...s}))};
  }
  extend(course,coins,elapsed=0){
    if(!this.anchors.length)return;
    if(this.version===course.nextRowId&&elapsed<this.anchors[0].elapsed-.8)return;
    this.version=course.nextRowId;
    this.knownIds=new Set(course.active.map(o=>o.id));
    for(const id of this.seen)if(!this.knownIds.has(id))this.seen.delete(id);
    const horizon=course.planner.anchor.tick*GAME.routeGrid-.08;
    const obstacles=course.active.filter(eligible).sort((a,b)=>a.arrivalTime-b.arrivalTime||a.lane-b.lane);
    for(let budget=0;budget<12;budget++){
      const start=this.anchors[0].elapsed;
      const lead=start<20?.62:.42;
      for(const o of obstacles)if(o.arrivalTime<start+lead)this.seen.add(o.id);
      const first=obstacles.find(o=>!this.seen.has(o.id));
      if(!first){if(horizon>start+.05)this.advanceBaseline(course,horizon);break;}
      const row=obstacles.filter(o=>o.rowId===first.rowId&&!this.seen.has(o.id));
      const end=Math.min(...row.map(recovery))+.74;
      if(end>horizon){
        const approach=first.arrivalTime-(start<20?.78:.58);
        if(approach>start+.05)this.advanceBaseline(course,Math.min(horizon,approach));
        else if(elapsed>=start-.8)this.advanceBaseline(course,horizon);
        break;
      }
      const draw=(first.rowId*.61803398875)%1,late=first.arrivalTime>=60,middle=first.arrivalTime>=20;
      const next=obstacles.find(o=>o.rowId!==first.rowId&&o.arrivalTime>first.arrivalTime+1&&o.arrivalTime<first.arrivalTime+2.3);
      const wantsCombo=middle&&draw<(late?.6:.35);
      if(wantsCombo&&(!next||recovery(next)+.74>horizon)&&elapsed<start-.8)break;
      const combo=wantsCombo&&next&&recovery(next)+.74<=horizon;
      const candidates=[];
      const rotated=[...row].sort((a,b)=>((a.lane+first.rowId)%3)-((b.lane+first.rowId)%3));
      for(const o of rotated){
        const singleEnd=recovery(o)+.74;
        if(combo&&Math.max(singleEnd,recovery(next)+.74)<=horizon)candidates.push({targets:[o,next],end:Math.max(singleEnd,recovery(next)+.74)});
        if(singleEnd<=horizon)candidates.push({targets:[o],end:singleEnd});
      }
      let primary=null,chosen=null;
      for(const option of candidates){primary=this.candidate(course,option.targets,option.end);if(primary){chosen=option;break;}}
      if(primary){
        const id=this.nextId++,branches=[primary];
        if(middle&&draw<(late?.4:.25)){
          const left=row.find(o=>o.lane===-1),right=row.find(o=>o.lane===1);
          if(left&&right){
            const other=chosen.targets[0].lane===-1?right:left;
            const alternate=this.candidate(course,[other,...chosen.targets.slice(1)],chosen.end);
            if(alternate)branches.push(alternate);
          }
        }
        const points=branches.flatMap((branch,index)=>branch.points.map(p=>({...p,routeId:id,branch:index})));
        // Shared tails are rendered/awarded once even if both witnesses use them.
        const unique=points.filter((p,i)=>!points.slice(0,i).some(q=>Math.abs(p.x-q.x)<.05&&Math.abs(p.y-q.y)<.05&&Math.abs(p.distance-q.distance)<.05));
        if(!coins.add(unique))break;
        this.routes.push({id,start,end:chosen.end,branches:branches.map(b=>({commands:b.commands,states:b.startStates,points:b.points}))});
        this.commands.push(...primary.commands);
        const states=branches.flatMap(b=>b.states).sort((a,b)=>a.x-b.x);
        this.anchors=states.length>1?[states[0],states.at(-1)]:states;
        this.baseLane=this.laneAt(course,chosen.end);
      }else{
        if(!this.advanceBaseline(course,end))break;
      }
      for(const o of row)this.seen.add(o.id);
      const validIds=new Set(course.active.map(o=>o.id));for(const id of this.seen)if(!validIds.has(id))this.seen.delete(id);
    }
  }
  accepts(obstacles){
    if(!this.anchors.length||obstacles.every(o=>this.knownIds.has(o.id)||o.hit||passageWindow(o).start>this.anchors[0].elapsed+.02))return true;
    return this.routes.every(route=>route.branches.every(branch=>branch.states.every(state=>
      this.simulate({state,obstacles,commands:branch.commands,end:route.end}).safe)));
  }
  prune(elapsed){this.commands=this.commands.filter(c=>c.time>=elapsed-.5);this.routes=this.routes.filter(r=>r.end>=elapsed-.5);}
}
