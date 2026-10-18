import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

let db;
const sql=await readFile(new URL('../supabase/leaderboard.sql',import.meta.url),'utf8');
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(sql);
});
after(async()=>await db?.close());
beforeEach(async()=>{
  await db.exec('reset role; truncate auth.users cascade;');
  await db.query('insert into auth.users(id) values ($1),($2)',[alice,bob]);
  await identity('authenticated',alice);
});
async function identity(role,id=''){
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
}
async function name(value){return (await db.query('select public.set_runner_name($1) as result',[value])).rows[0].result;}
async function submit(mode,distance){return (await db.query('select public.submit_runner_score($1::smallint,$2::bigint) as result',[mode,distance])).rows[0].result;}
async function page(mode=3,offset=0,limit=20){return (await db.query('select public.runner_leaderboard($1::smallint,$2,$3) as result',[mode,offset,limit])).rows[0].result;}
async function me(mode=3){return (await db.query('select public.runner_personal_best($1::smallint) as result',[mode])).rows[0].result;}

test('real SQL keeps the maximum independently for each mode, even with overlapping submissions',async()=>{
  await name('鱼叉');await submit(3,200);
  await Promise.all([submit(3,100),submit(3,500),submit(3,350),submit(3,500),submit(1,80)]);
  assert.equal((await me(3)).distance,500);assert.equal((await me(1)).distance,80);
  const first=(await page()).entries[0].achieved_at;
  assert.deepEqual(await submit(3,500),{distance:500,improved:false});
  assert.equal((await page()).entries[0].achieved_at,first);
  assert.equal((await submit(3,600)).improved,true);
});
test('duplicate nicknames remain separate; renaming keeps identity and both records',async()=>{
  const a=await name('奶龙');await submit(3,500);await submit(1,20);
  await identity('authenticated',bob);const b=await name('奶龙');await submit(3,250);
  assert.notEqual(a.player_code,b.player_code);assert.equal((await page()).entries.length,2);
  await name('新名字');assert.equal((await me()).distance,250);
  await identity('authenticated',alice);assert.equal((await me()).distance,500);assert.equal((await me(1)).distance,20);
});
test('visitors read only public fields; table writes and other authenticated RPCs are denied',async()=>{
  await name('Alice');await submit(3,123);
  await assert.rejects(db.exec('update public.runner_records set distance=9999'),/permission denied/);
  await assert.rejects(db.exec('select * from public.runner_players'),/permission denied/);
  await identity('anon');const board=await page();assert.equal(board.entries[0].distance,123);
  assert.deepEqual(Object.keys(board.entries[0]).sort(),['achieved_at','distance','nickname','player_code','rank']);
  await assert.rejects(name('Imposter'),/permission denied/);
  await assert.rejects(submit(3,999),/permission denied/);
  await assert.rejects(me(),/permission denied/);
  await identity('authenticated');await assert.rejects(name('No session'),/Authentication required/);
});
test('empty board and profile without a score work; invalid modes, names and values are rejected',async()=>{
  assert.deepEqual(await page(),{entries:[],has_more:false});assert.equal(await me(),null);
  await assert.rejects(submit(3,10),/nickname/);
  for(const bad of ['',null,'a'.repeat(17),'bad\nname'])await assert.rejects(name(bad),/Nickname/);
  await name('  鱼叉  ');assert.equal((await me()).nickname,'鱼叉');assert.equal((await me()).rank,null);
  for(const [mode,distance] of [[2,1],[3,-1],[3,null],[null,1],[3,'9007199254740992']])await assert.rejects(submit(mode,distance),/Invalid/);
  await assert.rejects(page(2),/Invalid/);await assert.rejects(page(3,-1),/Invalid/);await assert.rejects(page(3,0,21),/Invalid/);
});
test('competition ranks, achievement order and pagination are calculated over the full board',async()=>{
  await name('First');await submit(3,900);
  await identity('authenticated',bob);await name('Second');await submit(3,900);
  await identity('postgres');
  for(let i=3;i<=23;i++){
    const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    await db.query('insert into auth.users(id) values ($1)',[id]);
    await db.query('insert into public.runner_players(user_id,nickname) values ($1,$2)',[id,`Player ${i}`]);
    await db.query('insert into public.runner_records(user_id,mode,distance) values ($1,3,$2)',[id,900-i]);
  }
  await identity('anon');const first=await page(),second=await page(3,20);
  assert.equal(first.entries.length,20);assert.equal(first.has_more,true);assert.equal(second.entries.length,3);assert.equal(second.has_more,false);
  assert.deepEqual(first.entries.slice(0,3).map(row=>row.rank),[1,1,3]);
  assert.deepEqual(first.entries.slice(0,2).map(row=>row.nickname),['First','Second']);
  assert.equal(second.entries[0].rank,21);
});
test('schema can be reinstalled without erasing scores; anonymous account deletion cascades intentionally',async()=>{
  await name('Keep me');await submit(3,321);
  await identity('postgres');await db.exec(sql);assert.equal((await page()).entries[0].distance,321);
  await db.query('delete from auth.users where id=$1',[alice]);assert.equal((await page()).entries.length,0);
});
