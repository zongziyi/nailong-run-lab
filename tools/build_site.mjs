import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(root,'dist');
if(path.relative(root,output)!=='dist')throw new Error('Build output must stay inside the project dist directory');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const copy=async(source,destination=source)=>{
  const target=path.join(output,destination);await mkdir(path.dirname(target),{recursive:true});
  await cp(path.join(root,source),target,{recursive:true});
};

await copy('src');
await copy('assets/nailong-rounded.glb');
const pages=['index.html','comparison.html','action-review.html'];
for(const page of pages){
  const source=await readFile(path.join(root,page),'utf8');
  await writeFile(path.join(output,page),source.replaceAll('./node_modules/three/','./vendor/three/'));
  for(const match of source.matchAll(/(?:src|href)="(\.\/(?:assets|artifacts)\/[^"?#]+)"/g))await copy(match[1].slice(2));
}
// Ship the locked WebGL runtime and the loaders' full static dependency graph,
// without depending on a CDN or exposing development tools and model sources.
for(const file of ['build/three.module.js','build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js','examples/jsm/controls/OrbitControls.js',
  'examples/jsm/utils/BufferGeometryUtils.js','examples/jsm/utils/SkeletonUtils.js','LICENSE']){
  await copy(`node_modules/three/${file}`,`vendor/three/${file}`);
}
await writeFile(path.join(output,'.nojekyll'),'');
console.log('Static site built in dist/ with local Three.js, model and review assets.');
