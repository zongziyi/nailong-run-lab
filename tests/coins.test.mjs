import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunnerController,simulateRoute} from '../src/controller.js';
import {CoinCourse,COINS,coinContact} from '../src/coins.js';
import {GAME,OBSTACLES,distanceAt,timeAtDistance} from '../src/game-config.js';

const random=seed=>()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
const state=(extra={})=>({elapsed:0,distance:0,x:0,y:0,action:'Run',actionTime:0,slideFromDive:false,...extra});
const point=(extra={})=>({x:0,y:1.05,distance:10,challenge:true,supportId:null,...extra});
function emptyRunner(maxLives=3){
  const r=new RunnerController({random:random(1)});r.start({maxLives});r.course.clear();r.course.nextFrontDistance=Infinity;
  r.coins.clear();r.coinPlanner.clear();return r;
}

test('coin sweeps use actual x, height and sliding depth, including high-speed crossings',()=>{
  assert.notEqual(coinContact(point(),state(),state({distance:20,elapsed:.25})),null);
  assert.equal(coinContact(point(),state({x:GAME.laneSpacing}),state({distance:20,x:GAME.laneSpacing,lane:0})),null);
  assert.equal(coinContact(point({y:3.1}),state(),state({distance:20})),null);
  assert.notEqual(coinContact(point({y:3.1}),state({y:1.95}),state({distance:20,y:1.95})),null);
  assert.notEqual(coinContact(point({y:.55}),state({action:'Slide',actionTime:.3}),state({distance:20,action:'Slide',actionTime:.5})),null);
  assert.equal(coinContact(point({y:4.85,supportId:1}),state(),state({distance:20})),null);
  assert.notEqual(coinContact(point({y:4.85,supportId:1}),state({y:3.8}),state({distance:20,y:3.8})),null);
});

test('collection awards once; unsupported roof coins vanish; fixed records recycle cleanly',()=>{
  const c=new CoinCourse();c.add([point(),point({x:2,supportId:4})]);
  assert.equal(c.collect(state(),state({distance:20,elapsed:.2}),[]).length,1);
  assert.equal(c.collect(state(),state({distance:20,elapsed:.2}),[]).length,0);
  c.recycle(0,.2,[]);assert.equal(c.active.length,1);
  c.recycle(30,1,[]);assert.equal(c.free.length,COINS.capacity);
  assert.equal(c.add(Array.from({length:COINS.capacity+1},()=>point())),false);
  for(let i=0;i<1000;i++){c.add([point()]);c.recycle(30,i,[]);}
  assert.equal(c.pool.length,COINS.capacity);assert.equal(c.free.length,COINS.capacity);
  c.add([point()]);assert.equal(c.active[0].collectedAt,null);
});

test('pause and final collision freeze coins; only coins before fatal contact count; restart resets',()=>{
  const r=emptyRunner(1);r.coins.add([point({distance:1}),point({distance:2.5}),point({distance:3.5})]);
  const obstacle=r.course.record('barrier',0,0);obstacle.frontDistance=2.68;r.course.allocate(obstacle);
  r.pause();const frozen=JSON.stringify(r);r.update(.25);assert.equal(JSON.stringify(r),frozen);
  r.togglePause();for(let i=0;i<4&&!r.gameOver;i++)r.update(.25);
  assert.equal(r.gameOver,true);assert.equal(r.coinCount,2);assert.equal(r.drainCoinEvents().length,2);
  const ended=JSON.stringify(r);r.update(.25);assert.equal(JSON.stringify(r),ended);
  r.start();assert.equal(r.coinCount,0);assert.equal(r.coinSerial,0);assert.deepEqual(r.drainCoinEvents(),[]);
  r.inspect();assert.equal(r.coins.active.length,0);assert.equal(r.coinPlanner.routes.length,0);
});

test('a coin whose first contact equals the final impact is not awarded',()=>{
  const c=new CoinCourse();c.add([point({distance:1+GAME.playerDepth/2+COINS.radius})]);
  assert.equal(c.collect(state(),state({distance:1,elapsed:.1}),[],{fatal:true}).length,0);
});

test('planning probes share real physics without modifying live state or obstacle records',()=>{
  const r=emptyRunner(),o=r.course.record('crate',0,0);o.frontDistance=distanceAt(.7);r.course.allocate(o);
  const before=JSON.stringify(r),snapshot=r.simulationState();
  const result=simulateRoute({state:snapshot,obstacles:r.course.active,commands:[{time:.32,action:'jump'}],end:1.6});
  assert.equal(result.safe,true);assert.equal(result.state.grounded,true);assert.equal(JSON.stringify(r),before);
  assert.equal(simulateRoute({state:snapshot,obstacles:r.course.active,end:1.6}).safe,false);
});

