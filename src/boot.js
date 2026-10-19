// A classic script also runs when index.html is opened as a file. Module
// loading errors must be visible before main.js has a chance to initialize.
(()=>{
  const loader=document.querySelector('#loader');
  const retry=document.querySelector('#retry');
  const localUrl='http://127.0.0.1:4173/';
  let ready=false,timer;
  const fail=(message,error)=>{
    if(ready)return;
    clearTimeout(timer);
    loader.hidden=false;
    loader.querySelector('.loading-ring').hidden=true;
    loader.querySelector('b').textContent='试玩还没启动';
    loader.querySelector('small').textContent=message;
    retry.hidden=false;
    if(error)console.error(error);
  };
  retry.addEventListener('click',()=>{
    if(location.protocol==='file:')location.href=localUrl;
    else location.reload();
  });
  if(location.protocol==='file:'){
    fail('这是直接打开的本地文件，浏览器无法加载游戏模块。请双击“启动试玩.cmd”并保持窗口打开，或点击下方按钮打开已启动的本机试玩。');
    retry.textContent='打开本机试玩';
    return;
  }
  window.nailongBoot={
    ready(){ready=true;clearTimeout(timer);},
    fail,
    phase(message){if(!ready)loader.querySelector('small').textContent=message;},
  };
  window.addEventListener('error',event=>fail(`启动出错：${event.message||'脚本未能加载'}。请刷新页面后重试。`,event.error));
  window.addEventListener('unhandledrejection',event=>fail(`加载出错：${event.reason?.message||String(event.reason)}。`,event.reason));
  timer=setTimeout(()=>fail('加载超过 30 秒。请检查网络连接，再点击重新加载；若仍失败，页面会显示具体错误。'),30000);
  loader.querySelector('small').textContent='正在启动 3D 场景…';
  import('./main.js?v=train-flash-1').catch(error=>fail(`游戏脚本未能启动：${error.message}。请检查网络连接并刷新页面后重试。`,error));
})();
