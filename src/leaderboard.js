import {leaderboardConfig} from './leaderboard-config.js';
import {createUniCloudTransport} from './unicloud-transport.js';

export function validateConfig(config){
  if(config.provider==='unicloud'){
    if(!/^mp-[a-f0-9-]{36}$/i.test(config.spaceId??''))throw new Error('uniCloud Space ID 无效');
    if(!config.endpoint)return false;
    const endpoint=new URL(config.endpoint);
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search)throw new Error('请填写云函数的 HTTPS 访问地址');
    return true;
  }
  if(!config.url&&!config.publishableKey)return false;
  const url=new URL(config.url);
  if(url.protocol!=='https:'||!/^sb_publishable_[\w-]+$/.test(config.publishableKey)){
    throw new Error('排行榜配置需要 HTTPS 项目地址和 sb_publishable_ 开头的公开密钥');
  }
  return true;
}
export function normalizeName(value){
  const name=String(value??'').normalize('NFC').trim();
  if([...name].length<1||[...name].length>16||/[\u0000-\u001f\u007f-\u009f]/u.test(name)){
    throw new Error('昵称请填写 1–16 个字，不要包含换行或控制字符');
  }
  return name;
}
function score(mode,distance){
  if((mode!==1&&mode!==3)||!Number.isSafeInteger(distance)||distance<0)throw new Error('成绩或生命模式无效');
  return {mode,distance};
}
let sdkPromise;
export function loadSupabaseSDK(){
  if(globalThis.supabase?.createClient)return Promise.resolve(globalThis.supabase.createClient);
  if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const fail=()=>{clearTimeout(timer);script.remove();sdkPromise=null;reject(new Error('排行榜组件加载失败，请重试'));};
    const timer=setTimeout(fail,12000);
    script.src=new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js',import.meta.url).href;
    script.onload=()=>{
      clearTimeout(timer);
      if(!globalThis.supabase?.createClient){fail();return;}
      resolve(globalThis.supabase.createClient);
    };
    script.onerror=fail;document.head.append(script);
  });
  return sdkPromise;
}
function storageAdapter(getStorage){
  const memory=new Map();let persistent=true;
  const call=(method,key,value)=>{
    if(!persistent)return method==='getItem'?(memory.get(key)??null):undefined;
    try{
      const storage=getStorage();if(!storage)throw new Error('Storage unavailable');
      const result=storage[method](key,value);
      if(method==='getItem'&&result!==null)memory.set(key,result);
      return result;
    }
    catch{persistent=false;return method==='getItem'?(memory.get(key)??null):undefined;}
  };
  return {
    getItem:key=>call('getItem',key),
    setItem(key,value){memory.set(key,value);call('setItem',key,value);},
    removeItem(key){memory.delete(key);call('removeItem',key);},
    get persistent(){return persistent;},
  };
}
export class LeaderboardClient {
  constructor({config=leaderboardConfig,loadSDK=loadSupabaseSDK,getStorage=()=>globalThis.localStorage,onChange=()=>{}}={}){
    this.config=config;this.loadSDK=loadSDK;this.onChange=onChange;
    this.storage=storageAdapter(getStorage);this.enabled=false;
    try{this.enabled=validateConfig(config);}catch{this.configIssue=true;}
    this.key=config.provider==='unicloud'?`nailong-leaderboard:unicloud:${config.spaceId}:v1`:`nailong-leaderboard:${config.url}:v1`;
    this.draftKey='nailong-nickname-draft:v1';this.nicknameDraft='';
    try{const draft=this.storage.getItem(this.draftKey);if(draft)this.nicknameDraft=normalizeName(draft);}catch{}
    this.ownerId=null;this.nickname='';this.playerCode=null;this.pending={};
    this.statuses={};this.profileVersion=0;this.flushPromise=null;this.clientPromise=null;this.identityPromise=null;
    try{
      const saved=JSON.parse(this.storage.getItem(this.key)||'null');
      if(saved&&(saved.ownerId===null||typeof saved.ownerId==='string')){
        this.ownerId=saved.ownerId;this.nickname=saved.nickname?normalizeName(saved.nickname):'';this.playerCode=saved.playerCode;
        for(const mode of [1,3])if(Number.isSafeInteger(saved.pending?.[mode])&&saved.pending[mode]>=0)this.pending[mode]=saved.pending[mode];
      }
    }catch{/* Corrupted or unavailable browser storage must never stop the game. */}
  }
  snapshot(){return {enabled:this.enabled,configIssue:!!this.configIssue,nickname:this.nickname,nicknameDraft:this.nicknameDraft,
    playerCode:this.playerCode,persistent:this.storage.persistent,pending:{...this.pending},statuses:{...this.statuses}};}
  emit(type='change'){try{this.onChange(this.snapshot(),type);}catch(error){console.error('Leaderboard UI:',error);}}
  save(){
    this.storage.setItem(this.key,JSON.stringify({ownerId:this.ownerId,nickname:this.nickname,playerCode:this.playerCode,pending:this.pending}));
  }
  saveNameDraft(value){
    this.nicknameDraft=normalizeName(value);this.storage.setItem(this.draftKey,this.nicknameDraft);this.emit('draft');
    return this.nicknameDraft;
  }
  async client(){
    if(!this.enabled)throw new Error('排行榜尚未启用');
    if(!this.clientPromise)this.clientPromise=(async()=>{
      const timedFetch=async(input,init={})=>{
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
          const abort=()=>controller.abort();
          if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
          try{return await fetch(input,{...init,signal:controller.signal});}
          finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
      };
      if(this.config.provider==='unicloud')return createUniCloudTransport(this.config,{storage:this.storage,storageKey:`${this.key}:auth`,fetch:timedFetch});
      const createClient=await this.loadSDK();
      return createClient(this.config.url,this.config.publishableKey,{
        auth:{storage:this.storage,storageKey:`${this.key}:auth`,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
        global:{fetch:timedFetch},
      });
    })().catch(error=>{this.clientPromise=null;throw error;});
    return this.clientPromise;
  }
  async identity(create=false){
    if(this.identityPromise){await this.identityPromise;return this.identity(create);}
    this.identityPromise=(async()=>{
      const client=await this.client();
      const {data,error}=await client.auth.getSession();if(error)throw error;
      let session=data.session;
      if(this.ownerId&&this.ownerId!==session?.user.id){
        // A lost session must not move the previous player's queued score to a new identity.
        this.profileVersion++;this.ownerId=null;this.nickname='';this.playerCode=null;this.pending={};this.statuses={};this.save();this.emit('identity-lost');
      }
      if(!session&&create){
        const signed=await client.auth.signInAnonymously();if(signed.error)throw signed.error;session=signed.data.session;
      }
      if(session){this.ownerId=session.user.id;this.save();}
      return session;
    })();
    try{return await this.identityPromise;}finally{this.identityPromise=null;}
  }
  async rpc(name,args){
    const {data,error}=await (await this.client()).rpc(name,args);if(error)throw error;return data;
  }
  async setName(value){
    const name=this.saveNameDraft(value);
    await this.identity(true);
    const profile=await this.rpc('set_runner_name',{p_nickname:name});
    this.profileVersion++;this.nickname=profile.nickname;this.playerCode=profile.player_code;this.save();this.emit('profile');
    await this.flush();return profile;
  }
  recordRun({mode,distance}){
    const run=score(mode,Math.floor(distance));
    if(!this.enabled)return;
    this.pending[run.mode]=Math.max(this.pending[run.mode]??0,run.distance);
    this.statuses[run.mode]=this.nickname?'纪录等待同步…':'填写昵称后可提交纪录';this.save();this.emit();
    if(this.nickname)void this.flush();
  }
  async flush(){
    if(!this.enabled||!this.nickname)return;
    if(this.flushPromise)return this.flushPromise;
    let retryNewIdentity=false;
    this.flushPromise=(async()=>{
      try{
        const session=await this.identity();if(!session||!this.nickname)return;
        // Re-read the queue after every await so a newer run is never erased by an older response.
        while(Object.keys(this.pending).length){
          const mode=Number(Object.keys(this.pending)[0]),distance=this.pending[mode];
          this.statuses[mode]='正在同步最高纪录…';this.emit();
          const result=await this.rpc('submit_runner_score',{p_mode:mode,p_distance:distance});
          if(this.ownerId!==session.user.id){retryNewIdentity=true;return;}
          if(this.pending[mode]<=distance)delete this.pending[mode];
          this.statuses[mode]=`已同步 · 个人最高 ${result.distance} 米`;this.save();this.emit('submitted');
        }
      }catch{
        for(const mode of Object.keys(this.pending))this.statuses[mode]='尚未同步，已暂存；联网或打开排行榜后重试';
        this.save();this.emit('sync-error');
      }
    })();
    try{await this.flushPromise;}finally{
      this.flushPromise=null;
      if(retryNewIdentity&&this.nickname&&Object.keys(this.pending).length)void this.flush();
    }
  }
  async page(mode,offset=0){
    score(mode,0);
    const session=await this.identity();
    const profileVersion=this.profileVersion;
    const client=await this.client();
    let page,me;
    if(client.getBoard){const result=await client.getBoard(mode,offset);({me,...page}=result);}
    else [page,me]=await Promise.all([
        this.rpc('runner_leaderboard',{p_mode:mode,p_offset:offset,p_limit:20}),
        session?this.rpc('runner_personal_best',{p_mode:mode}):Promise.resolve(null),
      ]);
    if(me&&profileVersion===this.profileVersion){this.nickname=me.nickname;this.playerCode=me.player_code;this.save();this.emit('profile');}
    return {...page,me};
  }
}
