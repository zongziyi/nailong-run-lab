import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ObstacleRenderer} from '../src/obstacle-renderer.js';
import {GAME,OBSTACLES} from '../src/game-config.js';
import {frontAt} from '../src/obstacles.js';
const close=(actual,want)=>assert.ok(Math.abs(actual-want)<1e-5,`${actual} != ${want}`);
const fixture=(id,kind,lane=0)=>({id,kind,lane,frontDistance:20,hit:false,hitAt:Infinity});

test('visible solid meshes match the configured dimensions and front edge',()=>{
  const scene=new THREE.Scene(),visuals=new ObstacleRenderer(scene);
  const records=Object.keys(OBSTACLES).map((kind,i)=>fixture(i+1,kind,i-1));
  visuals.sync({active:records},5,1);scene.updateMatrixWorld(true);
  for(const obstacle of records){
    const view=visuals.byId.get(obstacle.id).variants[obstacle.kind];
    const bounds=new THREE.Box3().setFromObject(view.hazard),size=bounds.getSize(new THREE.Vector3());
    const spec=OBSTACLES[obstacle.kind];
    close(size.x,spec.width);close(size.y,spec.top-spec.bottom);close(size.z,spec.length);
    close(bounds.min.y,spec.bottom);close(bounds.max.y,spec.top);
    close(bounds.max.z,5-obstacle.frontDistance);close(bounds.getCenter(new THREE.Vector3()).x,obstacle.lane*GAME.laneSpacing);
  }
});

test('ramped trains use one slot and match the continuous 8-unit slope plus 18-unit body',()=>{
  const scene=new THREE.Scene(),visuals=new ObstacleRenderer(scene),o={...fixture(8,'train'),hasRamp:true};
  visuals.sync({active:[o]},3,0);scene.updateMatrixWorld(true);
  const slot=visuals.byId.get(8),view=slot.variants.trainRamp;
  const bounds=new THREE.Box3().setFromObject(view.hazard),size=bounds.getSize(new THREE.Vector3());
  close(size.x,1.8);close(size.y,3.8);close(size.z,26);close(bounds.max.z,3-o.frontDistance);
  assert.equal(visuals.stats().assigned,1);assert.equal(slot.variants.train.group.visible,false);
  visuals.sync({active:[o]},o.frontDistance+18,0);assert.equal(slot.root.visible,true,'Still on the ramped train body');
  visuals.sync({active:[o]},o.frontDistance+26.5,0);assert.equal(slot.root.visible,false);
});
test('fading is per-obstacle; passed objects hide before they can cover the camera',()=>{
  const visuals=new ObstacleRenderer(new THREE.Scene());
  const a=fixture(1,'train'),b=fixture(2,'train',1);
  visuals.sync({active:[a,b]},0,1);
  a.hit=true;a.hitAt=1;
  visuals.sync({active:[a,b]},0,1+GAME.fadeSeconds/2);
  const first=visuals.byId.get(1).variants.train,second=visuals.byId.get(2).variants.train;
  for(const mat of first.materials)close(mat.opacity,0.5);
  for(const mat of second.materials)close(mat.opacity,1);
  visuals.sync({active:[a,b]},0,2);assert.equal(visuals.byId.get(1).root.visible,false);
  visuals.sync({active:[b]},20+OBSTACLES.train.length+GAME.playerDepth/2+.01,2);
  assert.equal(visuals.byId.get(2).root.visible,false);
});
test('1,000 visual recycling rounds reuse roots, geometry and materials, including after restart',()=>{
  const scene=new THREE.Scene(),visuals=new ObstacleRenderer(scene),initial=visuals.stats();
  const roots=visuals.slots.map(s=>s.root),kinds=Object.keys(OBSTACLES);
  for(let round=0;round<1000;round++){
    const active=Array.from({length:8},(_,i)=>{
      const kind=kinds[(i+round)%kinds.length],roof=kind==='overhead'&&i%2===0;
      return {...fixture(round*8+i+1,kind,i%3-1),hasRamp:kind==='train'&&i%2===0,
        parentId:roof?100:null,baseHeight:roof?3.8:0,motionSpeed:kind==='oncoming'?6:0,arrivalTime:round+2};
    });
    visuals.sync({active},0,round);
    assert.equal(visuals.stats().assigned,8);assert.equal(scene.children.length,GAME.maxObstacles);
  }
  visuals.reset();assert.equal(visuals.stats().assigned,0);
  assert.ok(visuals.slots.every(s=>!s.root.visible));
  visuals.sync({active:[fixture(1,'barrier')]},0,0);
  const slot=visuals.byId.get(1);assert.equal(slot.variants.barrier.group.visible,true);
  assert.equal(slot.variants.train.group.visible,false);assert.equal(slot.variants.overhead.group.visible,false);
  for(const mat of slot.variants.barrier.materials)close(mat.opacity,1);
  assert.deepEqual(visuals.slots.map(s=>s.root),roots);
  assert.equal(visuals.stats().geometries,initial.geometries);assert.equal(visuals.stats().materials,initial.materials);
});

test('rooftop bars render at the collision elevation with suspension under the raised ceiling',()=>{
  const scene=new THREE.Scene(),visuals=new ObstacleRenderer(scene),o={...fixture(1,'overhead'),parentId:99,baseHeight:3.8};
  visuals.sync({active:[o]},0,0);scene.updateMatrixWorld(true);
  const slot=visuals.byId.get(1),view=slot.variants.roofOverhead;
  const hazard=new THREE.Box3().setFromObject(view.hazard),all=new THREE.Box3().setFromObject(view.group);
  close(hazard.min.y,5.45);close(hazard.max.y,5.8);assert.ok(all.max.y<9.6);
  assert.equal(slot.variants.overhead.group.visible,false);
});

test('red oncoming train uses the same moving front as collision and recycling',()=>{
  const scene=new THREE.Scene(),visuals=new ObstacleRenderer(scene),o={...fixture(1,'oncoming'),motionSpeed:6,arrivalTime:3};
  visuals.sync({active:[o]},5,2);scene.updateMatrixWorld(true);
  const slot=visuals.byId.get(1),view=slot.variants.oncoming;
  const hazard=new THREE.Box3().setFromObject(view.hazard);
  close(hazard.max.z,5-frontAt(o,2));assert.ok(view.materials.some(m=>m.emissiveIntensity>2));
  visuals.sync({active:[o]},5,10);assert.equal(slot.root.visible,false);
});
