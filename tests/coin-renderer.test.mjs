import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CoinRenderer} from '../src/coin-renderer.js';
import {CoinCourse,COINS} from '../src/coins.js';

test('coins and flashes share a fixed instance pool; pause freezes animation and pickup hides the coin',()=>{
  const visual=new CoinRenderer(new THREE.Group()),course=new CoinCourse();
  course.add([{x:2.15,y:3,distance:20,supportId:null,challenge:true}]);visual.sync(course,10,1);
  assert.equal(visual.body.count,1);assert.equal(visual.rim.count,1);assert.equal(visual.flash.count,0);
  const matrix=new THREE.Matrix4();visual.body.getMatrixAt(0,matrix);const original=matrix.clone();
  visual.sync(course,10,1);visual.body.getMatrixAt(0,matrix);assert.deepEqual(matrix.elements,original.elements);
  course.active[0].collectedAt=1;visual.sync(course,10,1.1);assert.equal(visual.body.count,0);assert.equal(visual.flash.count,1);
  visual.sync(course,10,1.5);assert.equal(visual.flash.count,0);
  const geometries=[visual.body.geometry,visual.rim.geometry,visual.flash.geometry];
  for(let i=0;i<1000;i++){course.clear();course.add([{x:0,y:1,distance:i+10}]);visual.sync(course,i,i/10);}
  assert.deepEqual([visual.body.geometry,visual.rim.geometry,visual.flash.geometry],geometries);
  assert.equal(visual.body.instanceMatrix.count,COINS.capacity);visual.reset();assert.equal(visual.body.count,0);
});
