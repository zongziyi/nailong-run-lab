import {readFile,access} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=(await Promise.all(['main.js','leaderboard-ui.js'].map(file=>readFile(new URL(`../src/${file}`,import.meta.url),'utf8')))).join('\n');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
for(const file of ['../src/unicloud-transport.js','../uniCloud-aliyun/cloudfunctions/nailong-leaderboard/index.js']){
  execFileSync(process.execPath,['--check',fileURLToPath(new URL(file,import.meta.url))]);
}
assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs');
for(const match of source.matchAll(/\$\('#([^']+)'\)/g))assert.ok(ids.includes(match[1]),`Missing DOM control: ${match[1]}`);
for(const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g))await access(new URL(`../${match[1].slice(2)}`,import.meta.url));
for(const name of ['Clock','WebGLRenderer','InstancedMesh'])assert.equal(typeof THREE[name],'function');
assert.equal(typeof GLTFLoader,'function');assert.equal(typeof OrbitControls,'function');
const expectedClips=['Idle','Run','Jump','Slide'];
const data=await readFile(new URL('../assets/nailong-rounded.glb',import.meta.url));
const gltf=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString('utf8'));
assert.deepEqual(gltf.animations.map(a=>a.name).sort(),expectedClips.sort());
console.log(`Page/module checks PASS · ${ids.length} unique controls · Three.js r${THREE.REVISION} · 4 embedded clips`);
