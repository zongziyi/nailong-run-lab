import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=new URL('../',import.meta.url),output=new URL('dist/',root);
execFileSync(process.execPath,['tools/build_site.mjs'],{cwd:fileURLToPath(root)});
const read=file=>readFileSync(new URL(file,output),'utf8');
const base=new URL('https://example.test/nailong-run-lab/');
const imports=JSON.parse(read('index.html').match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports;

function shipped(url){
  assert.equal(url.origin,base.origin,'Site resources must use the same origin');
  assert.ok(url.pathname.startsWith(base.pathname),'Resource escaped the GitHub project subpath');
  const relative=url.pathname.slice(base.pathname.length);
  assert.ok(existsSync(new URL(relative,output)),`Missing published file: ${relative}`);return relative;
}

test('published pages resolve every linked asset under a GitHub Pages project subpath',()=>{
  for(const page of ['index.html','comparison.html','action-review.html']){
    const html=read(page);assert.ok(!html.includes('node_modules/'));
    for(const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]*)"/g)){
      shipped(new URL(match[1],new URL(page,base)));
    }
  }
  const model=readFileSync(new URL('assets/nailong-rounded.glb',output));
  assert.equal(model.readUInt32LE(0),0x46546c67);assert.ok(model.length>3_000_000);
  const music=readFileSync(new URL('assets/audio/subway-surfers-main-theme.mp3',output));
  assert.ok(music.length>3_000_000,'Published music must contain the full track');
  assert.match(read('assets/audio/SOURCE.md'),/SYBO ApS/);
});

test('the shipped game and review module graphs need no node_modules or external CDN',()=>{
  const seen=new Set();
  function visit(url){
    const file=shipped(url);if(seen.has(file))return;seen.add(file);
    const module=new vm.SourceTextModule(read(file));
    for(const specifier of module.dependencySpecifiers){
      let target;
      if(specifier==='three')target=new URL(imports.three,base);
      else if(specifier.startsWith('three/addons/'))target=new URL(imports['three/addons/']+specifier.slice('three/addons/'.length),base);
      else{assert.ok(specifier.startsWith('.'),`Unexpected module: ${specifier}`);target=new URL(specifier,url);}
      visit(target);
    }
  }
  visit(new URL('src/main.js',base));visit(new URL('src/action-review.js',base));
  assert.ok(seen.has('vendor/three/build/three.core.js'));
  assert.ok(seen.has('vendor/three/examples/jsm/utils/SkeletonUtils.js'));
});

test('the deployment artifact excludes private development files and preserves the Three.js license',()=>{
  const files=readdirSync(output,{recursive:true}).map(file=>String(file).replaceAll('\\','/'));
  assert.ok(files.includes('vendor/three/LICENSE'));
  assert.ok(!files.some(file=>/(?:^|[\\/])(?:\.git|node_modules|tests|tools|source)(?:[\\/]|$)|\.blend$/.test(file)));
});
