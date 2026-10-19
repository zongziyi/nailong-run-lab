import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunnerController} from '../src/controller.js';
import {GAME,OBSTACLES,distanceAt} from '../src/game-config.js';
import {surfaceAt,sweptContact} from '../src/collision.js';
import {coinContact} from '../src/coins.js';

function tick(r,seconds,fps=120){
  for(let t=0;t<seconds-1e-10;t+=1/fps)r.update(Math.min(1/fps,seconds-t));
}
function fixture(maxLives,elapsed,height){
  const r=new RunnerController({random:()=>.1});r.start({maxLives});
  r.course.clear();r.course.nextFrontDistance=Infinity;r.coins.clear();r.coinPlanner.clear();r.elapsed=elapsed;
  if(height){
    // Consecutive real roofs provide enough runway for a complete slide even
    // when late-game speed carries the runner farther than one train's length.
    const first=r.distance-1,end=distanceAt(elapsed+2);
    for(let front=first;front<end;front+=OBSTACLES.train.length){
      const o=r.course.record('train',0,0);Object.assign(o,{frontDistance:front,hasRamp:false});r.course.allocate(o);
    }
    r.land(surfaceAt(r.course.active[0],r.distance,r.x));
  }
  return r;
}
function overhead(r,frontDistance,height){
  const o=r.course.record('overhead',0,0);Object.assign(o,{frontDistance,baseHeight:height});return r.course.allocate(o);
}

test('ground and landing slides clear immediate and late overheads in both life modes and on roofs',()=>{
  for(const maxLives of [1,3])for(const elapsed of [0,600])for(const fps of [30,60,120,4])
    for(const height of [0,OBSTACLES.train.top])for(const dive of [false,true])for(const late of [false,true]){
      const r=fixture(maxLives,elapsed,height);
      if(dive){
        assert.equal(r.input('jump'),true);tick(r,.08,fps);assert.equal(r.input('slide'),true);
        while(!r.grounded)r.update(GAME.physicsStep);
        assert.equal(r.slideFromDive,true);
      }else assert.equal(r.input('slide'),true);
      const start=r.elapsed-r.actionTime;
      const front=late?distanceAt(start+GAME.slideSeconds-.01)-OBSTACLES.overhead.length-GAME.slidingDepth/2:
        r.distance+GAME.slidingDepth/2+.001;
      const hazard=overhead(r,front,height);
      tick(r,GAME.slideSeconds-r.actionTime+.02,fps);
      const where=JSON.stringify({maxLives,elapsed,fps,height,dive,late});
      assert.equal(r.lives,maxLives,where);assert.equal(r.gameOver,false,where);
      assert.equal(r.damageSerial,0,where);assert.equal(r.invincibleRemaining,0,where);
      assert.equal(hazard.hit,false,where);assert.equal(r.action,'Run',where);
    }
});

test('expiry and jump cancellation restore overhead damage; repeated down inputs do not extend a slide',()=>{
  for(const maxLives of [1,3])for(const elapsed of [0,600])for(const fps of [30,60,120,4]){
    const r=fixture(maxLives,elapsed,0);r.input('slide');
    const start=r.elapsed,serial=r.actionSerial;
    const hazard=overhead(r,distanceAt(start+GAME.slideSeconds),0);
    tick(r,.4,fps);const age=r.actionTime;
    assert.equal(r.input('slide'),false);assert.equal(r.actionTime,age);assert.equal(r.actionSerial,serial);
    tick(r,.44,fps);assert.equal(r.lives,maxLives);
    tick(r,.06,fps);assert.equal(r.lives,maxLives-1);assert.equal(r.damageSerial,1);assert.equal(hazard.hit,true);
    assert.equal(r.gameOver,maxLives===1);

    for(const age of [.05,.4,.83]){
      const jump=fixture(maxLives,elapsed,0);jump.input('slide');tick(jump,age,fps);
      const bar=overhead(jump,jump.distance,0);assert.equal(jump.input('jump'),true);
      jump.update(GAME.physicsStep);
      assert.equal(jump.lives,maxLives-1);assert.equal(jump.damageSerial,1);assert.equal(bar.hit,true);
    }
  }
});

test('coin pickups and overhead collisions share the full low stance, including entry and recovery',()=>{
  for(const height of [0,OBSTACLES.train.top])for(const slideFromDive of [false,true])for(const age of [0,.05,.3,.75,.849]){
    const from={elapsed:0,distance:10,x:0,y:height,action:'Slide',actionTime:age,slideFromDive};
    const to={...from,elapsed:.0001,actionTime:age+.0001};
    const bar={id:1,kind:'overhead',lane:0,frontDistance:10,baseHeight:height,hit:false};
    assert.equal(sweptContact(bar,from,to),null);
    assert.equal(coinContact({x:0,y:height+2,distance:10},from,to),null,'Low stance cannot collect a standing-height coin');
    assert.notEqual(coinContact({x:0,y:height+.55,distance:10.8},from,to),null,'The extended slide depth also applies immediately');
  }
  for(const action of ['Run','Jump','Dive']){
    const from={elapsed:0,distance:10,x:0,y:0,action,actionTime:0,slideFromDive:true};
    assert.notEqual(coinContact({x:0,y:2,distance:10},from,from),null);
    assert.equal(coinContact({x:0,y:.55,distance:10.8},from,from),null);
  }
});
