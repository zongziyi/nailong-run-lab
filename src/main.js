import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RunnerController} from './controller.js';
import {RunnerAnimation} from './runner-animation.js';
import {GAME} from './game-config.js';
import {ObstacleRenderer} from './obstacle-renderer.js';
import {bodyStart,obstacleEnd,frontAt,passageWindow} from './obstacles.js';

const $=s=>document.querySelector(s);
const stage=$('#stage'),viewport=$('#viewport');
const runner=new RunnerController();
// A fresh page always starts with three lives, including restored form state.
const lifeModeInputs=[...document.querySelectorAll('input[name="life-mode"]')];
lifeModeInputs.forEach(input=>{input.checked=input.defaultChecked;});
const lifeModeLabel=()=>runner.maxLives===1?'一条命':'三条命';
const labels={Idle:'元气待机',Run:'奔跑中',Jump:'腾空中',Slide:'滑铲！',Dive:'下铲中！'};
let renderer, model, animator, loaded=false;
let displayedLives=-1,displayedGameOver=false;
let cameraFollowHeight=0;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(34,1,.1,160);
const clock=new THREE.Clock();
try {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
  viewport.append(renderer.domElement);
} catch(e) { fail('浏览器暂时无法启动 3D 画面。请尝试更新浏览器或开启硬件加速。',e); }
const orbit=renderer?new OrbitControls(camera,renderer.domElement):null;
if(orbit){orbit.enableDamping=true;orbit.enablePan=false;orbit.minDistance=6;orbit.maxDistance=12;orbit.minPolarAngle=.65;orbit.maxPolarAngle=1.68;orbit.addEventListener('start',()=>document.querySelectorAll('[data-angle]').forEach(b=>b.classList.remove('active')));}
const hemi=new THREE.HemisphereLight(0xfff8d8,0x6e8471,1.6);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffeac0,3.4);sun.position.set(-3,7,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.normalBias=.03;scene.add(sun);scene.add(sun.target);
const rim=new THREE.DirectionalLight(0xd7ece7,2);rim.position.set(4,5,-3);scene.add(rim);
const preview=new THREE.Group(), railway=new THREE.Group();scene.add(preview,railway);railway.visible=false;
const material=(color,roughness=.85)=>new THREE.MeshStandardMaterial({color,roughness,metalness:0});
const mats={cream:material('#ddd3b8'),floor:material('#efe6d0'),track:material('#233e43'),rail:material('#869c99',.45),sleeper:material('#715b46'),dark:material('#122c37'),train:material('#315856'),trim:material('#b4c0a4'),roof:material('#214744'),post:material('#52605a'),gold:material('#d5aa63'),lantern:material('#e66e3d')};
const plane=new THREE.Mesh(new THREE.PlaneGeometry(200,200),mats.floor);plane.rotation.x=-Math.PI/2;plane.position.y=-.16;plane.receiveShadow=true;preview.add(plane);
const podium=new THREE.Mesh(new THREE.CylinderGeometry(2.05,2.1,.14,96),mats.cream);podium.position.y=-.08;podium.receiveShadow=true;preview.add(podium);
const ring=new THREE.Mesh(new THREE.TorusGeometry(1.99,.012,8,100),material('#b5b49c'));ring.rotation.x=-Math.PI/2;ring.position.y=.005;preview.add(ring);
const grid=new THREE.GridHelper(100,100,'#d6cdb5','#ddd5c1');grid.position.y=-.15;grid.material.transparent=true;grid.material.opacity=.28;preview.add(grid);
function box(w,h,d,mat,x,y,z,parent){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.receiveShadow=true;parent.add(m);return m;}
const road=new THREE.Mesh(new THREE.PlaneGeometry(32,200),mats.track);road.rotation.x=-Math.PI/2;road.position.set(0,-.07,-60);road.receiveShadow=true;railway.add(road);
// Repeat short, fixed-size track sections instead of allocating new meshes while running.
const trackSections=[];
for(let section=0;section<12;section++){
  const group=new THREE.Group();group.position.z=-section*10;railway.add(group);trackSections.push(group);
  for(let lane=-1;lane<=1;lane++){
    for(const side of [-1,1])box(.08,.065,10,mats.rail,lane*GAME.laneSpacing+side*.63,.01,0,group);
    for(let i=0;i<9;i++)box(1.65,.07,.17,mats.sleeper,lane*GAME.laneSpacing,-.015,-4.5+i*1.1,group);
  }
  for(const side of [-1,1]){
    box(.18,.22,10,mats.trim,side*3.75,.02,0,group);
    box(1.8,.12,10,mats.post,side*4.8,-.015,0,group);
  }
}
const scenery=[];
for(let i=0;i<9;i++){
  const g=new THREE.Group();g.position.z=-i*14;railway.add(g);scenery.push(g);
  for(const side of [-1,1]){
    box(.16,10.2,.16,mats.post,side*5.6,5,0,g);
    box(12,.14,.18,mats.post,0,10,0,g);
    const lantern=new THREE.Mesh(new THREE.SphereGeometry(.36,12,10),mats.lantern);lantern.scale.y=1.25;lantern.position.set(side*4.6,9.2,0);g.add(lantern);
    box(.23,.07,.23,mats.gold,side*4.6,9.69,0,g);box(.025,.35,.025,mats.gold,side*4.6,8.60,0,g);
    const b=box(2.5,5.5+(i%3),7,mats.dark,side*(9+i%2*2),2.5,-2,g);
    for(let window=0;window<3;window++)box(.035,.65,.7,mats.gold,side*(7.73+i%2*2),2.5,window*1.6-3,g);
  }
}
const trains=[];
for(const [side,z] of [[-1,-14],[1,-45],[-1,-80],[1,-108]]){
  const g=new THREE.Group();g.position.set(side*6.8,0,z);railway.add(g);trains.push({group:g,base:z});
  box(2.2,2.9,12,mats.train,0,1.65,0,g);box(2.3,.25,12.1,mats.roof,0,3.2,0,g);
  box(2.24,.1,12,mats.trim,0,.65,0,g);
  const windowMat=new THREE.MeshStandardMaterial({color:'#f4c97c',emissive:'#c88537',emissiveIntensity:.6,roughness:.5});
  for(let j=0;j<6;j++)box(.04,.9,1.05,windowMat,-side*1.12,2.25,-4.7+j*1.8,g);
}
// Batch repeated sleepers, rails, and windows per moving section. The sections
// themselves still move independently, but hundreds of boxes become a few draws.
railway.traverse(group=>{
  if(!group.isGroup)return;
  const batches=new Map();
  for(const child of [...group.children]){
    if(!child.isMesh || child.geometry.type!=='BoxGeometry')continue;
    const p=child.geometry.parameters,key=[p.width,p.height,p.depth,child.material.uuid].join('/');
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push(child);
  }
  for(const meshes of batches.values()){
    if(meshes.length<2)continue;
    const instanced=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.length);instanced.receiveShadow=true;
    meshes.forEach((mesh,index)=>{mesh.updateMatrix();instanced.setMatrixAt(index,mesh.matrix);group.remove(mesh);if(index)mesh.geometry.dispose();});
    instanced.instanceMatrix.needsUpdate=true;instanced.computeBoundingSphere();group.add(instanced);
  }
});
const obstacleVisuals=new ObstacleRenderer(railway);
const trafficArrows=[-1,0,1].map(lane=>{
  const group=new THREE.Group();group.position.x=lane*GAME.laneSpacing;railway.add(group);
  const paint=new THREE.MeshBasicMaterial({color:'#ff5f50',transparent:true,opacity:.9,depthWrite:false});
  const geometry=new THREE.BoxGeometry(.50,.025,.10);
  for(const z of [-12,-13.5,-15])for(const side of [-1,1]){
    const mesh=new THREE.Mesh(geometry,paint);mesh.position.set(side*.18,.065,z);mesh.rotation.y=side*.6;group.add(mesh);
  }
  group.visible=false;return {lane,group,paint};
});
const actor=new THREE.Group();scene.add(actor);
const shield=new THREE.Mesh(new THREE.TorusGeometry(1.23,.026,8,72),
  new THREE.MeshBasicMaterial({color:'#f1dc85',transparent:true,opacity:.65,depthWrite:false}));
