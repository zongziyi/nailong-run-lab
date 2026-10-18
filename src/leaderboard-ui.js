import {LeaderboardClient} from './leaderboard.js';

const modeLabel=mode=>mode===1?'一条命':'三条命';
const element=(tag,text,className)=>{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;
};
export class LeaderboardUI {
  constructor({getMode,client=null}={}){
    this.getMode=getMode;this.dialog=document.querySelector('#leaderboard-dialog');
    this.client=client??new LeaderboardClient();
    this.client.onChange=(state,type)=>{
      this.renderState(state);
      if(type==='submitted'&&this.isOpen)void this.load();
    };
    this.mode=3;this.request=0;this.offset=0;this.rows=[];this.lastRunMode=null;
    this.form=this.dialog.querySelector('form');this.nameInput=this.form.querySelector('input');
    document.querySelectorAll('[data-leaderboard-open]').forEach(button=>button.addEventListener('click',()=>this.open(button)));
    this.dialog.querySelector('[data-close]').addEventListener('click',()=>this.dialog.close());
    this.dialog.addEventListener('close',()=>{this.request++;this.opener?.focus({preventScroll:true});});
    this.dialog.querySelectorAll('[data-board-mode]').forEach(button=>button.addEventListener('click',()=>{
      this.mode=Number(button.dataset.boardMode);void this.load();
    }));
    this.dialog.querySelector('[data-refresh]').addEventListener('click',()=>{void this.client.flush();void this.load();});
    this.dialog.querySelector('[data-more]').addEventListener('click',()=>void this.load(true));
    this.form.addEventListener('submit',event=>{event.preventDefault();void this.saveName();});
    this.onOnline=()=>void this.client.flush();window.addEventListener('online',this.onOnline);
    this.renderState(this.client.snapshot());
    // Restore a queued score without requiring a new run or opening the board.
    void this.client.flush();
  }
  get isOpen(){return this.dialog.open;}
  open(opener){
    this.opener=opener;this.mode=this.getMode();this.nameInput.value=this.client.nickname||this.client.nicknameDraft||'';
    this.dialog.showModal();void this.load();void this.client.flush();
  }
  recordRun(run){this.lastRunMode=run.mode;this.client.recordRun({...run});this.renderState(this.client.snapshot());}
  renderState(state){
    const enabled=state.enabled;
    const saveButton=this.form.querySelector('button');
    saveButton.disabled=!!this.saving;this.nameInput.disabled=!!this.saving;
    saveButton.textContent=enabled?'保存昵称':'暂存昵称';
    this.dialog.querySelector('[data-identity-note]').textContent=!enabled?
      state.nicknameDraft?`暂存昵称：${state.nicknameDraft}。共享排行榜尚未启用，暂时不会上榜。`:'共享排行榜尚未启用，你可以先填写并暂存昵称。':
      state.nickname?`当前玩家：${state.nickname} · #${String(state.playerCode??'').slice(0,8)}`:'设置昵称即可参与，无需注册；也可以直接查看排行榜。';
    this.dialog.querySelector('[data-storage-note]').textContent=state.persistent?
      '身份保存在当前浏览器。换设备或清除浏览器数据会成为新玩家。':'当前浏览器无法保存身份；关闭页面后可能成为新玩家。';
    const final=document.querySelector('#leaderboard-result');
    final.textContent=enabled?(state.statuses[this.lastRunMode]||'设置昵称，和大家比比最高米数。'):
      state.configIssue?'排行榜配置有误，暂时无法提交':'排行榜尚未启用';
    this.dialog.querySelector('[data-sync-note]').textContent=[1,3].filter(mode=>state.pending[mode]!==undefined)
      .map(mode=>`${modeLabel(mode)}：${state.statuses[mode]||'纪录等待同步'}`).join('；');
  }
  async saveName(){
    if(this.saving)return;this.saving=true;this.renderState(this.client.snapshot());
    const message=this.dialog.querySelector('[data-name-message]');message.textContent='正在保存昵称…';
    try{
      if(!this.client.enabled){
        this.nameInput.value=this.client.saveNameDraft(this.nameInput.value);
        message.textContent=this.client.snapshot().persistent?'昵称已暂存在此浏览器。排行榜启用后，点击“保存昵称”即可参与。':'昵称已暂存在本次页面；浏览器无法保存数据，关闭页面后可能丢失。';
        return;
      }
      await this.client.setName(this.nameInput.value);this.nameInput.value=this.client.nickname;
      message.textContent='昵称已保存。正常结算后会自动同步最高纪录。';
      if(this.isOpen)await this.load();
    }catch(error){message.textContent=error.message?.includes('昵称')?error.message:'昵称暂未保存，请检查网络或稍后重试。';}
    finally{this.saving=false;this.renderState(this.client.snapshot());}
  }
  async load(more=false){
    const request=++this.request,mode=this.mode;
    const status=this.dialog.querySelector('[data-board-status]'),list=this.dialog.querySelector('[data-board-list]');
    const moreButton=this.dialog.querySelector('[data-more]');
    this.dialog.querySelectorAll('[data-board-mode]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.boardMode)===mode)));
    if(!more){this.rows=[];this.offset=0;list.replaceChildren();this.dialog.querySelector('[data-my-best]').textContent='';}
    moreButton.hidden=true;status.textContent='正在读取大家的最高纪录…';
    if(!this.client.enabled){
      status.textContent=this.client.configIssue?'排行榜配置有误，请联系游戏维护者。':'排行榜尚未启用';return;
    }
    try{
      const result=await this.client.page(mode,this.offset);
      if(request!==this.request||!this.isOpen)return;
      this.offset+=result.entries.length;
      for(const row of result.entries){
        if(this.rows.some(existing=>existing.player_code===row.player_code))continue;
        this.rows.push(row);
      }
      list.replaceChildren(...this.rows.map(row=>this.renderRow(row,result.me?.player_code)));
      const me=result.me;
      this.dialog.querySelector('[data-my-best]').textContent=me?.distance!=null?
        `我的${modeLabel(mode)}纪录：${me.distance} 米 · 第 ${me.rank} 名`:
        me?`你还没有${modeLabel(mode)}纪录，跑完一局就能上榜。`:'还未参与排行，填写昵称后即可保存最高纪录。';
      status.textContent=this.rows.length?`按最高米数排名 · 同米数并列 · ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 更新`:'还没有纪录，来成为第一个上榜的人吧。';
      moreButton.hidden=!result.has_more;
    }catch{
      if(request!==this.request||!this.isOpen)return;
      status.textContent='排行榜暂时无法读取，请检查网络后点击刷新。';
      // A failed continuation keeps the already fetched rows and can be retried.
      moreButton.hidden=!more;
    }
  }
  renderRow(row,ownCode){
    const own=row.player_code===ownCode;
    const item=element('li',undefined,`board-row${row.rank<=3?' board-podium':''}${own?' board-self':''}`);
    if(own)item.setAttribute('aria-label',`我的纪录，第 ${row.rank} 名，${row.distance} 米`);
    const rank=element('span',String(row.rank),'board-rank');
    const identity=element('div',undefined,'board-player');
    identity.append(element('b',`${row.nickname}${own?'（我）':''}`),element('small',`#${row.player_code.slice(0,8)}`));
    identity.title=`玩家编号 ${row.player_code}`;
    item.append(rank,identity,element('strong',`${row.distance} 米`));return item;
  }
}
