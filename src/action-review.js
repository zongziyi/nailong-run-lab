import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RunnerController} from './controller.js';
import {RunnerAnimation} from './runner-animation.js';
import {GAME} from './game-config.js';

const $=s=>document.querySelector(s),view=$('#view');
const runner=new RunnerController();
const scenarios={laugh:[[.15,'slide']],chain:[[.15,'slide'],[.5,'jump'],[.75,'slide'],[1.25,'jump'],[1.5,'slide']]};
let events=scenarios.laugh;
const labels={Run:'奔跑',Slide:'地面滑铲',Jump:'起跳',Dive:'空中下铲'};
const scene=new THREE.Scene();scene.background=new THREE.Color('#213c40');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
view.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(38,1,.1,80);
const cameraViews={front:[0,2.1,4.9],side:[4.9,2.1,0],back:[0,2.1,-4.9],threequarter:[3.2,2.4,4.5]};
scene.add(new THREE.HemisphereLight('#fff5d1','#718b83',2));
const light=new THREE.DirectionalLight('#fff1cb',3);light.position.set(-3,7,5);light.castShadow=true;
light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-6;light.shadow.camera.right=6;light.shadow.camera.top=6;light.shadow.camera.bottom=-6;light.shadow.normalBias=.02;scene.add(light);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#66786c',roughness:1}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.025;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(100,100,'#9fa98a','#788779');grid.position.y=-.024;scene.add(grid);
const actor=new THREE.Group();scene.add(actor);
let animator,playing=false,eventIndex=0,last=performance.now();
function resize(){const {width,height}=view.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();if(animator)draw();}
new ResizeObserver(resize).observe(view);resize();
function draw(){
  actor.position.set(runner.x,runner.y,0);actor.rotation.z=runner.lean;
  const gameView=$('#angle').value==='game';
  camera.fov=gameView?50:38;camera.updateProjectionMatrix();
  if(gameView){camera.position.set(0,4.4,-8.6);camera.lookAt(0,1.35,3.7);}
  else{const [x,y,z]=cameraViews[$('#angle').value];camera.position.set(x,y+runner.y*.8,z);camera.lookAt(0,.95+runner.y*.8,0);}
  $('#action').textContent=runner.action==='Slide'?(runner.slideFromDive?'落地滑铲':'捧腹大笑'):labels[runner.action];
  $('#time').textContent=`${runner.elapsed.toFixed(3)} s`;$('#height').textContent=runner.y.toFixed(3);
  $('#slide-time').textContent=runner.action==='Slide'?`${runner.actionTime.toFixed(3)} / 0.850 s`:'—';
  renderer.render(scene,camera);
}
function reset(){runner.start();runner.course.clear();runner.course.nextFrontDistance=Infinity;eventIndex=0;animator.reset(runner);}
function advance(seconds){
  const target=Math.min(2.8,runner.elapsed+seconds);
  while(runner.elapsed<target-1e-10){
    if(eventIndex<events.length&&events[eventIndex][0]<=runner.elapsed+1e-9){
      runner.input(events[eventIndex++][1]);animator.update(runner,0);continue;
    }
    const dt=Math.min(GAME.physicsStep,target-runner.elapsed,(events[eventIndex]?.[0]??Infinity)-runner.elapsed);
    runner.update(dt);animator.update(runner,dt);
  }
  if(runner.elapsed>=2.8-1e-9)playing=false;
  draw();
}
$('#play').addEventListener('click',()=>{if(runner.elapsed>=2.8-1e-9)reset();playing=true;last=performance.now();});
$('#pause').addEventListener('click',()=>{playing=false;draw();});
$('#replay').addEventListener('click',()=>{reset();playing=true;last=performance.now();draw();});
$('#step').addEventListener('click',()=>{playing=false;advance(1/60);});
$('#seek').addEventListener('change',()=>{playing=false;reset();advance(Number($('#seek').value));});
$('#scenario').addEventListener('change',()=>{
  playing=false;events=scenarios[$('#scenario').value];reset();
  const laughing=$('#scenario').value==='laugh';
  $('#seek').innerHTML=(laughing?[[0,'起点 · 奔跑'],[.23,'大笑进入'],[.40,'抱腹大笑'],[.65,'大笑保持'],[.90,'恢复过渡'],[1.1,'恢复奔跑']]:
    [[0,'起点 · 奔跑'],[.40,'抱腹大笑'],[.535,'大笑接起跳'],[.65,'起跳完成'],[.785,'空中下铲'],[.90,'落地接滑铲'],[1.15,'原滑铲保持'],[1.285,'滑铲再次起跳'],[1.85,'第二次落地滑铲'],[2.55,'恢复奔跑']])
    .map(([time,label])=>`<option value="${time}">${label}</option>`).join('');
  $('#sequence').textContent=laughing?'奔跑 → 捧腹大笑 → 恢复奔跑':'奔跑 → 捧腹大笑 → 起跳 → 空中下铲 → 原滑铲 → 再次起跳 → 下铲 → 完整滑铲 → 奔跑';
  draw();
});
$('#angle').addEventListener('change',()=>{
  draw();
});
function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.1);last=now;if(animator&&playing)advance(dt*Number($('#speed').value));}
try{
  const gltf=await new GLTFLoader().loadAsync('./assets/nailong-rounded.glb');
  gltf.scene.scale.setScalar(GAME.characterScale);gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  actor.add(gltf.scene);animator=new RunnerAnimation(gltf.scene,gltf.animations);reset();draw();
  $('#loading').hidden=true;document.querySelectorAll('button,select').forEach(control=>control.disabled=false);requestAnimationFrame(frame);
}catch(error){$('#loading').hidden=true;$('#error').hidden=false;$('#error').textContent=`演示加载失败：${error.message}`;console.error(error);}
