import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunnerController} from '../src/controller.js';
import {GAME,gravity,jumpVelocity,distanceAt,timeAtDistance} from '../src/game-config.js';
import {surfaceHeight,obstacleEnd,sweptContact} from '../src/obstacles.js';

const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function runner(){const r=new RunnerController({random:()=>.1});r.start();r.course.clear();r.course.nextFrontDistance=Infinity;return r;}
function tick(r,seconds,fps=120){for(let t=0;t<seconds-1e-10;t+=1/fps)r.update(Math.min(1/fps,seconds-t));}
function train(r,front=6,lane=0,hasRamp=true){
  const o=r.course.record('train',lane,0);Object.assign(o,{frontDistance:front,hasRamp});return r.course.allocate(o);
}
function until(r,distance,fps=120){tick(r,timeAtDistance(distance)-r.elapsed,fps);}

test('slide entry, hold, and recovery cancel immediately into a full normal jump',()=>{
  for(const age of [.03,.40,.78]){
    const r=runner();assert.equal(r.input('slide'),true);tick(r,age);
    const start=r.elapsed;assert.equal(r.input('jump'),true);
    assert.equal(r.action,'Jump');assert.equal(r.actionTime,0);assert.equal(r.slideFromDive,false);
    close(r.y,0);close(r.verticalVelocity,jumpVelocity);assert.equal(r.input('jump'),false);
    tick(r,GAME.jumpSeconds/2);close(r.y,GAME.jumpHeight);
    tick(r,GAME.jumpSeconds/2);assert.equal(r.action,'Run');assert.equal(r.grounded,true);close(r.y,0);
    close(r.elapsed-start,GAME.jumpSeconds);assert.equal(r.lives,3);
  }
});

test('ascent, apex and descent dives preserve height and have no double jump or repeat reset',()=>{
  for(const age of [.08,.45,.78]){
    const r=runner();r.input('jump');tick(r,age);const height=r.y;
    assert.equal(r.input('slide'),true);assert.equal(r.action,'Dive');close(r.y,height);
    assert.ok(r.verticalVelocity<=-GAME.diveSpeed);assert.equal(r.jumpSourceId,null);
    tick(r,.01);assert.ok(r.y<height);const before=r.collisionState(),serial=r.actionSerial;
    assert.equal(r.input('slide'),false);assert.equal(r.input('jump'),false);
    assert.deepEqual(r.collisionState(),before);assert.equal(r.actionSerial,serial);
    assert.equal(r.input('left'),true);assert.equal(r.input('right'),true);
  }
});

test('dive landing splits the frame and starts a complete slide with only grounded time',()=>{
  for(const fps of [30,60,120,4]){
    const r=runner();r.input('jump');tick(r,.45,fps);r.input('slide');
    const started=r.elapsed,a=gravity*GAME.diveGravityScale;
    const fallSeconds=(-GAME.diveSpeed+Math.sqrt(GAME.diveSpeed**2+2*a*r.y))/a;
    tick(r,fallSeconds+.023,fps);
    assert.equal(r.action,'Slide');assert.equal(r.slideFromDive,true);assert.equal(r.grounded,true);
    close(r.y,0);close(r.actionTime,.023);close(r.elapsed-started,fallSeconds+.023);
    tick(r,GAME.slideSeconds-.024,fps);assert.equal(r.action,'Slide');
    tick(r,.002,fps);assert.equal(r.action,'Run');assert.equal(r.slideFromDive,false);assert.equal(r.lives,3);
  }
});

test('a complete chain can jump out of its landing slide without accumulating jump height',()=>{
  const r=runner();r.input('slide');tick(r,.3);r.input('jump');tick(r,.2);r.input('slide');tick(r,.25);
  assert.equal(r.action,'Slide');assert.equal(r.slideFromDive,true);assert.equal(r.input('jump'),true);
  assert.equal(r.slideFromDive,false);tick(r,.45);close(r.y,GAME.jumpHeight);
  assert.equal(r.input('jump'),false);tick(r,.45);close(r.y,0);
  const instant=runner();instant.input('jump');instant.input('slide');instant.update(.02);
  assert.equal(instant.action,'Slide');assert.equal(instant.slideFromDive,true);close(instant.actionTime,.02);
});

