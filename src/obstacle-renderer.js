import * as THREE from 'three';
import {GAME,OBSTACLES} from './game-config.js';
import {obstacleEnd,frontAt} from './obstacles.js';

/** Fixed-size visual pool. Each slot owns reusable variants and its
 * fading materials; geometry is shared across all slots. No allocation per lap. */
export class ObstacleRenderer {
  constructor(parent){
    this.parent=parent;this.geometries=new Map();this.byId=new Map();
    this.slots=Array.from({length:GAME.maxObstacles},()=>this.createSlot());
    this.reset();
  }
  geometry(w,h,d){
    const key=`box/${w}/${h}/${d}`;
    if(!this.geometries.has(key))this.geometries.set(key,new THREE.BoxGeometry(w,h,d));
    return this.geometries.get(key);
  }
  createVariant(kind){
    const group=new THREE.Group(),hazard=new THREE.Group(),detail=new THREE.Group();
    group.name=`obstacle-${kind}`;hazard.name='hazard';detail.name='decoration';group.add(hazard,detail);
    const materials=[];
    const paint=(color,emissive=null)=>{
      const mat=new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.03,transparent:true,
        ...(emissive?{emissive,emissiveIntensity:.65}:{})});
      materials.push(mat);return mat;
    };
    const cube=(w,h,d,mat,x,y,z,root=hazard)=>{
      const mesh=new THREE.Mesh(this.geometry(w,h,d),mat);mesh.position.set(x,y,z);
      mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;
    };
    const baseKind=kind==='trainRamp'?'train':kind==='roofOverhead'?'overhead':kind;
    const spec=OBSTACLES[baseKind];
    if(kind==='barrier'){
      const orange=paint('#ef8647'),ivory=paint('#fff2c9'),dark=paint('#344e47');
      cube(spec.width,spec.top-.195,.22,orange,0,(spec.top+.105)/2,-.25);
      for(const x of [-.66,.66]){
        cube(.12,.4,.16,dark,x,.2,-.4);
        cube(.34,.07,spec.length,dark,x,.035,-spec.length/2);
      }
      for(const x of [-.60,0,.60])cube(.23,.45,.012,ivory,x,.40,-.132,detail).rotation.z=-.3;
      cube(spec.width,.045,.24,ivory,0,spec.top-.0225,-.25);
    }else if(baseKind==='overhead'){
      const red=paint('#d9634e'),ivory=paint('#fff2cf'),metal=paint('#5c7c70');
      cube(spec.width,spec.top-spec.bottom,spec.length,red,0,(spec.top+spec.bottom)/2,-spec.length/2);
      for(const x of [-.62,0,.62])cube(.24,spec.top-spec.bottom-.03,.012,ivory,x,(spec.top+spec.bottom)/2,.007,detail).rotation.z=-.30;
      // Suspend the bar from overhead hardware; there are no ground-level
      // posts for the wide character's arms to clip through while sliding.
      const ceiling=kind==='roofOverhead'?9.5-OBSTACLES.train.top:9.5;
      for(const x of [-.72,.72])cube(.035,ceiling-spec.top,.035,metal,x,(ceiling+spec.top)/2,-spec.length/2,detail);
      cube(2.30,.10,.14,metal,0,ceiling+.03,-spec.length/2,detail);
      cube(.48,.14,.025,ivory,0,spec.top+.24,-.01,detail);
    }else if(kind==='crate'){
      const wood=paint('#a46e43'),dark=paint('#6a4735'),gold=paint('#f2c45e');
      cube(spec.width,spec.top,spec.length,wood,0,spec.top/2,-spec.length/2);
      for(const side of [-1,1]){
        cube(.09,spec.top,.018,dark,side*.57,spec.top/2,.012,detail);
        for(const y of [.10,spec.top-.10])cube(.25,.16,.025,gold,side*.66,y,.026,detail);
      }
      for(const y of [.34,.69])cube(spec.width-.08,.035,.018,dark,0,y,.015,detail);
      const brace=cube(.055,.93,.022,gold,0,spec.top/2,.027,detail);brace.rotation.z=-.65;
    }else{
      const moving=kind==='oncoming';
      const body=paint(moving?'#b95445':'#315f5e'),roof=paint(moving?'#673c3a':'#234a4e'),ivory=paint('#d6d6ad');
      const glass=paint('#142e39'),window=paint('#e6c783','#c18a3c'),lamp=paint(moving?'#fff5d9':'#f8d284',moving?'#fff0c1':'#e4a34a');
      if(moving)lamp.emissiveIntensity=2.3;
      const dark=paint('#172f35');
      // Build adjoining hull sections rather than coplanar overlays: duplicate
      // top/front faces otherwise flicker in WebGL and render dark offline.
      cube(spec.width,spec.top-.42,spec.length,body,0,.26+(spec.top-.42)/2,-spec.length/2);
      cube(spec.width,.16,spec.length,roof,0,spec.top-.08,-spec.length/2);
      cube(spec.width+.01,.12,spec.length+.02,ivory,0,.55,-spec.length/2,detail);
      cube(spec.width,.26,spec.length,dark,0,.13,-spec.length/2);
      cube(1.48,.85,.025,glass,0,2.6,.014,detail);
      cube(.035,.85,.04,ivory,0,2.6,.033,detail);
      for(const x of [-.59,.59])cube(.23,.16,.025,lamp,x,1.02,.025,detail);
      cube(.20,.12,.025,lamp,0,3.48,.025,detail);
      cube(1.36,.10,.025,ivory,0,.78,.025,detail);
      if(moving){
        for(const side of [-1,1]){
          const stripe=cube(.09,.7,.025,ivory,side*.35,1.65,.025,detail);stripe.rotation.z=side*.62;
        }
        cube(1.4,.12,.035,lamp,0,3.45,.04,detail);
      }
      for(const side of [-1,1])for(let i=0;i<9;i++){
        cube(.018,.82,1.08,window,side*(spec.width/2+.007),2.55,-1.1-i*1.85,detail);
      }
      if(kind==='trainRamp'){
        for(const mesh of [...hazard.children,...detail.children])mesh.position.z-=GAME.rampLength;
        const key='ramp';
        if(!this.geometries.has(key)){
          const w=spec.width/2,h=spec.top,l=GAME.rampLength,geometry=new THREE.BufferGeometry();
          geometry.setAttribute('position',new THREE.Float32BufferAttribute([-w,0,0,w,0,0,-w,0,-l,w,0,-l,-w,h,-l,w,h,-l],3));
          geometry.setIndex([0,2,1,1,2,3,2,4,3,3,4,5,0,1,4,1,5,4,0,4,2,1,3,5]);
          geometry.computeVertexNormals();this.geometries.set(key,geometry.toNonIndexed());geometry.dispose();
          this.geometries.get(key).computeVertexNormals();
        }
        const ramp=new THREE.Mesh(this.geometries.get(key),body);ramp.castShadow=true;ramp.receiveShadow=true;hazard.add(ramp);
        for(const progress of [.18,.39,.60,.81]){
          const stripe=cube(1.5,.025,.14,ivory,0,spec.top*progress+.022,-GAME.rampLength*progress,detail);
          stripe.rotation.x=Math.atan(spec.top/GAME.rampLength);
        }
      }
    }
    group.userData.kind=kind;
    return {group,hazard,materials,alpha:-1};
  }
  createSlot(){
    const root=new THREE.Group();root.name='pooled-obstacle';this.parent.add(root);
    const variants=Object.fromEntries([...Object.keys(OBSTACLES),'trainRamp','roofOverhead'].map(kind=>[kind,this.createVariant(kind)]));
    for(const view of Object.values(variants))root.add(view.group);
    return {root,variants,id:null};
  }
  setAlpha(view,alpha){
    if(Math.abs(view.alpha-alpha)<.002)return;
    view.alpha=alpha;
    for(const mat of view.materials){mat.opacity=alpha;mat.depthWrite=alpha>.99;}
    view.group.traverse(mesh=>{if(mesh.isMesh)mesh.castShadow=alpha>.99;});
  }
  reset(){
    this.byId.clear();
    for(const slot of this.slots){
      slot.id=null;slot.root.visible=false;
      for(const view of Object.values(slot.variants)){view.group.visible=false;this.setAlpha(view,1);}
    }
  }
  sync(course,distance,elapsed){
    const active=new Set(course.active.map(o=>o.id));
    for(const [id,slot] of this.byId){
      if(!active.has(id)){slot.id=null;slot.root.visible=false;this.byId.delete(id);}
    }
    for(const obstacle of course.active){
      let slot=this.byId.get(obstacle.id);
      if(!slot){
        slot=this.slots.find(s=>s.id===null);
        if(!slot)throw new Error('Obstacle visual pool exhausted');
        slot.id=obstacle.id;this.byId.set(obstacle.id,slot);
        for(const view of Object.values(slot.variants))view.group.visible=false;
      }
      const key=obstacle.kind==='train'&&obstacle.hasRamp?'trainRamp':
        obstacle.kind==='overhead'&&obstacle.parentId!=null?'roofOverhead':obstacle.kind;
      const view=slot.variants[key];
      const alpha=obstacle.hit?Math.max(0,1-(elapsed-obstacle.hitAt)/GAME.fadeSeconds):1;
      slot.root.position.set(obstacle.lane*GAME.laneSpacing,obstacle.baseHeight??0,distance-frontAt(obstacle,elapsed));
      const passed=distance>obstacleEnd(obstacle,elapsed)+GAME.playerDepth/2;
      slot.root.visible=alpha>.01&&!passed;view.group.visible=true;this.setAlpha(view,alpha);
    }
  }
  stats(){return {capacity:this.slots.length,assigned:this.byId.size,
    visible:this.slots.filter(s=>s.root.visible).length,geometries:this.geometries.size,
    materials:this.slots.reduce((n,s)=>n+Object.values(s.variants).reduce((m,v)=>m+v.materials.length,0),0)};}
}
