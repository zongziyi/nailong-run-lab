import * as THREE from 'three';
import {COINS} from './coins.js';

export class CoinRenderer {
  constructor(parent){
    this.group=new THREE.Group();this.group.name='coins';parent.add(this.group);
    const body=new THREE.CylinderGeometry(COINS.radius,COINS.radius,.075,16);body.rotateX(Math.PI/2);
    const rim=new THREE.TorusGeometry(COINS.radius*.77,.022,5,16);
    this.body=new THREE.InstancedMesh(body,new THREE.MeshStandardMaterial({color:'#ffce42',metalness:.65,roughness:.28,emissive:'#ad6200',emissiveIntensity:.3}),COINS.capacity);
    this.rim=new THREE.InstancedMesh(rim,new THREE.MeshStandardMaterial({color:'#fff2a6',metalness:.5,roughness:.3}),COINS.capacity);
    this.flash=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.14),new THREE.MeshBasicMaterial({color:'#fff1a1',transparent:true,opacity:.85,depthWrite:false}),COINS.capacity);
    for(const mesh of [this.body,this.rim,this.flash]){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.group.add(mesh);}
    this.pose=new THREE.Object3D();this.reset();
  }
  reset(){this.body.count=0;this.rim.count=0;this.flash.count=0;}
  sync(course,distance,elapsed,lookAhead=180){
    let count=0,flashes=0;
    for(const coin of course.active){
      const z=distance-coin.distance;if(z>2||z< -lookAhead)continue;
      if(coin.collectedAt!==null){
        const age=(elapsed-coin.collectedAt)/COINS.flashSeconds;if(age<0||age>=1)continue;
        this.pose.position.set(coin.x,coin.y+age*.65,z);this.pose.rotation.set(age*3,age*5,Math.PI/4);
        this.pose.scale.setScalar((1-age)*1.4);this.pose.updateMatrix();this.flash.setMatrixAt(flashes++,this.pose.matrix);continue;
      }
      this.pose.position.set(coin.x,coin.y+Math.sin(elapsed*3+coin.id)*.025,z);
      this.pose.rotation.set(0,elapsed*2.4+coin.id*.37,0);this.pose.scale.setScalar(1);this.pose.updateMatrix();
      this.body.setMatrixAt(count,this.pose.matrix);
      this.pose.translateZ(.044);this.pose.updateMatrix();this.rim.setMatrixAt(count,this.pose.matrix);count++;
    }
    this.body.count=count;this.rim.count=count;this.flash.count=flashes;
    for(const mesh of [this.body,this.rim,this.flash])mesh.instanceMatrix.needsUpdate=true;
  }
  stats(){return {capacity:COINS.capacity,visible:this.body.count,flashes:this.flash.count,drawCalls:3};}
}
