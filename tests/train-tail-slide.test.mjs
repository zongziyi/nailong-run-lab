import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunnerController} from '../src/controller.js';
import {GAME,OBSTACLES,timeAtDistance} from '../src/game-config.js';
import {obstacleEnd,surfaceAt,sweptContact} from '../src/obstacles.js';

function tick(r,seconds,fps){
  for(let t=0;t<seconds-1e-10;t+=1/fps)r.update(Math.min(1/fps,seconds-t));
}

for(const dive of [false,true]){
  test(`${dive?'jump into a landing slide':'slide directly'} off a train tail without damage`,()=>{
    for(const maxLives of [1,3])for(const elapsed of [0,120,600])for(const fps of [30,60,120,4]){
      const r=new RunnerController({random:()=>.1});r.start({maxLives});
      r.course.clear();r.course.nextFrontDistance=Infinity;r.elapsed=elapsed;
      const o=r.course.record('train',0,0);
      Object.assign(o,{frontDistance:r.distance+6,hasRamp:true});
      const train=r.course.allocate(o),tail=obstacleEnd(train);
      tick(r,timeAtDistance(tail-r.speed*.25)-r.elapsed,fps);
      const where=`lives=${maxLives}, elapsed=${elapsed}, fps=${fps}, dive=${dive}`;
      assert.equal(r.supportId,train.id,where);
      if(dive){
        assert.equal(r.input('jump'),true,where);tick(r,.08,fps);
        assert.equal(r.input('slide'),true,where);tick(r,.08,fps);
        assert.equal(r.supportId,train.id,where);
        assert.equal(r.action,'Slide',where);assert.equal(r.slideFromDive,true,where);
      }else assert.equal(r.input('slide'),true,where);

      tick(r,timeAtDistance(tail+GAME.playerDepth/2+.08)-r.elapsed,fps);
      assert.equal(r.lives,maxLives,where);assert.equal(r.gameOver,false,where);
      assert.equal(train.hit,false,where);assert.equal(r.damageSerial,0,where);
      assert.equal(r.invincibleRemaining,0,where);
      assert.equal(r.action,'Slide',where);assert.equal(r.grounded,false,where);
      assert.equal(r.supportId,null,where);assert.equal(r.supportType,'air',where);
      assert.ok(r.y>0&&r.y<OBSTACLES.train.top,where);

      tick(r,1.2,fps);
      assert.equal(r.lives,maxLives,where);assert.equal(r.gameOver,false,where);
      assert.equal(train.hit,false,where);assert.equal(r.damageSerial,0,where);
      assert.equal(r.invincibleRemaining,0,where);
      assert.equal(r.y,0,where);assert.equal(r.grounded,true,where);
      assert.equal(r.supportType,'ground',where);assert.equal(r.action,'Run',where);
    }
  });
}

test('train tail collision ends at its support boundary throughout slide entry, hold and recovery',()=>{
  for(const hasRamp of [false,true])for(const slideFromDive of [false,true])for(const actionTime of [.05,.3,.75]){
    const train={id:1,kind:'train',lane:0,frontDistance:6,hasRamp,hit:false};
    const edge=obstacleEnd(train)+GAME.playerDepth/2;
    const state=distance=>({elapsed:0,distance,x:0,y:OBSTACLES.train.top-.1,
      action:'Slide',actionTime,slideFromDive,supportId:null,jumpSourceId:null});
    const contact=(o,distance)=>{
      const from=state(distance);return sweptContact(o,from,{...from,elapsed:.001,actionTime:actionTime+.001});
    };
    assert.notEqual(surfaceAt(train,edge-.0001,0),null);
    assert.equal(surfaceAt(train,edge+.0001,0),null);
    assert.notEqual(contact(train,edge-.0001),null,'Below-roof contact inside the tail still hits');
    assert.equal(contact(train,edge+.0001),null,'Falling beyond the support edge cannot hit the old tail');

    if(actionTime===.3){
      const oncoming={...train,kind:'oncoming',hasRamp:false,motionSpeed:GAME.oncomingSpeed,arrivalTime:0};
      assert.notEqual(contact(oncoming,obstacleEnd(oncoming)+GAME.playerDepth/2+.0001),null,
        'Oncoming trains retain the extended slide collider');
    }
  }
});
