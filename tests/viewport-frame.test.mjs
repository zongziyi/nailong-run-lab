import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {JSDOM} from 'jsdom';
import {ViewportFrame} from '../src/viewport-frame.js';

function setup(){
  const calls=[],rect={width:390,height:844},scene={};
  const camera=new THREE.PerspectiveCamera(34,1,.1,160);
  camera.position.set(4,2.7,8.3);
  const update=camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix=()=>{calls.push('projection');update();};
  const renderer={domElement:{width:300,height:150},getPixelRatio:()=>1.5,
    setSize(width,height,style){
      assert.equal(style,false);calls.push('resize');
      this.domElement.width=Math.floor(width*1.5);this.domElement.height=Math.floor(height*1.5);
    },render(s,c){assert.equal(s,scene);assert.equal(c,camera);calls.push('render');}};
  const orbit={target:new THREE.Vector3(0,.35,0),update(){calls.push('orbit');}};
  const state={inspect:false};
  const frame=new ViewportFrame({renderer,camera,orbit,viewport:{getBoundingClientRect:()=>rect},isInspect:()=>state.inspect});
  return {frame,renderer,camera,orbit,rect,state,calls,scene};
}

test('observer invalidation never clears the canvas; resizing and drawing share one frame',()=>{
  const p=setup();p.frame.invalidate();p.frame.invalidate();
  assert.deepEqual(p.calls,[]);
  p.frame.render(p.scene);
  assert.deepEqual(p.calls,['resize','projection','render']);
  assert.deepEqual(p.renderer.domElement,{width:585,height:1266});
  assert.equal(p.camera.aspect,390/844);
  p.calls.length=0;p.rect.height=733;p.frame.invalidate();
  assert.deepEqual(p.calls,[]);
  p.frame.render(p.scene);assert.deepEqual(p.calls,['resize','projection','render']);
});

test('repeated notifications and subpixel layout changes do not reallocate an identical drawing buffer',()=>{
  const p=setup();p.frame.render(p.scene);p.calls.length=0;
  for(let i=0;i<10;i++){p.frame.invalidate();p.frame.render(p.scene);}
  assert.deepEqual(p.calls,Array(10).fill('render'));
  p.calls.length=0;p.rect.width+=.1;p.rect.height+=.1;p.frame.invalidate();p.frame.render(p.scene);
  assert.deepEqual(p.calls,['projection','render']);
  assert.equal(p.camera.aspect,p.rect.width/p.rect.height);
});

test('hidden, zero and invalid viewport sizes retain the last valid buffer and camera',()=>{
  const p=setup();p.frame.render(p.scene);const aspect=p.camera.aspect;p.calls.length=0;
  for(const [width,height] of [[0,844],[390,0],[-1,844],[NaN,844],[390,Infinity],[.1,.1]]){
    Object.assign(p.rect,{width,height});p.frame.invalidate();p.frame.render(p.scene);
  }
  assert.deepEqual(p.calls,Array(6).fill('render'));
  assert.equal(p.camera.aspect,aspect);assert.deepEqual(p.renderer.domElement,{width:585,height:1266});
  Object.assign(p.rect,{width:844,height:390});p.frame.invalidate();p.frame.render(p.scene);
  assert.deepEqual(p.calls.slice(-3),['resize','projection','render']);
  assert.equal(p.camera.aspect,844/390);
});

test('inspection resizing preserves the orbit target and adjusts distance for the new aspect',()=>{
  const p=setup();p.frame.render(p.scene);p.state.inspect=true;p.calls.length=0;
  const target=p.orbit.target.clone(),before=p.camera.position.clone().sub(target);
  const oldFactor=Math.max(1.08,.56/p.camera.aspect);
  Object.assign(p.rect,{width:360,height:844});p.frame.invalidate();p.frame.render(p.scene);
  const expected=before.multiplyScalar(Math.max(1.08,.56/p.camera.aspect)/oldFactor).add(target);
  assert.ok(p.camera.position.distanceTo(expected)<1e-10);assert.ok(p.orbit.target.equals(target));
  assert.deepEqual(p.calls,['resize','projection','orbit','render']);
});

test('running, paused and game-over frames keep the gameplay camera position during rotation',()=>{
  const p=setup();const position=p.camera.position.clone();p.frame.render(p.scene);
  for(const size of [[844,390],[390,844],[430,720]]){
    p.calls.length=0;Object.assign(p.rect,{width:size[0],height:size[1]});
    p.frame.invalidate();p.frame.render(p.scene);
    assert.deepEqual(p.calls,['resize','projection','render']);assert.ok(p.camera.position.equals(position));
    p.calls.length=0;p.frame.render(p.scene);assert.deepEqual(p.calls,['render']);
  }
});

test('traffic, damage, protection and empty status keep the same reserved row and dark viewport',async()=>{
  const [html,css]=await Promise.all(['index.html','src/style.css'].map(file=>readFile(new URL(`../${file}`,import.meta.url),'utf8')));
  const dom=new JSDOM(html),{document,getComputedStyle}=dom.window;
  try{
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const stage=document.querySelector('#stage');stage.classList.add('running');
    const status=document.querySelector('.run-status'),notices=[...document.querySelector('.run-notices').children];
    for(const visible of [[],[0],[1],[2],[0,1,2],[],[2],[0],[]]){
      notices.forEach((node,index)=>{node.hidden=!visible.includes(index);});
      const computed=getComputedStyle(status);
      assert.equal(computed.display,'grid');assert.equal(computed.height,'20px');
      assert.equal(getComputedStyle(stage).gridTemplateRows,'auto minmax(0,1fr)');
    }
    assert.equal(getComputedStyle(document.querySelector('#viewport')).backgroundColor,'rgb(23, 52, 66)');
    stage.classList.remove('running');assert.equal(getComputedStyle(status).display,'none');
  }finally{dom.window.close();}
});
