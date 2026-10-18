import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GAME,OBSTACLES,speedAt,distanceAt,timeAtDistance,gravity,jumpVelocity} from '../src/game-config.js';
import {RunnerController} from '../src/controller.js';
import {surfaceAt,surfaceHeight,bodyStart,obstacleEnd,sweptContact} from '../src/obstacles.js';

const close=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function runner(){const r=new RunnerController({random:()=>.1});r.start();r.course.clear();r.course.nextFrontDistance=Infinity;return r;}
function train(r,front=6,lane=0,hasRamp=true){
  const o=r.course.free.pop();Object.assign(o,{id:r.course.nextId++,kind:'train',lane,hasRamp,frontDistance:front,arrivalTime:0,motionSpeed:0,baseHeight:0,parentId:null,hit:false,hitAt:Infinity});r.course.active.push(o);return o;
}
function tick(r,seconds,fps=120){for(let t=0;t<seconds-1e-9;t+=1/fps)r.update(Math.min(1/fps,seconds-t));}
function until(r,distance,fps=120){tick(r,Math.max(0,timeAtDistance(distance)-r.elapsed),fps);}

test('logarithmic acceleration grows forever with diminishing increments; distance is its integral',()=>{
  close(speedAt(0),8.8);close(distanceAt(0),0);
  const deltas=[];
  for(let t=0;t<=600;t+=15){
    deltas.push(speedAt(t+15)-speedAt(t));assert.ok(speedAt(t+15)>speedAt(t));
    const h=.001;close((distanceAt(t+h)-distanceAt(Math.max(0,t-h)))/(t===0?h:2*h),speedAt(t),.001);
    close(timeAtDistance(distanceAt(t)),t);
  }
  for(let i=1;i<deltas.length;i++)assert.ok(deltas[i]<deltas[i-1]);
  assert.ok(speedAt(1e9)>speedAt(1e6));
  const r=runner();tick(r,2);const before=[r.elapsed,r.distance,r.speed];r.pause();tick(r,5);
  assert.deepEqual([r.elapsed,r.distance,r.speed],before);r.start();close(r.speed,8.8);close(r.distance,0);
});

test('ramp toe, slope, roof and tail form continuous walkable terrain without damage',()=>{
  const r=runner(),o=train(r);
  assert.equal(surfaceAt(o,5,0),null);close(bodyStart(o),14);close(obstacleEnd(o),32);
  until(r,6);assert.equal(r.supportType,'ramp');close(r.y,0);
  until(r,10);close(r.y,1.9);assert.equal(r.supportId,o.id);assert.equal(r.lives,3);
  until(r,14);close(r.y,3.8);assert.equal(r.supportType,'roof');
  until(r,30);assert.equal(r.grounded,true);close(r.y,3.8);assert.equal(r.lives,3);
  until(r,33);assert.equal(r.grounded,false);assert.ok(r.y<3.8&&r.y>0);assert.equal(r.input('jump'),false);
  tick(r,1);close(r.y,0);assert.equal(r.supportType,'ground');assert.equal(r.lives,3);
});

test('jump on a roof lands back on it; jumping at ground level does not bypass a train wall',()=>{
  const r=runner(),o=train(r);until(r,15);assert.equal(r.input('jump'),true);
  tick(r,.35);assert.ok(r.y>5.5);assert.equal(r.input('jump'),false);
  tick(r,.56);assert.equal(r.grounded,true);assert.equal(r.supportId,o.id);close(r.y,3.8);assert.equal(r.lives,3);
  const ground=runner(),wall=train(ground,6,0,false);ground.input('jump');until(ground,7);
  assert.equal(ground.lives,2);assert.equal(wall.hit,true);assert.ok(ground.y<3.8);
});

