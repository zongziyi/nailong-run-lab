import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RunnerAnimation} from '../src/runner-animation.js';
import {GAME,distanceAt} from '../src/game-config.js';

function fixture(){
  const root=new THREE.Group(),bone=new THREE.Bone();bone.name='Root';root.add(bone);
  const face=new THREE.Object3D();face.name='Face';face.morphTargetInfluences=[0];root.add(face);
  const clips=[['Idle',2,0],['Run',.8,.2],['Jump',.9,.6],['Slide',.85,-1.4],['Laugh',.85,.8]].map(([name,duration,angle])=>{
    const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(angle,0,0));
    return new THREE.AnimationClip(name,duration,[
      new THREE.VectorKeyframeTrack('Root.position',[0,duration/2,duration],[0,0,0,0,angle*.1,0,0,0,0]),
      new THREE.QuaternionKeyframeTrack('Root.quaternion',[0,duration/2,duration],[0,0,0,1,...quaternion.toArray(),0,0,0,1]),
      new THREE.VectorKeyframeTrack('Root.scale',[0,duration],[1,1,1,1,1,1]),
    ]);
  });
  clips.find(clip=>clip.name==='Laugh').tracks.push(new THREE.NumberKeyframeTrack('Face.morphTargetInfluences',[0,.16,.67,.85],[0,1,1,0]));
  const animator=new RunnerAnimation(root,clips),state={action:'Run',actionSerial:0,actionTime:0,distance:0};
  animator.reset(state);return {root,bone,face,animator,state};
}
const pose=b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function same(a,b){a.forEach((v,i)=>close(v,b[i]));}

test('interrupted Slide -> Jump -> Dive -> landing Slide starts from the displayed pose',()=>{
  const {bone,animator,state}=fixture();state.distance=2;animator.update(state,.2);
  for(const [action,time,landed] of [['Slide',.4,false],['Jump',.02,false],['Dive',.01,false],['Slide',0,true],['Jump',0,false]]){
    const before=pose(bone);Object.assign(state,{action,actionTime:time,slideFromDive:landed,actionSerial:state.actionSerial+1});
    animator.update(state,0);same(pose(bone),before);
    animator.update(state,.035);assert.ok(pose(bone).every(Number.isFinite));
  }
  animator.update(state,.1);
  assert.equal(animator.mixer.stats.actions.inUse,1);
  assert.equal(animator.actions.Jump.timeScale,1);
});

test('Dive holds the jump tuck, landing slide samples its hold, and elapsed slide time stays untouched',()=>{
  const {bone,animator,state}=fixture();Object.assign(state,{action:'Dive',actionSerial:1,actionTime:.3});
  animator.update(state,.1);close(animator.actions.Jump.time,.45);const tuck=pose(bone);
  state.actionTime=2;animator.update(state,.3);same(pose(bone),tuck);
  Object.assign(state,{action:'Slide',actionSerial:2,actionTime:0,slideFromDive:true});animator.update(state,.1);
  close(animator.actions.Slide.time,GAME.slidePoseHoldStart);assert.equal(state.actionTime,0);
  state.actionTime=.76;animator.update(state,.76);close(animator.actions.Slide.time,.76);
});

test('constant clip tracks reach their authored target after a partial interrupted blend',()=>{
  const {bone,animator,state}=fixture(),reference=fixture();
  Object.assign(state,{action:'Slide',actionSerial:1,actionTime:.4});animator.update(state,.035);
  Object.assign(state,{action:'Dive',actionSerial:2,actionTime:0});animator.update(state,0);
  animator.update(state,.035);animator.update(state,.035);animator.update(state,.035);
  reference.animator.reset(state);same(pose(bone),pose(reference.bone));
  Object.assign(state,{action:'Slide',actionSerial:3,actionTime:0,slideFromDive:true});animator.update(state,0);
  animator.update(state,.035);animator.update(state,.035);animator.update(state,.035);
  reference.animator.reset(state);same(pose(bone),pose(reference.bone));
});

test('pause and game-over frames freeze the pose and transitions; reset clears the blend',()=>{
  const {bone,animator,state}=fixture();Object.assign(state,{action:'Slide',actionSerial:1,actionTime:.25});animator.update(state,.04);
  const before=pose(bone),time=animator.blendTime;state.paused=true;animator.update(state,1);
  same(pose(bone),before);assert.equal(animator.blendTime,time);
  state.paused=false;state.gameOver=true;animator.update(state,0);same(pose(bone),before);
  Object.assign(state,{gameOver:false,action:'Run',actionSerial:0,actionTime:0,distance:0});animator.reset(state);
  same(pose(bone),[0,0,0,0,0,0,1,1,1,1]);assert.equal(animator.blendTime,GAME.actionBlendSeconds);
});

test('running phase follows traveled distance across interruptions and frame rates',()=>{
  const samples=[];
  for(const fps of [30,60,120,4]){
    const {bone,animator,state}=fixture();
    for(let i=1;i<=fps;i++){state.distance=distanceAt(i/fps);animator.update(state,1/fps);}
    samples.push(pose(bone));
    Object.assign(state,{action:'Jump',actionSerial:1,actionTime:.2});animator.update(state,.2);
    Object.assign(state,{action:'Run',actionSerial:2,distance:distanceAt(1.2)});animator.update(state,.1);
    close(animator.actions.Run.time,(distanceAt(1.2)/GAME.speed)%.8);
  }
  for(const sample of samples)same(sample,samples[0]);
});

test('a landing at the end of a dropped frame only ages the blend by grounded time',()=>{
  const {animator,state}=fixture();Object.assign(state,{action:'Dive',actionSerial:1,actionTime:.2,elapsed:.7});animator.update(state,.2);
  Object.assign(state,{action:'Slide',actionSerial:2,actionTime:.012,slideFromDive:true,elapsed:.95});animator.update(state,.25);
  close(animator.blendTime,.012);
});

test('ground slide selects Laugh, while an airborne dive and its landing retain the original clips',()=>{
  const {animator,state}=fixture();
  Object.assign(state,{action:'Slide',actionSerial:1,actionTime:.3,slideFromDive:false});animator.update(state,.1);
  assert.equal(animator.activeClip,'Laugh');
  Object.assign(state,{action:'Dive',actionSerial:2,actionTime:.05});animator.update(state,.1);
  assert.equal(animator.activeClip,'Jump');
  Object.assign(state,{action:'Slide',actionSerial:3,actionTime:0,slideFromDive:true});animator.update(state,.1);
  assert.equal(animator.activeClip,'Slide');close(animator.actions.Slide.time,GAME.slidePoseHoldStart);
});

test('laugh expression blends from the displayed face and clears on interruption, pause and reset',()=>{
  const {face,animator,state}=fixture();
  Object.assign(state,{action:'Slide',actionSerial:1,actionTime:.3});animator.update(state,.1);
  close(face.morphTargetInfluences[0],1);
  Object.assign(state,{action:'Jump',actionSerial:2,actionTime:0});animator.update(state,0);
  close(face.morphTargetInfluences[0],1);
  animator.update(state,.035);const partial=face.morphTargetInfluences[0];assert.ok(partial>0&&partial<1);
  state.paused=true;animator.update(state,1);close(face.morphTargetInfluences[0],partial);
  state.paused=false;animator.update(state,.1);close(face.morphTargetInfluences[0],0);
  Object.assign(state,{action:'Slide',actionSerial:3,actionTime:.4});animator.update(state,.1);close(face.morphTargetInfluences[0],1);
  Object.assign(state,{action:'Run',actionSerial:0,actionTime:0});animator.reset(state);close(face.morphTargetInfluences[0],0);
});
