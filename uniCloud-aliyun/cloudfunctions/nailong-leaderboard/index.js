'use strict';
const crypto=require('crypto');
const COLLECTION='nailong-players';
const SPACE_ID='mp-6e5e447f-183a-4a77-9646-2a9e9f68753d';
const ORIGINS=['https://zongziyi.github.io','http://127.0.0.1:4173','http://localhost:4173',
  'http://127.0.0.1:4188','http://localhost:4188'];
class PublicError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status)=>{throw new PublicError(message,status);};
function nameOf(value){
  if(typeof value!=='string')fail('昵称请填写 1–16 个字');
  const name=value.normalize('NFC').trim();
  if([...name].length<1||[...name].length>16||/[\u0000-\u001f\u007f-\u009f]/u.test(name))fail('昵称请填写 1–16 个字，不要包含控制字符');
  return name;
}
function modeOf(mode){if(mode!==1&&mode!==3)fail('生命模式无效');return `best_${mode}`;}
const documentOf=result=>Array.isArray(result.data)?result.data[0]:result.data;
const publicProfile=player=>({nickname:player.nickname,player_code:player.player_code});

function createHandler({db,now=Date.now,allowedOrigins=ORIGINS}){
  const players=()=>db.collection(COLLECTION);
  const idOf=token=>{
    if(!/^[a-f0-9]{64}$/.test(token||''))fail('玩家身份已失效，请重新保存昵称',401);
    return crypto.createHash('sha256').update(token).digest('hex');
  };
  async function readPlayer(token){
    const player=documentOf(await players().doc(idOf(token)).get());
    if(!player)fail('玩家身份已失效，请重新保存昵称',401);return player;
  }
  async function mutate(token,change){
    const id=idOf(token);
    for(let attempt=0;attempt<3;attempt++){
      const transaction=await db.startTransaction();
      try{
        const record=transaction.collection(COLLECTION).doc(id);
        const player=documentOf(await record.get());
        if(!player)fail('玩家身份已失效，请重新保存昵称',401);
        const result=await change(player,record);
        await transaction.commit();return result;
      }catch(error){
        try{await transaction.rollback();}catch{}
        if(error instanceof PublicError||attempt===2)throw error;
      }
    }
  }
  async function board(body,token){
    const field=modeOf(body.mode),offset=body.offset??0,limit=body.limit??20;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20)fail('分页参数无效');
    const result=await players().where({[`${field}.distance`]:db.command.gte(0)})
      .orderBy(`${field}.distance`,'desc').orderBy(`${field}.at`,'asc').orderBy('player_code','asc')
      .skip(offset).limit(limit+1).field({nickname:true,player_code:true,[field]:true}).get();
    const rows=result.data,visible=rows.slice(0,limit);
    const above=async distance=>(await players().where({[`${field}.distance`]:db.command.gt(distance)}).count()).total;
    let rank=visible.length?1+await above(visible[0][field].distance):0;
    const entries=visible.map((player,index)=>{
      const best=player[field];if(index&&best.distance!==visible[index-1][field].distance)rank=offset+index+1;
      return {...publicProfile(player),rank,distance:best.distance,achieved_at:new Date(best.at).toISOString()};
    });
    let me=null;
    if(token){
      const player=await readPlayer(token),best=player[field],listed=entries.find(row=>row.player_code===player.player_code);
      me={...publicProfile(player),distance:best?.distance??null,rank:best?(listed?.rank??1+await above(best.distance)):null};
    }
    return {entries,has_more:rows.length>limit,me};
  }
  return async event=>{
    const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([key,value])=>[key.toLowerCase(),value]));
    const origin=headers.origin||'',allowed=allowedOrigins.includes(origin);
    const response=(statusCode,value)=>({mpserverlessComposedResponse:true,statusCode,isBase64Encoded:false,
      headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',
        ...(allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS',
          'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'3600'}:{})},body:statusCode===204?'':JSON.stringify(value)});
    try{
      if(!allowed)fail('请求来源未允许',403);
      if(event.httpMethod==='OPTIONS')return response(204,null);
      if(event.httpMethod!=='POST')fail('请使用 POST 请求',405);
      let raw=event.body||'{}';
      if(typeof raw!=='string'||raw.length>8192)fail('请求过大',413);
      if(event.isBase64Encoded===true)raw=Buffer.from(raw,'base64').toString('utf8');
      if(Buffer.byteLength(raw)>4096)fail('请求过大',413);
      let body;try{body=JSON.parse(raw);}catch{fail('请求格式无效');}
      if(!body||typeof body!=='object'||Array.isArray(body))fail('请求格式无效');
      const token=headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      let data;
      if(body.action==='health')data={service:'nailong-leaderboard',version:1,expectedSpaceId:SPACE_ID};
      else if(body.action==='register'){
        const newToken=crypto.randomBytes(32).toString('hex'),playerCode=crypto.randomUUID();
        await players().add({_id:idOf(newToken),player_code:playerCode,nickname:'',created_at:now()});
        data={token:newToken,userId:playerCode};
      }else if(body.action==='set_name'){
        const nickname=nameOf(body.nickname);
        data=await mutate(token,async(player,record)=>{await record.update({nickname});return {nickname,player_code:player.player_code};});
      }else if(body.action==='submit_score'){
        const field=modeOf(body.mode),distance=body.distance;
        if(!Number.isSafeInteger(distance)||distance<0)fail('成绩无效');
        data=await mutate(token,async(player,record)=>{
          if(!player.nickname)fail('请先保存昵称');
          const previous=player[field];
          if(previous&&previous.distance>=distance)return {distance:previous.distance,improved:false};
          await record.update({[field]:{distance,at:now()}});return {distance,improved:true};
        });
      }else if(body.action==='board')data=await board(body,token);
      else fail('未知排行榜操作');
      return response(200,{ok:true,data});
    }catch(error){
      // Never return tokens, document IDs or internal SDK diagnostics to browsers.
      const known=error instanceof PublicError;
      return response(known?error.status:503,{ok:false,error:known?error.message:'排行榜服务暂时不可用，请稍后重试'});
    }
  };
}
exports.createHandler=createHandler;
exports.main=event=>createHandler({db:uniCloud.database()})(event);