test('side entry into a ramp or train hits instead of snapping upward; leaving a slope falls',()=>{
  for(const hasRamp of [true,false]){
    const r=runner(),o=train(r,6,0,hasRamp);r.elapsed=timeAtDistance(10);r.x=-GAME.laneSpacing;r.lane=-1;
    r.input('right');tick(r,.3);assert.equal(r.lives,2);assert.equal(o.hit,true);assert.ok(r.y<.05);
  }
  const r=runner();train(r);until(r,10);const height=r.y;r.input('right');tick(r,.25);
  assert.equal(r.supportType,'air');assert.ok(r.y<height+.4);assert.equal(r.lives,3);tick(r,1);close(r.y,0);
});

test('a downward jump can land on an adjacent roof; falling sideways returns to ground',()=>{
  const r=runner();train(r);const adjacent=train(r,6,1,false);until(r,15);
  r.input('jump');r.input('right');tick(r,.92);assert.equal(r.supportId,adjacent.id);close(r.y,3.8);assert.equal(r.lives,3);
  assert.equal(r.jumpSourceId,null);
  r.input('left');r.input('left');tick(r,1);close(r.y,0);assert.equal(r.supportType,'ground');
});

test('sliding off a tail falls; consumed support disappears even during protection',()=>{
  const r=runner(),o=train(r);until(r,31);r.input('slide');tick(r,.3);
  assert.equal(r.grounded,false);assert.ok(r.y<3.8);tick(r,.8);close(r.y,0);
  const shielded=runner(),platform=train(shielded);until(shielded,16);
  shielded.protectedUntil=shielded.elapsed+1.5;shielded.course.touch(platform,shielded.elapsed);
  shielded.update(1/60);assert.equal(shielded.grounded,false);assert.equal(shielded.supportId,null);
  assert.ok(shielded.y<3.8);assert.equal(shielded.lives,3);
  assert.equal(surfaceAt(platform,shielded.distance,shielded.x),null);
});

test('terrain ascent/jump/slide/fall agree across 30/60/120 fps and quarter-second dropped frames',()=>{
  const results=[];
  for(const fps of [30,60,120,4]){
    const r=runner();train(r);until(r,16,fps);r.input('jump');tick(r,.95,fps);
    assert.equal(r.supportType,'roof');r.input('slide');tick(r,.85,fps);tick(r,1.1,fps);
    assert.equal(r.lives,3);assert.equal(r.supportType,'ground');
    results.push([r.elapsed,r.distance,r.y]);
  }
  for(const result of results)for(let i=0;i<3;i++)close(result[i],results[0][i],.003);
});

test('first generated train has a ramp; identical seeds retain the same route across update schedules',()=>{
  const rng=()=>{let value=123;return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};};
  const routes=[];
  for(const step of [1,10,35]){
    const r=new RunnerController({random:rng()});r.start();const seen=new Map();
    for(let d=0;d<1000;d+=step){
      r.course.recycle(d);
      for(const o of r.course.active)seen.set(o.id,{id:o.id,kind:o.kind,hasRamp:o.hasRamp,lane:o.lane,frontDistance:o.frontDistance});
    }
    const list=[...seen.values()].sort((a,b)=>a.id-b.id);
    assert.equal(list.find(o=>o.kind==='train').hasRamp,true);routes.push(list.filter(o=>o.frontDistance<950));
  }
  assert.deepEqual(routes[0],routes[1]);assert.deepEqual(routes[0],routes[2]);
});

test('physics caps a stalled frame and remains stable at late-game speeds',()=>{
  const r=runner();r.update(10);close(r.elapsed,.25);
  r.elapsed=600;const o=train(r,r.distance+6);until(r,o.frontDistance+4,30);
  close(r.y,1.9,.001);assert.equal(r.lives,3);until(r,bodyStart(o)+3,30);close(r.y,3.8);
});

test('jumping from the upper slope can land on its roof without magnetic climbing',()=>{
  const r=runner(),o=train(r);until(r,11);assert.equal(r.input('jump'),true);
  tick(r,.4);assert.ok(r.y>3.8);tick(r,.55);
  assert.equal(r.lives,3);assert.equal(r.supportId,o.id);assert.equal(r.supportType,'roof');close(r.y,3.8);
});

