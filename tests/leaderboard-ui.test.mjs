import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {LeaderboardUI} from '../src/leaderboard-ui.js';
import {LeaderboardClient} from '../src/leaderboard.js';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const row=(code,name='Runner',rank=1)=>({player_code:code,nickname:name,rank,distance:123});
let dom;
afterEach(()=>{dom?.window.close();delete globalThis.window;delete globalThis.document;});
function setup(clientOverride){
  dom=new JSDOM(html,{url:'https://game.example.test/'});globalThis.window=dom.window;globalThis.document=dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  const calls=[];
  const state={enabled:true,nickname:'Runner',playerCode:'own-code',pending:{},statuses:{},persistent:true};
  const client=clientOverride??{enabled:true,nickname:'Runner',snapshot:()=>({...state}),flush:async()=>{},setName:async()=>{},recordRun:run=>calls.push({...run}),page:async()=>({entries:[],has_more:false,me:null})};
  const ui=new LeaderboardUI({getMode:()=>'normal',client});return {ui,client,state,calls,dialog:ui.dialog};
}
test('three entrypoints open the selected mode and close restores focus',async()=>{
  const {ui,dialog}=setup();const entries=[...document.querySelectorAll('[data-leaderboard-open]')];assert.equal(entries.length,3);
  entries[0].click();await settle();assert.equal(ui.isOpen,true);assert.equal(ui.mode,'normal');
  assert.equal(dialog.querySelector('[data-board-mode="normal"]').getAttribute('aria-pressed'),'true');
  dialog.querySelector('[data-close]').click();assert.equal(ui.isOpen,false);assert.equal(document.activeElement,entries[0]);
});
test('server nicknames are rendered as text, same-name player codes stay distinct and self is highlighted',async()=>{
  const {ui,client,dialog}=setup();client.page=async()=>({entries:[row('own-code','<img src=x>'),row('other-code','<img src=x>',2)],has_more:false,me:{player_code:'own-code',distance:123,rank:1}});
  ui.open();await settle();assert.equal(dialog.querySelectorAll('img').length,0);
  assert.match(dialog.querySelector('[data-board-list]').textContent,/<img src=x>/);
  assert.equal(dialog.querySelectorAll('.board-self').length,1);assert.equal(dialog.querySelectorAll('.board-row').length,2);
  assert.match(dialog.querySelector('[data-my-best]').textContent,/一条命.*123.*1/);
});
test('switching mode ignores an old response; continuation keeps global ranks',async()=>{
  const {ui,client,dialog}=setup();const slow=deferred();client.page=mode=>mode==='normal'?slow.promise:Promise.resolve({entries:[row('new-mode')],has_more:true,me:null});
  ui.open();dialog.querySelector('[data-board-mode="fast"]').click();await settle();
  slow.resolve({entries:[row('stale')],has_more:false,me:null});await settle();assert.match(dialog.querySelector('.board-player').title,/new-mode/);
  client.page=async(mode,offset)=>{assert.equal(mode,'fast');assert.equal(offset,1);return {entries:[row('next-page','Next',21)],has_more:false,me:null};};
  dialog.querySelector('[data-more]').click();await settle();assert.equal(dialog.querySelectorAll('.board-row').length,2);
  assert.equal(dialog.querySelectorAll('.board-rank')[1].textContent,'21');
});
test('disabled cloud is explicit and failed reads offer retry without inventing local entries',async()=>{
  const {ui,client,state,dialog}=setup();state.enabled=false;client.enabled=false;ui.renderState(state);ui.open();await settle();
  assert.match(dialog.querySelector('[data-board-status]').textContent,/尚未启用/);assert.equal(dialog.querySelector('input').disabled,false);
  assert.equal(dialog.querySelectorAll('.board-row').length,0);
  state.enabled=true;client.enabled=true;client.page=async()=>{throw new Error('Offline');};await ui.load();
  assert.match(dialog.querySelector('[data-board-status]').textContent,/点击刷新/);
});
test('nickname can be entered and locally saved before cloud setup, then restored when the panel reopens',async()=>{
  const values=new Map();let loads=0;
  const client=new LeaderboardClient({config:{url:'',publishableKey:''},loadSDK:async()=>{loads++;},getStorage:()=>({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)})});
  const {ui,dialog}=setup(client);ui.open();await settle();
  const input=dialog.querySelector('input'),button=dialog.querySelector('form button');
  assert.equal(input.disabled,false);assert.equal(button.disabled,false);assert.equal(button.textContent,'暂存昵称');
  input.value=' 鱼叉 ';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.equal(input.value,'鱼叉');assert.match(dialog.querySelector('[data-name-message]').textContent,/暂存/);
  assert.match(dialog.querySelector('[data-identity-note]').textContent,/暂时不会上榜/);assert.equal(client.nickname,'');assert.equal(loads,0);
  dialog.close();input.value='';ui.open();assert.equal(input.value,'鱼叉');
});
test('gameover integration captures only the normal ending once and keeps Enter inside the dialog',async()=>{
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(source,/if\(ended&&!displayedGameOver\)\{\s*leaderboardUI\.recordRun\(\{mode:runner\.maxLives,speedMode:runner\.speedMode,distance:Math\.floor\(runner\.distance\)\}/);
  assert.match(source,/window\.addEventListener\('keydown',e=>\{\s*if\(leaderboardUI\.isOpen\)return;/);
  const {ui,calls}=setup();const run={mode:1,distance:120};ui.recordRun(run);run.distance=0;
  assert.deepEqual(calls,[{mode:1,distance:120}]);
});


test('three-life results never enter the client queue and asynchronous status changes preserve the explanation',()=>{
  const {ui,calls,state}=setup();ui.recordRun({mode:3,speedMode:'fast',distance:900});
  assert.equal(calls.length,0);assert.equal(document.querySelector('#leaderboard-result').textContent,'三条命不参与排行榜');
  state.statuses.fast='旧成绩已同步';ui.client.onChange(state,'submitted');
  assert.equal(document.querySelector('#leaderboard-result').textContent,'三条命不参与排行榜');
  ui.recordRun({mode:1,speedMode:'fast',distance:100});assert.deepEqual(calls,[{mode:1,speedMode:'fast',distance:100}]);
});
