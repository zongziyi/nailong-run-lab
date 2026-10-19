import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GAME,OBSTACLES,SPAWN_WEIGHTS,distanceAt,speedAt,timeAtDistance} from '../src/game-config.js';
import {ObstacleCourse,frontAt,passageWindow,bodyStart,obstacleEnd,surfaceAt,sweptContact} from '../src/obstacles.js';
import {RunnerController} from '../src/controller.js';

function random(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const record=(kind,extra={})=>({id:1,rowId:1,kind,lane:0,hasRamp:false,arrivalTime:0,frontDistance:10,motionSpeed:0,baseHeight:0,parentId:null,hit:false,hitAt:Infinity,...extra});
const state=extra=>({elapsed:0,distance:9.5,x:0,y:0,action:'Run',actionTime:0,supportId:null,jumpSourceId:null,...extra});
function emptyRunner(){const r=new RunnerController({random:random(9)});r.start();r.course.clear();r.course.nextFrontDistance=Infinity;return r;}
function place(r,kind,extra={}){const o=r.course.free.pop();Object.assign(o,record(kind,{id:r.course.nextId++,...extra}));r.course.active.push(o);return o;}

test('speed and integrated distance are 20 percent faster throughout the logarithmic curve',()=>{
  close(speedAt(0),10.56);
  for(const t of [0,1,30,120,300,600]){
    close(speedAt(t),1.2*(8.8+4.5*Math.log1p(t/15)));
    close(distanceAt(t),1.2*(8.8*t+4.5*((t+15)*Math.log1p(t/15)-t)));
    close(timeAtDistance(distanceAt(t)),t);
  }
  assert.equal(GAME.maxObstacles,32);assert.equal(GAME.doubleProbability,.7);
  assert.deepEqual(SPAWN_WEIGHTS,{barrier:25,overhead:25,crate:25,train:15,oncoming:10});
});

test('crates require a higher jump; elevated hazards affect the roof but not ground runners',()=>{
  const crate=record('crate'),a=state({distance:9.7}),b=state({elapsed:.05,distance:10.7});
  assert.notEqual(sweptContact(crate,a,b),null);
  assert.notEqual(sweptContact(crate,{...a,y:1.05},{...b,y:1.05}),null);
  assert.equal(sweptContact(crate,{...a,y:1.1},{...b,y:1.1}),null);
  for(const kind of ['barrier','overhead']){
    const roof=record(kind,{baseHeight:3.8,parentId:5});
    assert.equal(sweptContact(roof,a,b),null);
    assert.notEqual(sweptContact(roof,{...a,y:3.8},{...b,y:3.8}),null);
    if(kind==='barrier')assert.equal(sweptContact(roof,{...a,y:4.5},{...b,y:4.5}),null);
    else assert.equal(sweptContact(roof,{...a,y:3.8,action:'Slide',actionTime:.3},{...b,y:3.8,action:'Slide',actionTime:.35}),null);
  }
});

test('the controller clears crates with a timed jump, but running or sliding into them loses a life',()=>{
  for(const action of ['jump',null,'slide']){
    const r=emptyRunner(),crate=place(r,'crate',{frontDistance:distanceAt(.4)+GAME.playerDepth/2});
    if(action)assert.equal(r.input(action),true);
    for(let t=0;t<1-1e-8;t+=1/60)r.update(1/60);
    assert.equal(r.lives,action==='jump'?3:2);
    assert.equal(crate.hit,action!=='jump');
  }
});

test('actual roof jumping and sliding clear attached hazards and recover on the parent train',()=>{
  for(const [kind,action] of [['barrier','jump'],['overhead','slide']]){
    const r=emptyRunner(),parent=place(r,'train',{frontDistance:3,hasRamp:true});
    while(r.distance<bodyStart(parent)+2)r.update(GAME.physicsStep);
    assert.equal(r.supportId,parent.id);assert.equal(r.supportType,'roof');
    const ahead=action==='slide'?.34:.4,depth=action==='slide'?GAME.slidingDepth:GAME.playerDepth;
    const child=place(r,kind,{frontDistance:distanceAt(r.elapsed+ahead)+depth/2,
      baseHeight:OBSTACLES.train.top,parentId:parent.id});
    assert.equal(r.input(action),true);
    for(let t=0;t<1-1e-8;t+=1/60)r.update(1/60);
    assert.equal(r.lives,3);assert.equal(parent.hit,false);assert.equal(child.hit,false);
    assert.equal(r.action,'Run');assert.equal(r.supportId,parent.id);close(r.y,3.8);
  }
});

test('an oncoming train can cross a stationary player within one frame and has no walkable roof',()=>{
  const o=record('oncoming',{frontDistance:20,motionSpeed:6});
  const a=state({distance:0}),b=state({distance:0,elapsed:10});
  close(frontAt(o,10),-40);close(sweptContact(o,a,b),(20-GAME.playerDepth/2)/60);
  assert.equal(surfaceAt(o,22,0),null);
  assert.equal(sweptContact(o,{...a,x:GAME.laneSpacing},{...b,x:GAME.laneSpacing}),null);
});

test('moving collisions, one-time consumption and pause are consistent at 30/60/120 fps and dropped frames',()=>{
  const results=[];
  for(const fps of [30,60,120,4]){
    const r=emptyRunner(),o=place(r,'oncoming',{frontDistance:distanceAt(2)+GAME.slidingDepth/2,arrivalTime:2,motionSpeed:6});
    for(let t=0;t<3-1e-8;t+=1/fps)r.update(1/fps);
    assert.equal(r.lives,2);assert.equal(r.damageSerial,1);assert.equal(o.hit,true);
    r.pause();const before=JSON.stringify(r);r.update(.25);assert.equal(JSON.stringify(r),before);
    results.push(r.lastDamageAt);
  }
  assert.ok(Math.max(...results)-Math.min(...results)<.00001);
});

test('warning timing matches physical approach; protected contacts do not inflict delayed damage',()=>{
  const r=emptyRunner(),o=place(r,'oncoming',{frontDistance:distanceAt(3)+GAME.slidingDepth/2,arrivalTime:3,motionSpeed:6});
  const window=passageWindow(o);close(window.start,3);
  assert.equal(r.course.warnings(.59).length,0);assert.equal(r.course.warnings(.6).length,1);
  r.protectedUntil=10;for(let t=0;t<5;t+=.1)r.update(.1);
  assert.equal(r.lives,3);assert.equal(o.hit,true);assert.equal(r.course.warnings(r.elapsed).length,0);
  r.protectedUntil=0;r.update(.25);assert.equal(r.lives,3);
});

test('parent consumption cascades to rooftop children without restarting an existing fade',()=>{
  const r=emptyRunner(),parent=place(r,'train',{hasRamp:true}),a=place(r,'barrier',{parentId:parent.id,baseHeight:3.8}),b=place(r,'overhead',{parentId:parent.id,baseHeight:3.8});
  r.course.touch(a,1);r.course.touch(parent,2);
  assert.equal(parent.hitAt,2);assert.equal(a.hitAt,1);assert.equal(b.hitAt,2);
  assert.equal(r.course.contacts(state({distance:10,y:3.8}),state({distance:11,y:3.8,elapsed:.1})).length,0);
});

test('1,000 seeded courses replay their committed safe corridor without damage',t=>{
  const kinds=new Set();let roofCount=0,doubles=0,groups=0;
  for(let seed=1;seed<=1000;seed++){
    const r=new RunnerController({random:random(seed)});r.start();let executed=-Infinity;
    while(r.elapsed<20-1e-8){
      const commands=r.course.safeCommands.filter(c=>c.time>executed+1e-8);
      const next=commands[0];
      if(next&&next.time<=r.elapsed+1e-8){
        while(r.lane!==next.lane)r.input(next.lane>r.lane?'right':'left');executed=next.time;continue;
      }
      const dt=Math.min(.1,20-r.elapsed,next?next.time-r.elapsed:.1);
      r.update(dt);
      assert.equal(r.lives,3,`Unsafe corridor seed ${seed}, time ${r.elapsed}`);
      assert.equal(r.y,0,'The reserved route must not depend on climbing or jumping');
      assert.ok(r.course.active.length<=32);
      for(const o of r.course.active){
        kinds.add(o.kind);
        if(o.parentId!=null){
          roofCount++;const parent=r.course.active.find(p=>p.id===o.parentId);assert.ok(parent);
          assert.ok(o.frontDistance>=bodyStart(parent)+Math.max(4,speedAt(timeAtDistance(bodyStart(parent)))*.35)-1e-7);
          assert.ok(o.frontDistance+OBSTACLES[o.kind].length<=obstacleEnd(parent)-2+1e-7);
          assert.equal(o.baseHeight,3.8);
        }
      }
    }
    groups+=r.course.generationStats.groups;doubles+=r.course.generationStats.doubles;
  }
  assert.deepEqual([...kinds].sort(),['barrier','crate','oncoming','overhead','train']);
  assert.ok(roofCount>0);assert.ok(doubles/groups>.5,'Dense groups must be materially more common');
  t.diagnostic(`Replayed 1000 routes; ${groups} generated groups; ${(100*doubles/groups).toFixed(1)}% double groups; all five ground types observed.`);
});

test('rooftop siblings keep action recovery time and object reuse clears moving/parent fields',()=>{
  const c=new ObstacleCourse({random:random(33)});c.begin();const seen=new Map();
  for(let d=0;d<2000;d+=10){c.recycle(d);for(const o of c.active)seen.set(o.id,{...o});}
  const parents=new Map();
  for(const o of seen.values()){
    if(o.parentId!=null){if(!parents.has(o.parentId))parents.set(o.parentId,[]);parents.get(o.parentId).push(o);}
    else {assert.equal(o.baseHeight,0);if(o.kind!=='oncoming')assert.equal(o.motionSpeed,0);}
  }
  for(const siblings of parents.values()){
    siblings.sort((a,b)=>a.frontDistance-b.frontDistance);assert.ok(siblings.length<=2);
    if(siblings.length===2)assert.ok(timeAtDistance(siblings[1].frontDistance)-timeAtDistance(siblings[0].frontDistance)>=1.05-1e-7);
  }
  c.begin();assert.equal(c.pool.length,32);assert.ok(c.active.every(o=>!o.hit));
});