test('pause on a roof freezes motion and returning to inspection clears terrain, speed and action state',()=>{
  const r=runner();train(r);until(r,16);r.input('jump');tick(r,.2);r.pause();
  const frozen=JSON.stringify(r);tick(r,3);assert.equal(JSON.stringify(r),frozen);
  r.inspect();assert.equal(r.mode,'inspect');assert.equal(r.course.active.length,0);assert.equal(r.supportId,null);
  assert.equal(r.supportType,'ground');assert.equal(r.grounded,true);close(r.verticalVelocity,0);close(r.y,0);close(r.speed,8.8);
  r.start();assert.equal(r.action,'Run');assert.equal(r.actionTime,0);assert.equal(r.lives,3);assert.equal(r.paused,false);
});

test('all slope positions jump safely at early/late speeds and normal/dropped frame rates',()=>{
  let scenarios=0;
  for(const elapsed of [0,30,120,600])for(const fraction of [.01,.10,.25,.50,.75,.95,.99])for(const fps of [30,60,120,4]){
    const r=runner();r.elapsed=elapsed;const o=train(r,r.distance+2);
    until(r,o.frontDistance+GAME.rampLength*fraction,fps);
    assert.equal(r.supportType,'ramp');assert.equal(r.input('jump'),true);
    const started=r.elapsed;
    for(let step=0;step<fps*1.1&&!r.grounded;step++){
      assert.equal(r.input('jump'),false);
      r.update(Math.min(1/fps,GAME.jumpSeconds-(r.elapsed-started)+.000001));
      const where=`time=${elapsed}, slope=${fraction}, fps=${fps}`;
      assert.equal(r.lives,3,where);assert.equal(o.hit,false,where);assert.equal(r.damageSerial,0,where);
      assert.equal(r.invincibleRemaining,0,where);
    }
    if(r.distance<=obstacleEnd(o)+GAME.playerDepth/2){
      assert.equal(r.grounded,true);assert.equal(r.supportId,o.id);close(r.elapsed-started,GAME.jumpSeconds,.00001);
    }else{
      assert.equal(r.jumpSourceId,null);tick(r,1);assert.equal(r.supportType,'ground');assert.equal(r.lives,3);
    }
    scenarios++;
  }
  assert.equal(scenarios,112);
});

test('slope jumps retain the normal relative height and duration across the roof seam',()=>{
  for(const elapsed of [0,30,120,600]){
    const r=runner();r.elapsed=elapsed;const o=train(r,r.distance+2);until(r,o.frontDistance+4);
    r.input('jump');assert.equal(r.supportId,null);assert.equal(r.jumpSourceId,o.id);
    tick(r,GAME.jumpSeconds/2);close(r.y-surfaceHeight(o,r.distance),GAME.jumpHeight);
    assert.equal(r.jumpSourceId,o.id);assert.equal(r.grounded,false);
    tick(r,GAME.jumpSeconds/2);assert.equal(r.jumpSourceId,null);
    if(r.distance<=obstacleEnd(o)+GAME.playerDepth/2){assert.equal(r.grounded,true);assert.equal(r.supportType,'roof');close(r.y,3.8);}
    else{assert.equal(r.grounded,false);tick(r,1);assert.equal(r.supportType,'ground');}
    assert.equal(r.lives,3);
  }
});

