import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunnerController} from '../src/controller.js';
import {GAME} from '../src/game-config.js';
const step=(r,n=100)=>{for(let i=0;i<n;i++)r.update(1/60);};
test('lane limits, airborne lane changing, no double jump, and slide jump cancellation',()=>{
  const r=new RunnerController();r.start();
  assert.equal(r.input('jump'),true);assert.equal(r.input('jump'),false);
  r.input('left');r.input('left');assert.equal(r.lane,-1);step(r,12);assert.ok(r.y>0);assert.ok(r.x<0);
  step(r);assert.equal(r.action,'Run');assert.equal(r.y,0);
  r.input('right');r.input('right');r.input('right');assert.equal(r.lane,1);
  assert.equal(r.input('slide'),true);assert.equal(r.input('jump'),true);step(r);assert.equal(r.action,'Run');
});
test('pause freezes position/action time and reset clears all transient state',()=>{
  const r=new RunnerController();r.start();r.input('jump');step(r,10);r.pause();const snapshot=JSON.stringify(r);step(r);assert.equal(JSON.stringify(r),snapshot);assert.equal(r.input('right'),false);
  r.togglePause();step(r);assert.equal(r.action,'Run');r.start();assert.equal(r.lane,0);assert.equal(r.x,0);assert.equal(r.y,0);assert.equal(r.paused,false);assert.equal(r.action,'Run');
  r.inspect();assert.equal(r.action,'Idle');assert.equal(r.input('jump'),false);
});

test('new controllers default to three lives and reject unsupported modes without resetting a run',()=>{
  const r=new RunnerController({random:()=>.1});
  assert.equal(r.maxLives,3);assert.equal(r.lives,3);
  r.start();assert.equal(r.maxLives,3);assert.equal(r.lives,3);
  const before=JSON.stringify(r);
  for(const maxLives of [0,2,4,'1',null])assert.throws(()=>r.start({maxLives}),RangeError);
  assert.equal(JSON.stringify(r),before);
});

for(const maxLives of [1,3])test(`${maxLives}-life mode ends on its final hit and restarts with the same mode`,()=>{
  const r=new RunnerController({random:()=>.1});r.start({maxLives});
  r.course.clear();r.course.nextFrontDistance=Infinity;
  assert.equal(r.maxLives,maxLives);assert.equal(r.lives,maxLives);
  for(let hit=1;hit<=maxLives;hit++){
    const obstacle=r.course.record('barrier',0,r.elapsed);
    obstacle.frontDistance=r.distance+GAME.playerDepth/2;
    r.course.allocate(obstacle);r.update(1/60);
    assert.equal(r.lives,maxLives-hit);assert.equal(r.damageSerial,hit);
    assert.equal(r.gameOver,hit===maxLives);
    if(!r.gameOver)step(r,100);
  }
  const frozen=JSON.stringify(r);step(r);
  assert.equal(JSON.stringify(r),frozen);assert.equal(r.input('left'),false);
  r.start();
  assert.equal(r.maxLives,maxLives);assert.equal(r.lives,maxLives);assert.equal(r.gameOver,false);
  assert.equal(r.distance,0);assert.equal(r.invincibleRemaining,0);assert.equal(r.damageSerial,0);
  r.input('jump');r.pause();r.start();
  assert.equal(r.maxLives,maxLives);assert.equal(r.lives,maxLives);assert.equal(r.paused,false);
  assert.equal(r.action,'Run');assert.equal(r.y,0);
});

test('inspection retains the selected mode and the next start can switch it in either direction',()=>{
  const r=new RunnerController({random:()=>.1});
  for(const maxLives of [1,3,1]){
    r.start({maxLives});r.inspect();
    assert.equal(r.mode,'inspect');assert.equal(r.maxLives,maxLives);assert.equal(r.lives,maxLives);
    assert.equal(r.course.active.length,0);
    r.start();assert.equal(r.maxLives,maxLives);assert.equal(r.lives,maxLives);
    r.inspect();
  }
});
