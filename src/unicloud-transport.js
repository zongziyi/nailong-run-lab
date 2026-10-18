// Browser adapter for our single uniCloud HTTP function. Space ID is public;
// each player's random bearer token is stored only in their own browser.
export function createUniCloudTransport(config,{storage,storageKey,fetch:request=globalThis.fetch}){
  let session=null;
  try{
    const saved=JSON.parse(storage.getItem(storageKey)||'null');
    if(saved&&/^[a-f0-9]{64}$/.test(saved.token)&&typeof saved.userId==='string')session=saved;
  }catch{}
  async function call(action,args={}){
    const token=session?.token;
    const response=await request(config.endpoint,{
      method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      body:JSON.stringify({action,...args}),redirect:'error',
    });
    let result;
    try{result=await response.json();}catch{throw new Error('云函数没有返回 JSON，请检查 HTTP 访问地址');}
    if(!response.ok||!result.ok){
      if(response.status===401&&session?.token===token){session=null;storage.removeItem(storageKey);}
      throw new Error(result.error||'排行榜服务暂时不可用');
    }
    return result.data;
  }
  return {
    auth:{
      async getSession(){return {data:{session:session?{user:{id:session.userId}}:null}};},
      async signInAnonymously(){
        try{
          const created=await call('register');
          if(!/^[a-f0-9]{64}$/.test(created.token)||typeof created.userId!=='string')throw new Error('云函数身份响应无效');
          session=created;storage.setItem(storageKey,JSON.stringify(session));
          return {data:{session:{user:{id:session.userId}}}};
        }catch(error){return {data:{session:null},error};}
      },
    },
    async rpc(name,args){
      try{
        let data;
        if(name==='set_runner_name')data=await call('set_name',{nickname:args.p_nickname});
        else if(name==='submit_runner_score')data=await call('submit_score',{mode:args.p_mode,distance:args.p_distance});
        else throw new Error('未知排行榜操作');
        return {data};
      }catch(error){return {data:null,error};}
    },
    getBoard:(mode,offset)=>call('board',{mode,offset,limit:20}),
  };
}