test('leaving a slope jump preserves height and drops the extra climbing velocity',()=>{
  const r=runner();r.elapsed=600;const o=train(r,r.distance+2);until(r,o.frontDistance+2);
  r.input('jump');tick(r,.06);r.input('right');let departed=false;
  // Lane changes now split at the actual support edge, so keep the slope's
  // contribution up to that instant and only then continue in free flight.
  const edge=(OBSTACLES.train.width+GAME.playerWidth)/2;
  const exitDelay=-Math.log((GAME.laneSpacing-edge)/(GAME.laneSpacing-r.x))/13;
  const exitAt=r.elapsed+exitDelay,exitAge=r.actionTime+exitDelay;
  const exitHeight=surfaceHeight(o,distanceAt(exitAt))+jumpVelocity*exitAge-.5*gravity*exitAge**2;
  for(let i=0;i<60&&!departed;i++){
    const source=r.jumpSourceId;r.update(GAME.physicsStep);
    if(source!==null&&r.jumpSourceId===null){
      const dt=r.elapsed-exitAt;
      close(r.y,exitHeight+(jumpVelocity-gravity*exitAge)*dt-.5*gravity*dt*dt);
      close(r.verticalVelocity,jumpVelocity-gravity*r.actionTime);departed=true;
    }
  }
  assert.equal(departed,true);assert.equal(r.grounded,false);assert.equal(r.input('jump'),false);
  tick(r,1.5);close(r.y,0);assert.equal(r.jumpSourceId,null);assert.equal(r.lives,3);assert.equal(o.hit,false);
});

test('a roof jump crossing the tail becomes free fall without retaining the takeoff train',()=>{
  const r=runner(),o=train(r);until(r,obstacleEnd(o)-.2);r.input('jump');tick(r,.1);
  assert.equal(r.jumpSourceId,null);assert.equal(r.grounded,false);assert.ok(r.y>3.8);
  tick(r,1.5);assert.equal(r.supportType,'ground');close(r.y,0);assert.equal(r.lives,3);assert.equal(o.hit,false);
});

test('consuming a train during its jump revokes provenance even when protected',()=>{
  const r=runner(),o=train(r);until(r,10);r.input('jump');tick(r,.2);
  const before=r.y,age=r.actionTime;r.protectedUntil=r.elapsed+1.5;r.course.touch(o,r.elapsed);
  r.update(GAME.physicsStep);
  assert.equal(r.jumpSourceId,null);assert.equal(r.supportId,null);assert.equal(r.grounded,false);
  close(r.y,before+(jumpVelocity-gravity*age)*GAME.physicsStep-.5*gravity*GAME.physicsStep**2);
  assert.equal(r.lives,3);tick(r,1.5);close(r.y,0);
});

test('leaving a ramp then re-entering the same train from below still deducts one life',()=>{
  const r=runner(),o=train(r);until(r,8.4);r.input('jump');r.input('left');tick(r,1.3);
  assert.equal(r.jumpSourceId,null);assert.equal(r.supportType,'ground');assert.equal(r.lives,3);
  r.input('right');tick(r,.25);assert.equal(r.lives,2);assert.equal(o.hit,true);assert.equal(r.damageSerial,1);
});

test('takeoff provenance is scoped to a verified top surface, not blanket train immunity',()=>{
  const o={id:1,kind:'train',lane:0,hasRamp:true,frontDistance:6,hit:false};
  const from={elapsed:0,distance:13.65,x:0,y:3.7,action:'Jump',actionTime:.01,jumpSourceId:1,supportId:null};
  const to={...from,elapsed:.01,distance:13.75,y:3.78};
  assert.equal(sweptContact(o,from,to),null,'Valid jump over its ramp-to-body seam');
  assert.equal(sweptContact({...o,id:2},from,to),null,'Clearance over a ramp seam must not depend on its ID');
  assert.notEqual(sweptContact(o,{...from,y:0},{...to,y:0}),null,'An ID alone cannot exempt a below-surface entry');
  assert.notEqual(sweptContact({...o,id:2},{...from,y:0},{...to,y:0}),null,'Other train bodies must still collide');
});

test('pause freezes takeoff state; landing, restart and inspection clear it',()=>{
  for(const reset of ['start','inspect']){
    const r=runner(),o=train(r);until(r,10);r.input('jump');tick(r,.1);assert.equal(r.jumpSourceId,o.id);
    r.pause();const frozen=JSON.stringify(r);tick(r,2);assert.equal(JSON.stringify(r),frozen);
    r[reset]();assert.equal(r.jumpSourceId,null);assert.equal(r.actionTime,0);assert.equal(r.grounded,true);
  }
});
