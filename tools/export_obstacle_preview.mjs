// Export the actual pooled meshes for offline visual inspection in Blender.
// This is not a browser screenshot or a substitute for gameplay verification.
import * as THREE from 'three';
import {writeFileSync,mkdirSync} from 'node:fs';
import {ObstacleRenderer} from '../src/obstacle-renderer.js';

const root=new THREE.Group(),view=new ObstacleRenderer(root);
const records=['barrier','overhead','train','crate','oncoming'].map((kind,id)=>
  ({id,kind,lane:id-2,frontDistance:0,hasRamp:kind==='train',motionSpeed:kind==='oncoming'?6:0,arrivalTime:0,baseHeight:0,parentId:null,hit:false}));
records.push({id:5,kind:'barrier',lane:0,frontDistance:16,baseHeight:3.8,parentId:2,hit:false});
view.sync({active:records},0,0);
for(const o of records)view.byId.get(o.id).root.position.x=o.lane*4.2;
root.updateMatrixWorld(true);
const meshes=[];
root.traverseVisible(mesh=>{
  if(!mesh.isMesh)return;
  const positions=[],vertex=new THREE.Vector3(),attribute=mesh.geometry.getAttribute('position');
  for(let i=0;i<attribute.count;i++){
    vertex.fromBufferAttribute(attribute,i).applyMatrix4(mesh.matrixWorld);
    positions.push([vertex.x,-vertex.z,vertex.y]);
  }
  meshes.push({positions,indices:mesh.geometry.index?Array.from(mesh.geometry.index.array):Array.from({length:attribute.count},(_,i)=>i),
    color:mesh.material.color.toArray(),emissive:mesh.material.emissive.toArray(),
    emissiveIntensity:mesh.material.emissiveIntensity});
});
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/obstacle-preview-meshes.json',JSON.stringify({meshes}));
console.log(`Exported ${meshes.length} actual obstacle meshes for offline rendering.`);