test('slope and roof slide jumps and dives retain continuous height across speeds and frame rates',()=>{
  for(const elapsed of [0,120,600])for(const offset of [1,4,7.8,10])for(const fps of [30,60,120,4]){
    const r=runner();r.elapsed=elapsed;const o=train(r,r.distance+2);until(r,o.frontDistance+offset,fps);
    r.input('slide');tick(r,.025,fps);const height=r.y;
    assert.equal(r.input('jump'),true);close(r.y,height);assert.equal(r.jumpSourceId,o.id);
    tick(r,.08,fps);const airborne=r.y;assert.equal(r.input('slide'),true);
    close(r.y,airborne);assert.equal(r.jumpSourceId,null);tick(r,.08,fps);
    assert.equal(r.grounded,true);assert.equal(r.action,'Slide');assert.equal(r.slideFromDive,true);
    assert.equal(r.supportId,o.id);close(r.y,surfaceHeight(o,r.distance));assert.equal(r.lives,3);
  }
});

test('a dive may land on an adjacent roof, while leaving a roof edge lands on ground',()=>{
  const r=runner(),source=train(r),adjacent=train(r,6,1,false);until(r,17);
  r.input('jump');r.input('right');tick(r,.42);r.input('slide');tick(r,.25);
  assert.equal(r.supportId,adjacent.id);assert.equal(r.action,'Slide');assert.equal(r.slideFromDive,true);
  close(r.y,3.8);assert.equal(r.lives,3);assert.equal(source.hit,false);
  const falling=runner(),o=train(falling);until(falling,obstacleEnd(o)+.4);
  assert.equal(falling.grounded,false);const height=falling.y;assert.equal(falling.input('slide'),true);
  close(falling.y,height);tick(falling,.4);close(falling.y,0);assert.equal(falling.action,'Slide');
  assert.equal(falling.supportType,'ground');assert.equal(falling.lives,3);
});

test('diving into a train from below or into an oncoming train still causes damage',()=>{
  for(const kind of ['train','oncoming']){
    const r=runner(),o=r.course.record(kind,0,0);Object.assign(o,{frontDistance:3,hasRamp:false,motionSpeed:0});const placed=r.course.allocate(o);
    r.input('jump');tick(r,.18);r.input('slide');tick(r,.3);
    assert.equal(r.lives,2);assert.equal(r.damageSerial,1);assert.equal(placed.hit,true);
  }
});

test('airborne dives use standing collision; landing slides have their own short entry window',()=>{
  const o={id:1,kind:'overhead',lane:0,frontDistance:10,hit:false};
  const at=(action,actionTime,slideFromDive=false)=>({action,actionTime,slideFromDive,elapsed:0,distance:10,x:0,y:0});
  const contact=s=>sweptContact(o,s,{...s,elapsed:.01,actionTime:s.actionTime+.01,distance:10.01});
  assert.notEqual(contact(at('Dive',.4)),null);
  assert.notEqual(contact(at('Slide',.11)),null);
  assert.notEqual(contact(at('Slide',.05,true)),null);
  assert.equal(contact(at('Slide',.11,true)),null);
  assert.notEqual(contact(at('Slide',.66,true)),null);
  // A jump cancellation must not inherit the low collider from its old slide.
  assert.notEqual(contact(at('Jump',0,true)),null);
});

test('pause, reset, inspection and game over freeze or clear every chain state',()=>{
  const r=runner();r.input('jump');tick(r,.2);r.input('slide');r.pause();
  const frozen=JSON.stringify(r);tick(r,1);assert.equal(JSON.stringify(r),frozen);
  for(const input of ['jump','slide','right'])assert.equal(r.input(input),false);
  r.togglePause();tick(r,.3);assert.equal(r.slideFromDive,true);
  for(const reset of ['start','inspect']){
    r[reset]();assert.equal(r.actionTime,0);assert.equal(r.slideFromDive,false);assert.equal(r.jumpSourceId,null);close(r.y,0);
  }
  r.start({maxLives:1});r.course.clear();r.course.nextFrontDistance=Infinity;
  r.input('jump');tick(r,.2);r.input('slide');
  const o=r.course.record('oncoming',0,0);o.frontDistance=r.distance+GAME.playerDepth/2;r.course.allocate(o);
  r.update(.02);assert.equal(r.gameOver,true);const ended=JSON.stringify(r);tick(r,1);
  assert.equal(JSON.stringify(r),ended);assert.equal(r.input('slide'),false);assert.equal(r.input('jump'),false);
});
