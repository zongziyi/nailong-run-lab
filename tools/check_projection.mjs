import * as THREE from 'three';
import assert from 'node:assert/strict';
import {GAME,OBSTACLES,distanceAt,speedAt} from '../src/game-config.js';

let characterChecks=0,obstacleChecks=0;
const poses=[
  {name:'ground',feet:0,follow:0,height:2.45,depth:.68},
  {name:'ramp',feet:1.9,follow:1.25,height:2.45,depth:.68},
  {name:'roof',feet:3.8,follow:3.8,height:2.45,depth:.68},
  {name:'roof-jump',feet:5.75,follow:4.8,height:2.45,depth:.68},
  {name:'fall',feet:1,follow:2.1,height:2.45,depth:.68},
  {name:'slide',feet:0,follow:0,height:1.35,depth:1.20},
  {name:'roof-slide',feet:3.8,follow:3.8,height:1.35,depth:1.20},
];
for(const [width,height] of [[430,720],[390,844],[360,640]]){
  const camera=new THREE.PerspectiveCamera(50,width/height,.1,160);
  for(const pose of poses)for(const lane of [-1,0,1]){
    camera.position.set(lane*GAME.laneSpacing*.78,4.4+pose.follow,8.6);
    camera.lookAt(camera.position.x,1.35+pose.follow,-3.7);camera.updateMatrixWorld();
    const points=[];
    for(const x of [-.9,.9])for(const y of [0,pose.height])for(const z of [-pose.depth,pose.depth]){
      points.push(new THREE.Vector3(x+lane*GAME.laneSpacing,y+pose.feet,z).project(camera));
    }
    assert.ok(points.every(p=>Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1),
      'Character clipping: '+pose.name+' lane '+lane+', '+width+'x'+height);
    characterChecks++;
  }
  for(const elapsed of [0,120,600])for(const playerLane of [-1,0,1])for(const hazardLane of [-1,0,1]){
    camera.far=Math.max(160,speedAt(elapsed)*8);camera.updateProjectionMatrix();
    for(const feet of [0,3.8]){
      camera.position.set(playerLane*GAME.laneSpacing*.78,4.4+feet,8.6);
      camera.lookAt(camera.position.x,1.35+feet,-3.7);camera.updateMatrixWorld();
      for(const seconds of [2,3])for(const [kind,spec] of Object.entries(OBSTACLES)){
        const ahead=distanceAt(elapsed+seconds)-distanceAt(elapsed)+GAME.playerDepth/2+
          (kind==='oncoming'?GAME.oncomingSpeed*seconds:0);
        const center=new THREE.Vector3(hazardLane*GAME.laneSpacing,(spec.bottom+spec.top)/2,-ahead).project(camera);
        assert.ok(Math.abs(center.x)<1&&Math.abs(center.y)<1&&center.z>-1&&center.z<1,
          kind+' hidden: '+width+'x'+height+', time '+elapsed+', height '+feet);
        obstacleChecks++;
      }
      for(const spec of [OBSTACLES.barrier,OBSTACLES.overhead]){
        const ahead=distanceAt(elapsed+2)-distanceAt(elapsed);
        const center=new THREE.Vector3(hazardLane*GAME.laneSpacing,3.8+(spec.bottom+spec.top)/2,-ahead).project(camera);
        assert.ok(Math.abs(center.x)<1&&Math.abs(center.y)<1,'Roof obstacle not visible during approach');obstacleChecks++;
      }
      const arrow=new THREE.Vector3(hazardLane*GAME.laneSpacing,.065,-13.5).project(camera);
      assert.ok(Math.abs(arrow.x)<1&&Math.abs(arrow.y)<1,'Traffic warning arrow clipped');obstacleChecks++;
    }
  }
}
console.log('PASS: '+characterChecks+' character ground/ramp/roof/jump/slide projections; '+obstacleChecks+' accelerating approach projections (geometry only)');