shield.rotation.x=-Math.PI/2;shield.position.y=.09;shield.visible=false;actor.add(shield);
function resize(){if(!renderer)return;const {width,height}=viewport.getBoundingClientRect();if(!width||!height)return;const oldFactor=Math.max(1.08,.56/camera.aspect);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();if(loaded&&runner.mode==='inspect'){const newFactor=Math.max(1.08,.56/camera.aspect);camera.position.sub(orbit.target).multiplyScalar(newFactor/oldFactor).add(orbit.target);orbit.update();}}
new ResizeObserver(resize).observe(viewport);
function setAngle(angle='threequarter'){
  if(!orbit)return;
  const pos={front:[0,2.5,9.2],side:[9.2,2.5,0],back:[0,2.5,-9.2],threequarter:[4,2.7,8.3]}[angle];
  camera.fov=34;camera.updateProjectionMatrix();orbit.target.set(0,.35,0);
  const distanceFactor=Math.max(1.08,.56/camera.aspect);
  camera.position.set(pos[0]*distanceFactor,.35+(pos[1]-.65)*distanceFactor,pos[2]*distanceFactor);orbit.update();
}
function setMode(mode){
  if(!loaded)return;
  const running=mode==='run';
  if(running){
    const maxLives=runner.mode==='inspect'?Number(lifeModeInputs.find(input=>input.checked).value):runner.maxLives;
    runner.start({maxLives});
  }else runner.inspect();
  obstacleVisuals.reset();shield.visible=false;displayedLives=-1;displayedGameOver=false;
  trafficArrows.forEach(a=>a.group.visible=false);
  cameraFollowHeight=0;touch=null;
  preview.visible=!running;railway.visible=running;
  stage.classList.toggle('running',running);$('#inspect-ui').hidden=running;$('#run-ui').hidden=!running;$('#pause').hidden=!running;$('#model-tag').hidden=running;
  $('#life-mode').disabled=running;
  $('#mode-label').textContent=running?`障碍挑战 · ${lifeModeLabel()}`:'角色观察';$('#view-model').classList.toggle('active',!running);
  $('#run-hud').hidden=!running;
  scene.background=new THREE.Color(running?'#173442':'#eee6d4');scene.fog=running?new THREE.Fog('#173442',24,95):new THREE.Fog('#eee6d4',16,50);
  hemi.intensity=running?1.9:1.6;sun.intensity=running?2.3:2.5;rim.intensity=running?1.6:1.2;
  orbit.enabled=!running;
  actor.position.set(0,0,0);actor.rotation.set(0,running?Math.PI:0,0);
  model.scale.setScalar(running?GAME.characterScale:1);shield.scale.setScalar(GAME.characterScale);
  sun.position.y=7;sun.target.position.y=0;rim.position.y=5;
  if(running){$('#start').blur();camera.fov=50;camera.updateProjectionMatrix();camera.position.set(0,4.4,8.6);camera.lookAt(0,1.35,-3.7);}
  else setAngle();
  animator.reset(runner);syncUI();
}
function syncUI(){
  const ended=runner.gameOver;
  $('#pause-overlay').hidden=!runner.paused||ended;
  $('#gameover-overlay').hidden=!ended;
  $('#pause').disabled=ended;$('#pause').textContent=runner.paused?'▶':'Ⅱ';
  $('#pause').setAttribute('aria-label',runner.paused?'继续试玩':'暂停试玩');
  const setText=(selector,value)=>{const node=$(selector);if(node.textContent!==value)node.textContent=value;};
  if(displayedLives!==runner.lives){
    $('#lives').setAttribute('aria-label',`剩余 ${runner.lives} 条命`);
    document.querySelectorAll('[data-heart]').forEach((heart,index)=>{
      heart.hidden=index>=runner.maxLives;
      heart.classList.toggle('lost',index>=runner.lives);
    });
    setText('#lives-count',`${runner.lives} / ${runner.maxLives}`);displayedLives=runner.lives;
  }
  setText('#distance',String(Math.floor(runner.distance)).padStart(4,'0'));
  setText('#speed',`${(runner.speed/GAME.speed).toFixed(2)}×`);
  setText('#final-distance',String(Math.floor(runner.distance)));
  setText('#gameover-message',`${lifeModeLabel()}已用完 · 本次跑过`);
  const warming=runner.mode==='run'&&runner.elapsed<GAME.warmupSeconds;
  setText('#action-label',ended?'本局结束':warming&&runner.action==='Run'?`准备出发 · ${Math.ceil(GAME.warmupSeconds-runner.elapsed)}`:
    runner.action==='Run'&&runner.supportType==='roof'?'车顶奔跑':runner.action==='Run'&&runner.supportType==='ramp'?'沿坡登车':labels[runner.action]);
  $('#protection').hidden=runner.invincibleRemaining<=0||ended;
  setText('#protection-time',`${runner.invincibleRemaining.toFixed(1)}s`);
  const warnings=runner.mode==='run'&&!ended?runner.course.warnings(runner.elapsed):[];
  $('#traffic-warning').hidden=!warnings.length;
  if(warnings.length)setText('#traffic-warning',`⚠ ${warnings.map(w=>['左道','中道','右道'][w.lane+1]).join('、')}来车 · 提前换道`);
  const hurt=runner.elapsed-runner.lastDamageAt<.75&&!ended;
  $('#hit-message').hidden=!hurt;
  if(hurt)setText('#hit-message',`撞到${runner.lastDamageLabel}，剩余 ${runner.lives} 条命`);
  stage.classList.toggle('hurt',runner.hitFeedback>0&&!ended);
  if(ended&&!displayedGameOver)$('#restart').focus({preventScroll:true});
  displayedGameOver=ended;
}
function fail(message,error){window.nailongBoot?.fail(message,error);const loader=$('#loader');loader.hidden=false;loader.querySelector('.loading-ring').hidden=true;loader.querySelector('b').textContent='暂时没能见到奶龙';loader.querySelector('small').textContent=message;$('#retry').hidden=false;console.error(error||message);}
async function load(){
  if(!renderer)return;
  try{
    window.nailongBoot?.phase('正在加载奶龙模型与动作…');
    const gltf=await new GLTFLoader().loadAsync('./assets/nailong-rounded.glb',event=>{
      window.nailongBoot?.phase(event.total?`正在加载奶龙：${Math.floor(event.loaded/event.total*100)}%`:
        `正在加载奶龙：已读取 ${(event.loaded/1024/1024).toFixed(1)} MB`);
    });
    model=gltf.scene;
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    actor.add(model);animator=new RunnerAnimation(model,gltf.animations);
    loaded=true;setMode('inspect');window.nailongBoot?.ready();$('#loader').hidden=true;$('#start').disabled=false;
  }catch(e){fail('模型或动作加载失败。请通过本地启动服务打开，并检查 assets/nailong-rounded.glb 文件是否存在。',e);}
}
$('#start').addEventListener('click',()=>setMode('run'));
$('#view-model').addEventListener('click',()=>setMode('inspect'));
$('#inspect-overlay').addEventListener('click',()=>setMode('inspect'));
$('#restart').addEventListener('click',()=>setMode('run'));
$('#gameover-inspect').addEventListener('click',()=>setMode('inspect'));
$('#pause').addEventListener('click',()=>{runner.togglePause();syncUI();});
$('#resume').addEventListener('click',()=>{runner.togglePause();syncUI();});
for(const id of ['#reset','#reset-overlay'])$(id).addEventListener('click',()=>setMode(runner.mode));
document.querySelectorAll('[data-angle]').forEach(b=>b.addEventListener('click',()=>{setAngle(b.dataset.angle);document.querySelectorAll('[data-angle]').forEach(a=>a.classList.toggle('active',a===b));}));
function input(command){if(runner.input(command))animator.update(runner,0);syncUI();}
document.querySelectorAll('[data-input]').forEach(b=>b.addEventListener('click',()=>input(b.dataset.input)));
const keyMap={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'jump',KeyW:'jump',Space:'jump',ArrowDown:'slide',KeyS:'slide'};
window.addEventListener('keydown',e=>{
  if(runner.mode==='run'&&runner.gameOver){
    if(e.code==='Enter'&&!e.repeat){e.preventDefault();setMode('run');}
    else if(keyMap[e.code]&&!(e.code==='Space'&&e.target.closest?.('button')))e.preventDefault();
    return;
  }
  if(e.target.closest?.('button,a,input,textarea,select') && ['Space','Enter'].includes(e.code))return;
  if(runner.mode==='run' && (keyMap[e.code] || e.code==='Escape')){e.preventDefault();if(e.repeat)return;if(e.code==='Escape'){runner.togglePause();syncUI();}else input(keyMap[e.code]);}
});
let touch=null;
viewport.addEventListener('pointerdown',e=>{if(runner.mode==='run' && !runner.paused && !runner.gameOver)touch={id:e.pointerId,x:e.clientX,y:e.clientY};});
viewport.addEventListener('pointerup',e=>{if(!touch || e.pointerId!==touch.id)return;const dx=e.clientX-touch.x,dy=e.clientY-touch.y;touch=null;if(Math.max(Math.abs(dx),Math.abs(dy))<24)return;input(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'slide':'jump'));});
viewport.addEventListener('pointercancel',()=>touch=null);
const autoPause=()=>{touch=null;runner.pause();syncUI();};
window.addEventListener('blur',autoPause);document.addEventListener('visibilitychange',()=>{if(document.hidden)autoPause();});
// A read-only snapshot makes QA reproducible without mutating gameplay from the console.
window.nailongDemo={snapshot:()=>({loaded,mode:runner.mode,paused:runner.paused,lane:runner.lane,x:runner.x,y:runner.y,
  action:runner.action,elapsed:runner.elapsed,distance:runner.distance,lives:runner.lives,maxLives:runner.maxLives,gameOver:runner.gameOver,
  speed:runner.speed,verticalVelocity:runner.verticalVelocity,grounded:runner.grounded,supportType:runner.supportType,supportId:runner.supportId,
  jumpSourceId:runner.jumpSourceId,actionTime:runner.actionTime,actionSerial:runner.actionSerial,slideFromDive:runner.slideFromDive,
  invincibleRemaining:runner.invincibleRemaining,damageSerial:runner.damageSerial,
  obstacles:runner.course.active.map(o=>({id:o.id,kind:o.kind,lane:o.lane,frontDistance:o.frontDistance,hasRamp:o.hasRamp,
    currentFrontDistance:frontAt(o,runner.elapsed),arrivalTime:o.arrivalTime,motionSpeed:o.motionSpeed,
    baseHeight:o.baseHeight,parentId:o.parentId,eta:passageWindow(o).start-runner.elapsed,
    bodyStartDistance:bodyStart(o,runner.elapsed),endDistance:obstacleEnd(o,runner.elapsed),hit:o.hit})),
  trafficWarnings:runner.course.warnings(runner.elapsed).map(w=>({...w})),
  routeCommands:runner.course.safeCommands.map(c=>({...c})),
  obstaclePool:obstacleVisuals.stats(),animations:Object.keys(animator?.actions??{}),triangles:renderer?.info.render.triangles})};
