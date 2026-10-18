import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunnerController} from '../src/controller.js';
import {GAME,distanceAt,timeAtDistance,gravity} from '../src/game-config.js';
import {surfaceHeight,sweptContact} from '../src/obstacles.js';

const close=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function runner(maxLives=3){
  const r=new RunnerController({random:()=>.1});r.start({maxLives});
  r.course.clear();r.course.nextFrontDistance=Infinity;return r;
}
function train(r,frontDistance,lane=0,hasRamp=true){
  const o=r.course.record('train',lane,0);Object.assign(o,{frontDistance,hasRamp});return r.course.allocate(o);
}
function tick(r,seconds,fps=120){for(let t=0;t<seconds-1e-10;t+=1/fps)r.update(Math.min(1/fps,seconds-t));}
function until(r,distance,fps=120){tick(r,timeAtDistance(distance)-r.elapsed,fps);}

test('late roof transfers across an offset ramp seam cause no damage in either life mode',()=>{
  for(const maxLives of [1,3])for(const direction of [-1,1])for(const fps of [30,60,120,4]){
    const r=runner(maxLives),source=train(r,2),target=train(r,18,direction);
    until(r,17,fps);assert.equal(r.supportId,source.id);
    r.input('jump');tick(r,.84,fps);r.input(direction<0?'left':'right');tick(r,.4,fps);
    const where=`lives=${maxLives}, direction=${direction}, fps=${fps}`;
    assert.equal(r.gameOver,false,where);assert.equal(r.lives,maxLives,where);
    assert.equal(r.damageSerial,0,where);assert.equal(r.invincibleRemaining,0,where);
    assert.equal(source.hit,false,where);assert.equal(target.hit,false,where);
    assert.equal(r.supportId,target.id,where);assert.equal(r.supportType,'roof',where);
    assert.equal(r.jumpSourceId,null,where);close(r.y,3.8);
  }
});

test('the ramp-to-roof seam has no invisible wall above its walkable surface',()=>{
  const o={id:2,kind:'train',lane:0,hasRamp:true,frontDistance:18,hit:false};
  const from={elapsed:0,distance:25.65,x:0,y:3.76,action:'Jump',actionTime:.6,supportId:null,jumpSourceId:null};
  const to={...from,elapsed:.008,distance:25.75,y:3.74};
  assert.ok(from.y>surfaceHeight(o,from.distance));assert.ok(to.y>surfaceHeight(o,to.distance));
  assert.equal(sweptContact(o,from,to),null);
  assert.notEqual(sweptContact(o,{...from,y:3},{...to,y:3}),null,'Below-slope entries must still hit');
  assert.notEqual(sweptContact({...o,hasRamp:false},from,to),null,'A flat train still has a solid side');
  assert.notEqual(sweptContact({...o,kind:'oncoming',hasRamp:false},from,to),null);
});

test('a rising character can land when the target slope overtakes its feet from below',()=>{
  for(const fps of [30,60,120,4]){
    const r=runner(1),target=train(r,2);r.elapsed=timeAtDistance(6);
    Object.assign(r,{y:1.91,grounded:false,supportType:'air',action:'Jump',actionTime:.2,verticalVelocity:2});
    const started=r.elapsed,land=r.land.bind(r);let landedAt=null;
    r.land=surface=>{if(!r.grounded&&surface?.id===target.id)landedAt=r.elapsed;land(surface);};
    tick(r,.02,fps);
    assert.equal(r.lives,1);assert.equal(r.gameOver,false);assert.equal(target.hit,false);
    assert.equal(r.supportId,target.id);assert.equal(r.jumpSourceId,null);
    assert.ok(landedAt>started&&landedAt<started+GAME.physicsStep,'Split at the actual relative crossing');
    close(r.y,surfaceHeight(target,r.distance));
  }
});

test('landing selects the earliest valid top crossing independently of obstacle order',()=>{
  for(const reverse of [false,true]){
    const r=runner(1);train(r,2);const roof=train(r,2,0,false);
    if(reverse)r.course.active.reverse();r.elapsed=timeAtDistance(7);
    Object.assign(r,{y:3.9,grounded:false,supportType:'air',action:'Jump',actionTime:.6,verticalVelocity:-1});
    const started=r.elapsed,land=r.land.bind(r);let landedAt=null;
    r.land=surface=>{if(!r.grounded)landedAt=r.elapsed;land(surface);};
    tick(r,.08);
    const fallSeconds=(-1+Math.sqrt(1+2*gravity*.1))/gravity;
    close(landedAt-started,fallSeconds);assert.equal(r.supportId,roof.id);assert.equal(r.lives,1);
  }
});

test('crossing below a roof before entering its lane still hits the side',()=>{
  const r=runner(1),target=train(r,2,1,false);r.elapsed=timeAtDistance(7);
  const edge=GAME.laneSpacing-(GAME.playerWidth+1.8)/2;
  Object.assign(r,{lane:1,x:edge-.02,y:3.801,grounded:false,supportType:'air',
    action:'Jump',actionTime:.6,verticalVelocity:-1});
  tick(r,.02);
  assert.equal(r.lives,0);assert.equal(r.gameOver,true);assert.equal(target.hit,true);
  assert.equal(r.supportId,null);
});

test('aligned and offset transfers retain support across speeds, jumps, dives and frame schedules',()=>{
  for(const elapsed of [0,120,600])for(const offset of [0,8])for(const direction of [-1,1])
    for(const dive of [false,true])for(const fps of [30,60,120,4]){
      // At the highest speed a full jump passes an aligned train tail; use a
      // dive for that layout rather than pretending there is still a roof.
      if(elapsed===600&&offset===0&&!dive)continue;
      const r=runner(1);r.elapsed=elapsed;const front=r.distance+2;
      const source=train(r,front),target=train(r,front+offset,direction);
      until(r,front+8.2,fps);const started=r.elapsed;
      r.input('jump');r.input(direction<0?'left':'right');
      if(dive){tick(r,.42,fps);r.input('slide');}
      tick(r,(dive?.65:.92)-(r.elapsed-started),fps);
      const where=`elapsed=${elapsed}, offset=${offset}, direction=${direction}, dive=${dive}, fps=${fps}`;
      assert.equal(r.lives,1,where);assert.equal(r.gameOver,false,where);assert.equal(r.damageSerial,0,where);
      assert.equal(source.hit,false,where);assert.equal(target.hit,false,where);
      assert.equal(r.supportId,target.id,where);assert.equal(r.jumpSourceId,null,where);
      assert.equal(r.action,dive?'Slide':'Run',where);close(r.y,surfaceHeight(target,r.distance));
    }
});

test('a roof hazard at the destination still damages a transferring runner',()=>{
  for(const kind of ['barrier','overhead']){
    const r=runner(1);train(r,2);const target=train(r,2,1);until(r,10.2);
    const front=distanceAt(r.elapsed+1.05),hazard=r.course.record(kind,1,0);
    Object.assign(hazard,{frontDistance:front,baseHeight:3.8,parentId:target.id});const placed=r.course.allocate(hazard);
    r.input('jump');r.input('right');tick(r,1.2);
    assert.equal(r.lives,0);assert.equal(r.gameOver,true);assert.equal(r.lastDamageKind,kind);
    assert.equal(placed.hit,true);assert.equal(target.hit,false);
  }
});
