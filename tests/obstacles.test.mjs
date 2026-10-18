import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GAME,OBSTACLES,distanceAt,timeAtDistance} from '../src/game-config.js';
import {sweptContact,ObstacleCourse,obstacleEnd,passageWindow} from '../src/obstacles.js';
import {RunnerController} from '../src/controller.js';

function random(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const obstacle=(kind,extra={})=>({id:1,kind,hasRamp:false,lane:0,frontDistance:10,arrivalTime:0,motionSpeed:0,baseHeight:0,parentId:null,hit:false,hitAt:Infinity,...extra});
const state=extra=>({x:0,y:0,elapsed:0,distance:9.5,action:'Run',actionTime:0,...extra});
function sweep(kind,extra={},start={},end={}){
  return sweptContact(obstacle(kind,extra),state(start),state({distance:10.5,elapsed:0.05,...start,...end}));
}
function emptyRoute(r){r.course.clear();r.course.nextFrontDistance=Infinity;}
function place(r,kind,frontDistance,lane=0){
  const entry=r.course.free.pop();assert.ok(entry,'Fixture pool exhausted');
  Object.assign(entry,obstacle(kind,{id:r.course.nextId++,frontDistance,lane}));r.course.active.push(entry);return entry;
}
function tick(r,seconds,fps=60){for(let t=0;t<seconds-1e-10;t+=1/fps)r.update(Math.min(1/fps,seconds-t));}

test('barrier: ground/slide fail, sufficient jump or adjacent lane clears',()=>{
  assert.notEqual(sweep('barrier'),null);
  assert.notEqual(sweep('barrier',{}, {action:'Slide',actionTime:0.3}),null);
  assert.equal(sweep('barrier',{}, {y:0.70}),null);
  assert.equal(sweep('barrier',{}, {y:1.5}),null);
  assert.equal(sweep('barrier',{}, {x:GAME.laneSpacing}),null);
  assert.notEqual(sweep('barrier',{}, {y:1.2},{y:0}),null,'Landing onto a barrier must hit');
});
test('overhead: only the stable slide window clears; jumping, early and late slide fail',()=>{
  assert.notEqual(sweep('overhead'),null);
  assert.notEqual(sweep('overhead',{}, {action:'Jump',y:1.95}),null);
  assert.equal(sweep('overhead',{}, {action:'Slide',actionTime:0.3}),null);
  assert.notEqual(sweep('overhead',{}, {action:'Slide',actionTime:0.05}),null);
  assert.notEqual(sweep('overhead',{}, {action:'Slide',actionTime:0.75}),null);
  assert.notEqual(sweep('overhead',{}, {action:'Slide',actionTime:0.18}),null,'Unsafe entry within the same frame');
  const late=sweep('overhead',{}, {action:'Slide',actionTime:0.62});
  assert.ok(Math.abs(late-0.6)<1e-6,'Detect slide recovery inside the contact interval');
});
test('train: jump/slide cannot bypass it; actual lateral position determines contact',()=>{
  assert.notEqual(sweep('train',{}, {action:'Jump',y:1.95}),null);
  assert.notEqual(sweep('train',{}, {action:'Slide',actionTime:0.3}),null);
  assert.equal(sweep('train',{}, {x:GAME.laneSpacing}),null);
  assert.notEqual(sweep('train',{}, {distance:9.65,x:0,lane:1},{distance:9.75,x:1.075}),null,'A target lane is not an instant dodge');
  assert.equal(sweep('train',{}, {x:1.4},{x:1.6}),null);
});
test('sweep catches an obstacle fully crossed in one frame and ignores rear/consumed objects',()=>{
  const hit=sweptContact(obstacle('barrier'),state({distance:0}),state({distance:30,elapsed:0.05}));
  assert.ok(Math.abs(hit-(10-GAME.playerDepth/2)/30)<1e-8);
  assert.equal(sweep('train',{hit:true}),null);
  assert.equal(sweep('barrier',{frontDistance:0}),null);
});
test('one contact consumes one life; shield contacts never cause delayed damage',()=>{
  const r=new RunnerController({random:random(1)});r.start();emptyRoute(r);
  const first=place(r,'train',r.distance+GAME.playerDepth/2);
  r.update(1/60);assert.equal(r.lives,2);assert.equal(first.hit,true);assert.ok(r.invincibleRemaining>1.4);
  const second=place(r,'train',r.distance+GAME.playerDepth/2);
  r.update(1/60);assert.equal(r.lives,2);assert.equal(second.hit,true);
  // Prolong this consumed obstacle beyond the protection window.
  second.frontDistance=r.distance+5;
  tick(r,2);assert.equal(r.lives,2);assert.equal(r.invincibleRemaining,0);
});
test('simultaneous contacts deduct at most one life; third damage freezes the run',()=>{
  const r=new RunnerController({random:random(2)});r.start();emptyRoute(r);
  place(r,'train',GAME.playerDepth/2);place(r,'barrier',GAME.playerDepth/2);
  r.update(1/60);assert.equal(r.lives,2);assert.ok(r.course.active.every(o=>o.hit));
  tick(r,1.6);
  place(r,'train',r.distance+GAME.playerDepth/2);r.update(1/60);assert.equal(r.lives,1);
  tick(r,1.6);r.input('jump');r.update(0.05);
  place(r,'train',r.distance+GAME.playerDepth/2);r.update(1/60);
  assert.equal(r.lives,0);assert.equal(r.gameOver,true);assert.ok(r.y>0);
  const frozen=JSON.stringify(r);assert.equal(r.input('left'),false);r.togglePause();r.pause();tick(r,2);
  assert.equal(JSON.stringify(r),frozen);
});
test('pause freezes the shield/course; restart and inspect clear every transient state',()=>{
  const r=new RunnerController({random:random(3)});r.start();emptyRoute(r);
  place(r,'train',0.4);r.update(1/60);r.pause();
  const snapshot=JSON.stringify(r),protection=r.invincibleRemaining;tick(r,4);
  assert.equal(JSON.stringify(r),snapshot);assert.equal(r.invincibleRemaining,protection);
  r.togglePause();r.input('right');r.input('jump');r.update(0.05);
  r.start();assert.equal(r.lives,3);assert.equal(r.gameOver,false);assert.equal(r.invincibleRemaining,0);
  assert.equal(r.distance,0);assert.equal(r.action,'Run');assert.equal(r.actionTime,0);assert.equal(r.y,0);assert.equal(r.x,0);
  assert.ok(r.course.active.length>0);assert.ok(r.course.active.every(o=>!o.hit));
  r.inspect();assert.equal(r.course.active.length,0);assert.equal(r.lives,3);assert.equal(r.action,'Idle');
});
test('1,000 seeded routes preserve row timing, same-lane exits, moving cooldown and pool bounds',()=>{
  for(let seed=1;seed<=1000;seed++){
    const course=new ObstacleCourse({random:random(seed)});course.begin();const seen=new Map();
    for(let distance=0;distance<400;distance+=25){
      course.recycle(distance);
      assert.ok(course.active.length<=GAME.maxObstacles);
      assert.equal(new Set([...course.active,...course.free]).size,GAME.maxObstacles);
      for(const o of course.active)seen.set(o.id,{...o});
    }
    const rows=new Map(),list=[...seen.values()];
    for(const o of list.filter(o=>o.parentId==null)){
      assert.ok(o.arrivalTime>=GAME.warmupSeconds);
      if(!rows.has(o.rowId))rows.set(o.rowId,{time:o.arrivalTime,lanes:new Set()});
      rows.get(o.rowId).lanes.add(o.lane);
    }
    const ordered=[...rows].sort((a,b)=>a[0]-b[0]);
    for(let i=0;i<ordered.length;i++){
      const [id,row]=ordered[i];assert.ok(row.lanes.size>=1&&row.lanes.size<=2);
      if(i){const [previousId,previous]=ordered[i-1],delta=id-previousId;
        assert.ok(row.time-previous.time>=GAME.rowSecondsMin*delta-1e-7);
        assert.ok(row.time-previous.time<=GAME.rowSecondsMax*delta+1e-7);}
    }
    for(const lane of [-1,0,1]){
      const ground=list.filter(o=>o.parentId==null&&o.lane===lane).sort((a,b)=>a.arrivalTime-b.arrivalTime);
      for(let i=1;i<ground.length;i++)assert.ok(passageWindow(ground[i]).start>=passageWindow(ground[i-1]).end+GAME.exitReactionSeconds-1e-7);
    }
    const incoming=list.filter(o=>o.kind==='oncoming').sort((a,b)=>a.arrivalTime-b.arrivalTime);
    for(let i=1;i<incoming.length;i++)assert.ok(incoming[i].arrivalTime-incoming[i-1].arrivalTime>=GAME.oncomingCooldown-1e-7);
    for(const o of incoming){assert.equal(o.hasRamp,false);assert.equal(o.motionSpeed,6);}
  }
});

test('recycling over 100,000 units retains the original bounded record pool',()=>{
  const course=new ObstacleCourse({random:random(14)});course.begin();const owned=new Set(course.pool);
  for(let distance=0;distance<100000;distance+=10){
    course.recycle(distance);
    assert.ok(course.active.every(o=>owned.has(o)));
    assert.ok(course.active.length<=GAME.maxObstacles);
  }
  course.begin();assert.equal(new Set([...course.active,...course.free]).size,GAME.maxObstacles);
});
test('30/60/120 fps agree on timed dodges, protection and game-over distance',()=>{
  const results=[];
  for(const fps of [30,60,120]){
    const r=new RunnerController({random:random(4)});r.start();emptyRoute(r);
    const at=t=>distanceAt(t)+GAME.playerDepth/2;
    place(r,'barrier',at(1.2));place(r,'overhead',at(2.6));place(r,'train',at(4.2));
    place(r,'barrier',at(5.8),1);place(r,'train',at(6.2),1);place(r,'train',at(8),1);place(r,'train',at(10),1);
    const inputs=[[0.8,'jump'],[2.2,'slide'],[3.5,'right'],[9.7,'jump']];let next=0;
    for(let i=0;i<fps*12&&!r.gameOver;i++){
      while(next<inputs.length&&r.elapsed>=inputs[next][0]-1e-9)r.input(inputs[next++][1]);
      const dt=Math.min(1/fps,next<inputs.length?inputs[next][0]-r.elapsed:1/fps);
      r.update(dt>1e-9?dt:1/fps);
    }
    assert.equal(r.gameOver,true);assert.equal(r.lives,0);assert.equal(r.damageSerial,3);
    assert.ok(Math.abs(r.distance-at(10)+GAME.playerDepth/2)<0.002);
    results.push(r.distance);
  }
  assert.ok(Math.max(...results)-Math.min(...results)<0.002);
});
