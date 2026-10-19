import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RunnerAnimation} from '../src/runner-animation.js';
import {RunnerController} from '../src/controller.js';
import {CONTACT_MODEL_SHA256} from '../src/animation-contacts.js';
import {GAME} from '../src/game-config.js';

async function loadAsset(){
  const bytes=await readFile(new URL('../assets/nailong-rounded.glb',import.meta.url)),jsonBytes=bytes.readUInt32LE(12);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),CONTACT_MODEL_SHA256,'Rebuild animation contact probes for this model');
  const doc=JSON.parse(bytes.subarray(20,20+jsonBytes));
  // CPU-only skinning QA needs geometry, joints and clips, without decoding the texture.
  doc.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(28+jsonBytes).toString('base64')}`;
  for(const mesh of doc.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  globalThis.ProgressEvent??=class{constructor(type,properties){Object.assign(this,properties);}};
  return new GLTFLoader().parseAsync(JSON.stringify(doc),'');
}

test('the actual skinned model completes the chain without ground penetration or non-finite transforms',async t=>{
  const gltf=await loadAsset();
  const actor=new THREE.Group();gltf.scene.scale.setScalar(GAME.characterScale);actor.add(gltf.scene);
  const animator=new RunnerAnimation(gltf.scene,gltf.animations),runner=new RunnerController();
  runner.start();runner.course.clear();runner.course.nextFrontDistance=Infinity;animator.reset(runner);
  const meshes=[],point=new THREE.Vector3();gltf.scene.traverse(node=>{if(node.isSkinnedMesh)meshes.push(node);});
  const events=[[.15,'slide'],[.5,'jump'],[.75,'slide'],[1.25,'jump'],[1.5,'slide']];
  let next=0,lowest=Infinity,worst=null,maxVisualLift=0;const minimumByAction={};
  for(let frame=0;frame<336;frame++){
    if(next<events.length&&runner.elapsed>=events[next][0]-1e-8){
      const lift=gltf.scene.position.y;runner.input(events[next++][1]);animator.update(runner,0);
      assert.ok(Math.abs(lift-gltf.scene.position.y)<1e-6,'Input must not snap the visual root');
    }
    runner.update(1/120);animator.update(runner,1/120);actor.position.y=runner.y;actor.updateMatrixWorld(true);
    maxVisualLift=Math.max(maxVisualLift,gltf.scene.position.y);
    for(const mesh of meshes){
      mesh.skeleton.update();
      for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){
        mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
        assert.ok(Number.isFinite(point.y));
        minimumByAction[runner.action]=Math.min(minimumByAction[runner.action]??Infinity,point.y);
        if(point.y<lowest){lowest=point.y;worst={time:runner.elapsed,action:runner.action,age:runner.actionTime,y:point.y};}
      }
    }
  }
  t.diagnostic(JSON.stringify({lowest,worst,minimumByAction,maxVisualLift}));
  assert.ok(lowest>=-.002,`Ground penetration: ${JSON.stringify(worst)}`);
  assert.ok(maxVisualLift<.15,'Contact correction must stay small, without floating or accumulating offsets');
  assert.equal(runner.action,'Run');assert.equal(runner.lives,3);
});

test('the exported Laugh includes moving expression weights, fits the low collider, and restores the neutral face',async()=>{
  const gltf=await loadAsset();gltf.scene.scale.setScalar(GAME.characterScale);
  const animator=new RunnerAnimation(gltf.scene,gltf.animations),point=new THREE.Vector3(),meshes=[];
  gltf.scene.traverse(node=>{if(node.isSkinnedMesh)meshes.push(node);});
  assert.equal(gltf.animations.length,5);assert.ok(animator.expressions.length>=2);
  for(let frame=12;frame<=39;frame++){
    animator.reset({action:'Slide',actionTime:frame/60,actionSerial:frame,slideFromDive:false});
    assert.equal(animator.activeClip,'Laugh');
    for(const expression of animator.expressions)assert.ok(expression.node.morphTargetInfluences[0]>.99,'The GLB must contain the authored smile, not a constant neutral weight');
    gltf.scene.updateMatrixWorld(true);
    for(const mesh of meshes){
      mesh.skeleton.update();
      for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){
        mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y>=-.002&&point.y<=GAME.slidingHeight+.002,`Laugh vertex outside low stance at ${frame/60}: ${point.y}`);
      }
    }
  }
  for(const state of [{action:'Jump',actionTime:.2},{action:'Dive',actionTime:.1},{action:'Slide',actionTime:.3,slideFromDive:true},{action:'Run',distance:0},{action:'Idle'}]){
    animator.reset(state);
    for(const expression of animator.expressions)assert.equal(expression.node.morphTargetInfluences[0],0);
  }
});

test('Laugh keeps the round belly proportions without shrinking the entire character',async()=>{
  const gltf=await loadAsset();gltf.scene.scale.setScalar(GAME.characterScale);
  const animator=new RunnerAnimation(gltf.scene,gltf.animations),mesh=gltf.scene.getObjectByName('Nailong_Rounded');
  const pelvis=mesh.skeleton.bones.find(bone=>bone.name==='Pelvis'),root=mesh.skeleton.bones.find(bone=>bone.name==='Root');
  const point=new THREE.Vector3(),selected=[],reference=[];
  animator.reset({action:'Idle'});gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();
  const inverse=pelvis.matrixWorld.clone().invert();
  for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){
    mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
    if(Math.abs(point.x)<.60*GAME.characterScale&&point.y>1.10*GAME.characterScale&&point.y<1.95*GAME.characterScale&&point.z>.43*GAME.characterScale){
      selected.push(vertex);reference.push(point.clone().applyMatrix4(inverse));
    }
  }
  assert.ok(selected.length>500,'Sample the front belly, excluding the arms and face');
  // Distances between fixed points measure the same round shape even when the
  // belly gently leans. Screen-space boxes would incorrectly count rotation
  // as a change of size.
  const anchors=Array.from({length:32},(_,index)=>Math.floor(index*(selected.length-1)/31));
  const segments=[];
  for(let a=0;a<anchors.length;a++)for(let b=a+1;b<anchors.length;b++){
    const distance=reference[anchors[a]].distanceTo(reference[anchors[b]]);
    if(distance>.3)segments.push({a,b,distance});
  }
  for(let frame=0;frame<=51;frame++){
    animator.reset({action:'Slide',slideFromDive:false,actionTime:frame/60});
    gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();inverse.copy(pelvis.matrixWorld).invert();
    assert.ok(root.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-6,'Do not squash the whole body to satisfy the collider');
    const actual=anchors.map(index=>mesh.getVertexPosition(selected[index],new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
    for(const {a,b,distance} of segments){
      const ratio=actual[a].distanceTo(actual[b])/distance;
      assert.ok(ratio>=.95&&ratio<=1.06,`Belly proportions changed at ${frame/60}: ${ratio}`);
    }
  }
});

test('Laugh rear surface normals follow the final rounded back in the browser skinning path',async t=>{
  const gltf=await loadAsset(),animator=new RunnerAnimation(gltf.scene,gltf.animations);
  const mesh=gltf.scene.getObjectByName('Nailong_Rounded'),geometry=mesh.geometry;
  const weights=geometry.attributes.skinWeight,joints=geometry.attributes.skinIndex;
  const normal=geometry.attributes.normal,position=geometry.attributes.position;
  const vertex=new THREE.Vector3(),shaderNormal=new THREE.Vector3(),jointMatrix=new THREE.Matrix4(),skin=new THREE.Matrix4();
  const posed=geometry.clone(),positions=new Float32Array(position.count*3),cosines=[];
  for(const time of [.20,.40,.65]){
    animator.reset({action:'Slide',slideFromDive:false,actionTime:time});gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();
    for(let i=0;i<position.count;i++)mesh.getVertexPosition(i,vertex).toArray(positions,i*3);
    posed.setAttribute('position',new THREE.BufferAttribute(positions,3));posed.computeVertexNormals();
    for(let i=0;i<position.count;i++){
      // Original rear shell, excluding the arm joins, head and crotch.
      if(Math.abs(position.getX(i))>.60||position.getY(i)<1.05||position.getY(i)>2.2||position.getZ(i)>-.20)continue;
      shaderNormal.fromBufferAttribute(normal,i);
      for(let morph=0;morph<mesh.morphTargetInfluences.length;morph++){
        vertex.fromBufferAttribute(geometry.morphAttributes.normal[morph],i);
        shaderNormal.addScaledVector(vertex,mesh.morphTargetInfluences[morph]);
      }
      skin.elements.fill(0);
      for(let channel=0;channel<4;channel++){
        jointMatrix.fromArray(mesh.skeleton.boneMatrices,joints.getComponent(i,channel)*16);
        const weight=weights.getComponent(i,channel);
        for(let element=0;element<16;element++)skin.elements[element]+=jointMatrix.elements[element]*weight;
      }
      skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
      shaderNormal.applyMatrix3(new THREE.Matrix3().setFromMatrix4(skin)).normalize();
      vertex.fromBufferAttribute(posed.attributes.normal,i).normalize();
      cosines.push(shaderNormal.dot(vertex));
    }
  }
  const average=cosines.reduce((a,b)=>a+b,0)/cosines.length;
  const bad=cosines.filter(cosine=>cosine<.85).length/cosines.length;
  t.diagnostic(JSON.stringify({rearSamples:cosines.length,averageNormalAlignment:average,incorrectFraction:bad}));
  assert.ok(cosines.length>1000);assert.ok(average>.97&&bad<.02,'Export normals of the final posed back, without dark inverted folds');
  posed.dispose();
});