const commandKey=c=>`${c.time.toFixed(7)}:${c.lane}:${c.action}`;
function replay(seed,{seconds=20,fps=10,alternate=false,drop=false,inspect=()=>{}}={}){
  const r=new RunnerController({random:random(seed)});r.start();const executed=new Set(),seen=new Set(),collected=new Set(),overrides=[];
  const expected=new Map();let forks=0,combos=0,coinTotal=0,challengeTotal=0;
  while(r.elapsed<seconds-1e-8&&!r.gameOver){
    for(const route of r.coinPlanner.routes)if(!seen.has(route.id)){
      seen.add(route.id);if(route.branches.length>1)forks++;
      if(route.start>=20&&route.branches[0].commands.filter(c=>c.action).length>1)combos++;
      const branch=route.branches[alternate?route.branches.length-1:0];
      if(alternate&&route.branches.length>1)overrides.push({start:route.start,end:route.end,commands:branch.commands});
      const required=r.coins.active.filter(c=>c.routeId===route.id&&branch.points.some(p=>Math.abs(p.x-c.x)<.05&&Math.abs(p.y-c.y)<.05&&Math.abs(p.distance-c.distance)<.05));
      expected.set(route.id,{end:route.end,ids:required.map(c=>c.id)});
      for(const coin of r.coins.active.filter(c=>c.routeId===route.id)){coinTotal++;if(coin.challenge)challengeTotal++;}
      inspect(r,route);
    }
    const list=[...r.coinPlanner.commands.filter(c=>!overrides.some(v=>c.time>=v.start-1e-8&&c.time<v.end-1e-8)),...overrides.flatMap(v=>v.commands)]
      .filter(c=>!executed.has(commandKey(c))).sort((a,b)=>a.time-b.time||(a.lane===undefined?1:-1));
    const due=list.filter(c=>c.time<=r.elapsed+1e-7);
    if(due.length){
      for(const c of due){if(c.lane!==undefined)while(r.lane!==c.lane)r.input(c.lane>r.lane?'right':'left');
        if(c.action)assert.equal(r.input(c.action),true,`Rejected ${c.action} seed ${seed} at ${r.elapsed}`);executed.add(commandKey(c));}
      continue;
    }
    const dt=drop&&Math.floor(r.elapsed*10)%7===0?.25:1/fps;
    r.update(Math.min(dt,seconds-r.elapsed,list[0]?list[0].time-r.elapsed:dt));
    for(const event of r.drainCoinEvents())collected.add(event.id);
    assert.equal(r.lives,3,`Coin route damaged seed ${seed} at ${r.elapsed}`);
    assert.ok(r.coins.active.length<=COINS.capacity);
    for(const [id,route] of expected)if(route.end<=r.elapsed){for(const coin of route.ids)assert.ok(collected.has(coin),`Missed coin ${coin} route ${id} seed ${seed}`);expected.delete(id);}
  }
  return {r,forks,combos,coinTotal,challengeTotal};
}

test('1,000 seeded continuous routes collect their chosen strings without damage or embedded coins',t=>{
  let total=0,challenge=0,routes=0;
  for(let seed=1;seed<=1000;seed++){
    const result=replay(seed,{inspect:(r,route)=>{
      routes++;for(const branch of route.branches)for(const p of branch.points){
        assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.distance));
        assert.ok(p.obstacleId!=null);
        for(const o of r.course.active){
          const spec=OBSTACLES[o.kind],front=o.frontDistance-(o.motionSpeed??0)*(timeAtDistance(p.distance)-o.arrivalTime);
          const length=spec.length+(o.kind==='train'&&o.hasRamp?GAME.rampLength:0),radius=COINS.radius;
          if(Math.abs(p.x-o.lane*GAME.laneSpacing)>spec.width/2+radius||p.distance<front-radius||p.distance>front+length+radius)continue;
          const base=o.baseHeight??0,top=o.kind==='train'&&o.hasRamp?spec.top*Math.max(0,Math.min(1,(p.distance-front)/GAME.rampLength)):base+spec.top;
          assert.ok(p.y-radius>top||p.y+radius<base+spec.bottom,`Coin embedded in ${o.kind} seed ${seed}`);
        }
      }
    }});total+=result.coinTotal;challenge+=result.challengeTotal;
  }
  assert.ok(total>5000);assert.ok(challenge/total>=.8);t.diagnostic(`${routes} challenge segments; ${total} coins; ${(challenge/total*100).toFixed(1)}% obstacle-associated.`);
});

test('both fork choices merge into later routes at 30/60/120 FPS and quarter-second dropped frames',t=>{
  let forks=0;
  for(const fps of [30,60,120])for(const alternate of [false,true]){
    const result=replay(10,{seconds:100,fps,alternate,drop:fps===30});forks+=result.forks;
    assert.ok(result.r.coinCount>120);assert.ok(result.r.coinPlanner.anchors[0].elapsed>result.r.elapsed);
    assert.ok(result.combos>0,'Later routes must include combined actions');
  }
  assert.ok(forks>=6);t.diagnostic(`Replayed ${forks} forks including alternate branches.`);
});

test('new obstacles cannot invalidate a published witness; published positions stay fixed',()=>{
  const r=new RunnerController({random:random(2)});r.start();const before=JSON.stringify(r.coins.active);
  const route=r.coinPlanner.routes[0],point=route.branches[0].points[2];
  const candidate=r.course.record('train',Math.round(point.x/GAME.laneSpacing),0);
  candidate.frontDistance=point.distance-.2;candidate.hasRamp=false;
  assert.equal(r.coinPlanner.accepts([...r.course.active,candidate]),false);
  assert.equal(JSON.stringify(r.coins.active),before);
});

test('late-game routes continue at high speeds without unbounded history',()=>{
  const {r}=replay(17,{seconds:240,fps:30,alternate:true,drop:true});
  assert.ok(r.speed>20);assert.ok(r.coinCount>300);assert.ok(r.coinPlanner.routes.length<8);
  assert.ok(r.coinPlanner.commands.length<40);assert.ok(r.coinPlanner.seen.size<=32);
});
