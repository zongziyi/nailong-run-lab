import * as THREE from 'three';
import {GAME} from './game-config.js';
import {ANIMATION_CONTACTS} from './animation-contacts.js';

// Sample one clip at the simulation's time, then blend from the last displayed
// pose. Interrupted transitions therefore never resurrect an older clip/weight.
export class RunnerAnimation {
  constructor(root,clips){
    this.root=root;this.baseHeight=root.position.y;this.contacts=[];
    root.traverse(node=>{if(node.isSkinnedMesh&&ANIMATION_CONTACTS[node.name])this.contacts.push({mesh:node,indices:ANIMATION_CONTACTS[node.name]});});
    this.contactPoint=new THREE.Vector3();this.contactMatrix=new THREE.Matrix4();this.parentInverse=new THREE.Matrix4();
    this.mixer=new THREE.AnimationMixer(root);this.actions={};
    const nodes=new Set();
    for(const clip of clips){
      const action=this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;
      this.actions[clip.name]=action;
      for(const track of clip.tracks){
        const {nodeName}=THREE.PropertyBinding.parseTrackName(track.name);
        const node=THREE.PropertyBinding.findNode(root,nodeName);
        if(node)nodes.add(node);
      }
    }
    for(const name of ['Idle','Run','Jump','Slide','Laugh'])if(!this.actions[name])throw new Error(`模型缺少 ${name} 动作`);
    this.poses=[...nodes].map(node=>({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone(),
      targetPosition:node.position.clone(),targetQuaternion:node.quaternion.clone(),targetScale:node.scale.clone()}));
    this.expressions=[];
    root.traverse(node=>{
      if(node.morphTargetInfluences)this.expressions.push({node,from:[...node.morphTargetInfluences],target:[...node.morphTargetInfluences]});
    });
    this.resetState();
  }
  resetState(){this.action=null;this.serial=null;this.activeClip=null;this.blendTime=GAME.actionBlendSeconds;this.idleTime=0;}
  reset(state){this.mixer.stopAllAction();this.resetState();this.update(state,0,true);}
  update(state,dt,immediate=false){
    if(!immediate&&(state.paused||(state.gameOver&&dt<=0)))return;
    dt=Math.max(0,dt);
    if(state.action==='Idle')this.idleTime+=dt;
    const changed=this.action!==state.action||this.serial!==state.actionSerial;
    if(changed){
      for(const pose of this.poses){
        pose.position.copy(pose.node.position);pose.quaternion.copy(pose.node.quaternion);pose.scale.copy(pose.node.scale);
      }
      for(const expression of this.expressions)expression.from=[...expression.node.morphTargetInfluences];
      this.action=state.action;this.serial=state.actionSerial;
      this.blendTime=immediate?GAME.actionBlendSeconds:0;
    }
    const name=state.action==='Dive'?'Jump':state.action==='Slide'&&!state.slideFromDive?'Laugh':state.action;
    const action=this.actions[name],duration=action.getClip().duration;
    if(this.activeClip!==name){
      this.mixer.stopAllAction();action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();this.activeClip=name;
    }else{
      // Three's PropertyMixer skips unchanged tracks. Restore the raw sample,
      // otherwise our displayed blend would feed back into a constant target.
      for(const pose of this.poses){
        pose.node.position.copy(pose.targetPosition);pose.node.quaternion.copy(pose.targetQuaternion);pose.node.scale.copy(pose.targetScale);
      }
      for(const expression of this.expressions)expression.node.morphTargetInfluences.splice(0,expression.target.length,...expression.target);
    }
    // Clips without expression tracks target the neutral face explicitly. The
    // displayed transition below still begins at the last visible expression.
    if(name!=='Laugh')for(const expression of this.expressions)expression.node.morphTargetInfluences.fill(0);
    let time=state.actionTime??0;
    if(name==='Idle')time=this.idleTime%duration;
    else if(name==='Run')time=((state.distance??0)/GAME.speed)%duration;
    else if(state.action==='Dive')time=GAME.jumpSeconds/2;
    else if(name==='Slide'&&state.slideFromDive)time=Math.max(GAME.slidePoseHoldStart,time);
    // LoopOnce may have paused the action on a previous sample; sampling is
    // absolute and independent of render rate, including Jump <-> Dive reuse.
    action.paused=false;action.enabled=true;
    this.mixer.setTime(Math.min(time,duration-1e-6));
    // A landing may happen near the end of a dropped render frame. Only the
    // time actually spent in the new transient action may age its transition.
    const blendDt=changed&&Number.isFinite(state.elapsed)&&['Jump','Slide','Dive'].includes(state.action)?Math.min(dt,state.actionTime):dt;
    this.blendTime=Math.min(GAME.actionBlendSeconds,this.blendTime+blendDt);
    const t=this.blendTime/GAME.actionBlendSeconds,weight=t*t*(3-2*t);
    for(const pose of this.poses){
      pose.targetPosition.copy(pose.node.position);pose.targetQuaternion.copy(pose.node.quaternion);pose.targetScale.copy(pose.node.scale);
      if(weight<1){
        pose.node.position.lerpVectors(pose.position,pose.targetPosition,weight);
        pose.node.quaternion.slerpQuaternions(pose.quaternion,pose.targetQuaternion,weight);
        pose.node.scale.lerpVectors(pose.scale,pose.targetScale,weight);
      }
    }
    for(const expression of this.expressions){
      expression.target=[...expression.node.morphTargetInfluences];
      expression.node.morphTargetInfluences.forEach((value,index)=>{
        expression.node.morphTargetInfluences[index]=THREE.MathUtils.lerp(expression.from[index],value,weight);
      });
    }
    this.groundPose();
  }
  groundPose(){
    if(!this.contacts.length)return;
    // These sparse probes were selected from the actual skinned clip and
    // transition extrema. Keep the visual soles/belly above the foot anchor
    // without changing the controller, jump trajectory or collision capsule.
    this.root.position.y=this.baseHeight;
    if(this.root.parent)this.root.parent.updateWorldMatrix(true,false);
    // SkinnedMesh updates its bind inverse in updateMatrixWorld (its
    // updateWorldMatrix implementation does not run that override).
    this.root.updateMatrixWorld(true);
    this.parentInverse.identity();if(this.root.parent)this.parentInverse.copy(this.root.parent.matrixWorld).invert();
    let lowest=Infinity;
    for(const {mesh,indices} of this.contacts){
      mesh.skeleton.update();this.contactMatrix.multiplyMatrices(this.parentInverse,mesh.matrixWorld);
      for(const vertex of indices){
        mesh.getVertexPosition(vertex,this.contactPoint).applyMatrix4(this.contactMatrix);lowest=Math.min(lowest,this.contactPoint.y);
      }
    }
    this.root.position.y=this.baseHeight+Math.max(0,this.baseHeight-lowest)+.001;
    this.root.updateMatrixWorld(true);
  }
}
