import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GAME,FAST,speedAt,distanceAt,timeAtDistance} from '../src/game-config.js';
import {RunnerController,simulateRoute} from '../src/controller.js';
import {passageWindow} from '../src/collision.js';

const close=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const random=seed=>()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);

test('fast speed caps at ten ordinary starting speeds with continuous distance and an exact inverse',()=>{
  for(const [t,m] of [[0,1.5],[60,13/3],[120,43/6],[180,10],[600,10]])close(speedAt(t,'fast')/GAME.speed,m);
  for(const t of [0,.0001,1,60,120,179.999,180,180.001,600,100000]){
    close(timeAtDistance(distanceAt(t,'fast'),'fast'),t);
    const h=1e-4;
    if(t>h)close((distanceAt(t+h,'fast')-distanceAt(t-h,'fast'))/(2*h),speedAt(t,'fast'),1e-4);
  }
  close(distanceAt(180,'fast'),(FAST.initialSpeed+FAST.maxSpeed)*90);
  close(distanceAt(181,'fast')-distanceAt(180,'fast'),FAST.maxSpeed);
  assert.equal(speedAt(-1,'fast'),FAST.initialSpeed);assert.equal(distanceAt(-1,'fast'),0);
  assert.equal(timeAtDistance(Infinity,'fast'),Infinity);
});

test('four gameplay combinations preserve choices across restart/inspect and freeze time on pause/end',()=>{
  const r=new RunnerController({random:random(3)});
  assert.equal(r.speedMode,'normal');
  for(const speedMode of ['normal','fast'])for(const maxLives of [1,3]){
    r.start({speedMode,maxLives});r.update(.1);
    assert.equal(r.course.speedMode,speedMode);assert.equal(r.course.planner.speedMode,speedMode);
    assert.equal(r.coinPlanner.speedMode,speedMode);assert.equal(r.simulationState().speedMode,speedMode);
    const before=JSON.stringify(r.simulationState());r.pause();r.update(.25);assert.equal(JSON.stringify(r.simulationState()),before);
    for(const mode of ['invalid',null,1])assert.throws(()=>r.start({speedMode:mode}),RangeError);
    assert.equal(JSON.stringify(r.simulationState()),before);
    r.start();assert.equal(r.elapsed,0);assert.equal(r.speedMode,speedMode);assert.equal(r.maxLives,maxLives);
    r.gameOver=true;r.update(.25);assert.equal(r.elapsed,0);
    r.inspect();r.start();assert.equal(r.speedMode,speedMode);assert.equal(r.maxLives,maxLives);
  }
});

function windowRunner(seed,start){
  const r=new RunnerController({random:random(seed)});r.start({speedMode:'fast'});r.elapsed=start;
  r.course.clear();r.course.planner.anchor={tick:Math.round(start/GAME.routeGrid),lane:0,x:0,parent:null};
  r.course.nextArrivalTime=start+GAME.warmupSeconds;
  r.course.nextFrontDistance=distanceAt(r.course.nextArrivalTime,'fast')+GAME.slidingDepth/2;
  r.coinPlanner.clear(r.simulationState());r.coins.clear();r.course.fillAhead(r.distance,start);
  r.coinPlanner.extend(r.course,r.coins,start);return r;
}

test('seeded fast coin routes and ground corridors stay safe during acceleration and across the cap',t=>{
  let routes=0,coins=0;
  for(const start of [0,60,175,240])for(let seed=1;seed<=24;seed++)for(const useCoins of [false,true]){
    const r=windowRunner(seed,start),end=start+14,executed=new Set(),expected=new Map(),collected=new Set();
    while(r.elapsed<end-1e-8){
      for(const route of r.coinPlanner.routes)if(!expected.has(route.id)){
        const points=route.branches[0].points;
        expected.set(route.id,{end:route.end,ids:r.coins.active.filter(c=>c.routeId===route.id&&points.some(p=>Math.abs(p.distance-c.distance)<.05&&Math.abs(p.x-c.x)<.05)).map(c=>c.id)});
        routes++;
      }
      const commands=(useCoins?r.coinPlanner.commands:r.course.safeCommands).filter(c=>!executed.has(JSON.stringify(c))).sort((a,b)=>a.time-b.time);
      const next=commands[0];
      if(next&&next.time<=r.elapsed+1e-7){
        if(next.lane!==undefined)while(r.lane!==next.lane)r.input(next.lane>r.lane?'right':'left');
        if(next.action)assert.equal(r.input(next.action),true);executed.add(JSON.stringify(next));continue;
      }
      r.update(Math.min(seed%2?.25:1/60,end-r.elapsed,next?next.time-r.elapsed:.25));
      for(const event of r.drainCoinEvents()){collected.add(event.id);coins++;}
      assert.equal(r.lives,3,`seed ${seed} start ${start} coins ${useCoins} time ${r.elapsed}`);
      if(useCoins)for(const route of expected.values())if(route.end<=r.elapsed)for(const id of route.ids)assert.ok(collected.has(id),`missed coin ${id}`);
      assert.ok(r.course.active.length<=GAME.maxObstacles);
    }
  }
  assert.ok(routes>100);assert.ok(coins>100);t.diagnostic(`${routes} fast route witnesses; ${coins} coins collected`);
});

test('fast moving-obstacle passage times and isolated simulation use the same speed profile',()=>{
  const r=windowRunner(7,179),o=r.course.record('oncoming',0,180);
  const window=passageWindow(o,0,GAME.slidingDepth,'fast');
  close(distanceAt(window.start,'fast')+o.motionSpeed*(window.start-o.arrivalTime),o.frontDistance-GAME.slidingDepth/2);
  const state=r.simulationState(),result=simulateRoute({state,obstacles:[],end:181,samples:[180]});
  assert.equal(result.safe,true);close(result.state.distance,distanceAt(181,'fast'));close(result.samples[0].distance,distanceAt(180,'fast'));
  assert.equal(result.state.speedMode,'fast');assert.equal(r.elapsed,179);
});

test('capped fast sweeps still damage on thin obstacles and allow a timed train ramp ascent',()=>{
  for(const kind of ['barrier','train'])for(const fps of [30,60,120,4]){
    const r=windowRunner(1,240);r.course.clear();r.coins.clear();r.coinPlanner.clear();r.course.nextFrontDistance=Infinity;
    const o=r.course.record(kind,0,240.3);o.hasRamp=kind==='train';const placed=r.course.allocate(o);
    while(r.elapsed<240.4-1e-8&&!r.gameOver)r.update(Math.min(1/fps,240.4-r.elapsed));
    if(kind==='barrier'){assert.equal(r.lives,2);assert.equal(placed.hit,true);}
    else {assert.equal(r.lives,3);assert.equal(r.supportType,'roof');close(r.y,3.8);}
  }
});