function animate(){
  if(!renderer)return;
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),GAME.maxFrameSeconds);
  if(loaded){
    const elapsedBefore=runner.elapsed;
    runner.update(dt);
    if(runner.mode==='run'){
      const wobble=runner.hitFeedback>0?Math.sin((runner.elapsed-runner.lastDamageAt)*42)*.07*runner.hitFeedback:0;
      actor.position.set(runner.x,runner.y,0);actor.rotation.z=runner.lean+wobble;
      if(!runner.paused&&!runner.gameOver)cameraFollowHeight+=(runner.y-cameraFollowHeight)*(1-Math.exp(-dt*7));
      camera.position.set(runner.x*.78,4.4+cameraFollowHeight,8.6);camera.lookAt(camera.position.x,1.35+cameraFollowHeight,-3.7);
      sun.position.y=7+cameraFollowHeight;sun.target.position.y=cameraFollowHeight;rim.position.y=5+cameraFollowHeight;
      camera.far=Math.max(160,runner.speed*8);camera.updateProjectionMatrix();
      scene.fog.near=Math.max(24,runner.speed*2.7);scene.fog.far=Math.max(95,runner.speed*6.5);
      const distance=runner.distance;
      const stretch=Math.max(1,(runner.speed*GAME.lookAheadSeconds+20)/110);
      road.scale.y=stretch;
      trackSections.forEach((g,i)=>{g.scale.z=stretch;g.position.z=((distance-i*10*stretch+110*stretch)%(120*stretch)+120*stretch)%(120*stretch)-110*stretch;});
      scenery.forEach((g,i)=>g.position.z=((distance-i*14*stretch+110*stretch)%(126*stretch)+126*stretch)%(126*stretch)-110*stretch);
      trains.forEach(({group,base})=>group.position.z=((distance+base+115)%145+145)%145-115);
      obstacleVisuals.sync(runner.course,distance,runner.elapsed);
      const incoming=runner.gameOver?[]:runner.course.warnings(runner.elapsed);
      trafficArrows.forEach(a=>{a.group.visible=incoming.some(w=>w.lane===a.lane);a.paint.opacity=.7+.25*Math.sin(runner.elapsed*9);});
      shield.visible=runner.invincibleRemaining>0&&!runner.gameOver;
      if(shield.visible){shield.scale.setScalar(GAME.characterScale*(1+Math.sin(runner.elapsed*7)*.025));shield.material.opacity=.56+Math.sin(runner.elapsed*7)*.10;}
      animator.update(runner,runner.elapsed-elapsedBefore);
      syncUI();
    }else{animator.update(runner,dt);orbit.update();}
  }
  renderer.render(scene,camera);
}
resize();setAngle();load();animate();
