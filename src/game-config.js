export const GAME = Object.freeze({
  speed: 10.56,
  accelerationGain: 5.4,
  accelerationTime: 15,
  characterScale: 0.72,
  laneSpacing: 2.15,
  maxLives: 3,
  protectionSeconds: 1.5,
  warmupSeconds: 3,
  rowSecondsMin: 1.6,
  rowSecondsMax: 2.1,
  doubleProbability: 0.70,
  generationAttempts: 8,
  lookAhead: 90,
  lookAheadSeconds: 5,
  coinLookAheadSeconds: 8,
  exitReactionSeconds: 0.9,
  routeGrid: 0.1,
  routeChangeSeconds: 0.4,
  routeMargin: 0.05,
  oncomingSpeed: 6,
  oncomingCooldown: 6,
  warningSeconds: 2.4,
  roofProbability: 0.70,
  roofGapSeconds: 1.05,
  rampLength: 8,
  recycleBehind: 6,
  maxObstacles: 32,
  fadeSeconds: 0.22,
  maxFrameSeconds: 0.25,
  physicsStep: 1/120,
  jumpSeconds: 0.9,
  jumpHeight: 1.95,
  slideSeconds: 0.85,
  slideSafeStart: 0,
  slideSafeEnd: 0.85,
  slidePoseHoldStart: 0.20,
  diveSpeed: 12,
  diveGravityScale: 2,
  diveSlideSafeStart: 0,
  actionBlendSeconds: 0.10,
  playerWidth: 0.64,
  playerDepth: 0.64,
  slidingDepth: 1.25,
  standingHeight: 2.36,
  slidingHeight: 1.35,
  barrierClearance: 0.70,
});

export const OBSTACLES = Object.freeze({
  barrier: Object.freeze({label:'矮路障', width:1.8, length:0.8, bottom:0, top:0.65}),
  overhead: Object.freeze({label:'吊挂横杆', width:1.8, length:0.45, bottom:1.65, top:2.00}),
  train: Object.freeze({label:'停靠火车', width:1.8, length:18, bottom:0, top:3.8}),
  crate: Object.freeze({label:'堆叠货箱', width:1.6, length:1.2, bottom:0, top:1.05, clearance:1.10}),
  oncoming: Object.freeze({label:'迎面列车', width:1.8, length:18, bottom:0, top:3.8}),
});

export const SPAWN_WEIGHTS=Object.freeze({barrier:25,overhead:25,crate:25,train:15,oncoming:10});

export const speedAt=t=>GAME.speed+GAME.accelerationGain*Math.log1p(Math.max(0,t)/GAME.accelerationTime);
export const distanceAt=t=>{
  t=Math.max(0,t);
  return GAME.speed*t+GAME.accelerationGain*((t+GAME.accelerationTime)*Math.log1p(t/GAME.accelerationTime)-t);
};
export function timeAtDistance(distance){
  if(!Number.isFinite(distance))return distance;
  if(distance<=0)return 0;
  let t=distance/GAME.speed;
  for(let i=0;i<12;i++)t=Math.max(0,t-(distanceAt(t)-distance)/speedAt(t));
  return t;
}
export const gravity=8*GAME.jumpHeight/(GAME.jumpSeconds*GAME.jumpSeconds);
export const jumpVelocity=4*GAME.jumpHeight/GAME.jumpSeconds;
