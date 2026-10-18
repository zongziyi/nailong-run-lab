import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RunnerAnimation} from '../src/runner-animation.js';
import {RunnerController} from '../src/controller.js';
import {CONTACT_MODEL_SHA256} from '../src/animation-contacts.js';

test('the actual skinned model completes the chain without ground penetration or non-finite transforms',async t=>{
  const bytes=await readFile(new URL('../assets/nailong-rounded.glb',import.meta.url)),jsonBytes=bytes.readUInt32LE(12);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),CONTACT_MODEL_SHA256,'Rebuild animation contact probes for this model');
  const doc=JSON.parse(bytes.subarray(20,20+jsonBytes));
  // CPU-only skinning QA needs geometry, joints and clips, without decoding the texture.
  doc.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(28+jsonBytes).toString('base64')}`;
  for(const mesh of doc.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  globalThis.ProgressEvent??=class{constructor(type,properties){Object.assign(this,properties);}};
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');
  const actor=new THREE.Group();gltf.scene.scale.setScalar(.8);actor.add(gltf.scene);
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
