import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {leaderboardConfig} from '../src/leaderboard-config.js';
import {validateConfig} from '../src/leaderboard.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const boardConfig=process.env.UNICLOUD_ENDPOINT?
  {provider:'unicloud',spaceId:process.env.UNICLOUD_SPACE_ID||leaderboardConfig.spaceId,endpoint:process.env.UNICLOUD_ENDPOINT}:
  process.env.SUPABASE_URL||process.env.SUPABASE_PUBLISHABLE_KEY?
    {provider:'supabase',url:process.env.SUPABASE_URL??'',publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY??''}:leaderboardConfig;
validateConfig(boardConfig);
const output=path.resolve(root,'dist');
if(path.relative(root,output)!=='dist')throw new Error('Build output must stay inside the project dist directory');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const copy=async(source,destination=source)=>{
  const target=path.join(output,destination);await mkdir(path.dirname(target),{recursive:true});
  await cp(path.join(root,source),target,{recursive:true});
};

await copy('src');
await writeFile(path.join(output,'src/leaderboard-config.js'),`export const leaderboardConfig = ${JSON.stringify(boardConfig)};\n`);
const boardClient=await readFile(path.join(root,'src/leaderboard.js'),'utf8');
await writeFile(path.join(output,'src/leaderboard.js'),boardClient.replaceAll(
  '../node_modules/@supabase/supabase-js/dist/umd/supabase.js','../vendor/supabase/supabase.js'));
await copy('node_modules/@supabase/supabase-js/dist/umd/supabase.js','vendor/supabase/supabase.js');
await copy('node_modules/@supabase/supabase-js/LICENSE','vendor/supabase/LICENSE');
await copy('assets/nailong-rounded.glb');
await copy('assets/audio/SOURCE.md');
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
