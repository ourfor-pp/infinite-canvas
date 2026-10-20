const $ = (id) => document.getElementById(id);
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog, experiment, category = 'generation', view = 'overview', selected = [0,1], notes = {}, target, videos = [], renderVersion = 0, animation, saveTimer;
const clips = () => experiment.cases.map((id) => catalog.clips[id]);
const clock = (value) => { const ms = Math.round(Math.max(0,value || 0)*1000); return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`; };
const format = (clip) => clip.type === 'audio' ? `${clip.duration.toFixed(2)}秒` : `${clip.width} × ${clip.height} · 每秒${Number(clip.fps.toFixed(2))}帧`;
const status = (message = '') => { $('player-status').textContent = message; };
const limit = () => videos.length ? Math.min(...videos.map((v) => Number.isFinite(v.duration) ? v.duration : catalog.clips[v.dataset.clip].duration)) : 0;

function stopPlayers() {
  renderVersion++; cancelAnimationFrame(animation);
  videos.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
  document.querySelectorAll('audio').forEach((a) => a.pause()); videos=[];
}

function renderNavigation() {
  $('categories').innerHTML = catalog.categories.map((c,i) => `<button data-category="${c.id}" aria-selected="${c.id===category}"><small>${String(i+1).padStart(2,'0')}</small>${escape(c.label)}</button>`).join('');
  $('experiment-list').innerHTML = catalog.experiments.filter((e) => e.category===category).map((e) => `<button data-experiment="${e.id}" aria-current="${experiment?.id===e.id}">${escape(e.title)}<span>${e.cases.length} 个样本${e.overview ? ' · 含同屏对比' : ''}</span></button>`).join('');
}

function showExperiment(id) {
  const found = catalog.experiments.find((e) => e.id===id); if (!found) return;
  stopPlayers(); experiment=found; category=found.category; selected=[0,Math.min(1,found.cases.length-1)];
  view=found.overview ? 'overview' : found.cases.length>1 ? 'pair' : 'single'; target=found.cases[selected[1]];
  history.replaceState(null,'','#'+id); $('workspace').hidden=false; $('research-area').hidden=true;
  $('experiment-title').textContent=found.title; $('experiment-summary').textContent=found.summary; $('limits').textContent=found.limits;
  $('observations').open=false; renderNavigation(); renderMedia(); renderReview();
}

function renderMedia() {
  stopPlayers(); status();
  const audio=category==='audio'; $('video-area').hidden=audio; $('audio-area').hidden=!audio; $('view-modes').hidden=audio;
  $('view-modes').querySelectorAll('button').forEach((b) => { b.disabled=b.dataset.view==='overview'&&!experiment.overview || b.dataset.view==='pair'&&experiment.cases.length<2; b.setAttribute('aria-pressed',b.dataset.view===view); });
  if (audio) {
    $('audio-area').innerHTML=clips().map((c) => `<article class="audio-row"><div class="audio-row-head"><strong>${escape(c.label)}</strong><button data-review="${c.id}">评价这条</button></div><audio controls preload="metadata" src="${escape(c.url)}" aria-label="${escape(c.label)}"></audio><small>${escape(c.note)} · ${c.duration.toFixed(2)} 秒</small></article>`).join('');
    document.querySelectorAll('audio').forEach((a,i,all) => a.addEventListener('play',() => { all.forEach((other) => {if(other!==a)other.pause();}); target=experiment.cases[i];renderReview(); }));
    renderDetails(); return;
  }
  $('audio-area').replaceChildren();
  const ids=view==='overview' ? [experiment.overview] : view==='pair' ? selected.map((i) => experiment.cases[i]) : [experiment.cases[selected[0]]];
  $('players').classList.toggle('pair',ids.length===2);
  $('players').innerHTML=ids.map((id,i) => {
    const c=catalog.clips[id];
    const picker=view==='overview' ? `<strong class="player-label">${escape(c.label)}</strong>` : `<select aria-label="${i===0?'左侧':'右侧'}样本" data-case-index="${i}">${clips().map((item,j) => `<option value="${j}" ${id===item.id?'selected':''}>${escape(item.label)}</option>`).join('')}</select>`;
    return `<article class="player-tile"><div class="player-heading">${picker}<span>${escape(format(c))}</span></div><div class="viewport"><video data-clip="${id}" data-index="${i}" src="${escape(c.url)}" poster="${escape(c.poster)}" preload="metadata" playsinline muted aria-label="${escape(c.label)}"></video></div>${c.faceTrack ? `<div class="face-strip"><canvas width="384" height="384" data-face="${i}" aria-label="当前帧固定192像素人脸窗口"></canvas><p><strong>放大看人脸</strong>每版截取同样大小的区域<br><span data-face-info="${i}"></span></p></div>` : ''}<div class="player-tools"><div><button data-action="sound" data-index="${i}" ${!c.hasAudio?'disabled':''}>${c.hasAudio?'打开声音':'没有声音'}</button><select data-zoom="${i}" aria-label="画面缩放"><option value="fit">适应窗口</option><option value="1">原始像素</option><option value="2">放大两倍</option></select></div><div><button data-action="capture" data-index="${i}">保存这一帧</button><button data-action="fullscreen" data-index="${i}">全屏 ↗</button><a href="${escape(c.url)}" download="${escape(c.label)}.${c.type==='audio'?'wav':'mp4'}">下载</a></div></div></article>`;
  }).join('');
  videos=[...$('players').querySelectorAll('video')];const version=renderVersion;
  videos.forEach((v) => {
    v.playbackRate=Number($('speed').value);
    v.addEventListener('loadedmetadata',() => { if(version!==renderVersion)return; $('timeline').max=limit();updateTime(); });
    v.addEventListener('loadeddata',() => {if(version===renderVersion)updateTime();});
    v.requestVideoFrameCallback(()=>{if(version===renderVersion)updateTime();});
    v.addEventListener('seeked',() => {if(version===renderVersion)updateTime();});
    v.addEventListener('error',() => {if(version===renderVersion)status(`“${catalog.clips[v.dataset.clip].label}”加载失败，请用当前画布的入口地址访问，或下载文件检查。`);});
    v.addEventListener('waiting',() => {if(version===renderVersion&&!v.paused)status('正在缓冲原文件…');});
    v.addEventListener('playing',() => {if(version===renderVersion)status();});
    v.addEventListener('ended',() => {
      if(version!==renderVersion||v!==videos[0])return;
      if($('loop').checked){seek(0);playAll();}else pauseAll();
    });
  });
  $('jump').hidden=!experiment.jump; $('play').innerHTML='▶ <span>播放</span>'; $('play').setAttribute('aria-label','播放');
  updateTime();renderDetails();
}

function drawFace(v,index) {
  const c=catalog.clips[v.dataset.clip];if(!c.faceTrack)return;
  const canvas=$('players').querySelector(`[data-face="${index}"]`);if(!canvas||v.readyState<2)return;
  const ctx=canvas.getContext('2d');const frame=Math.min(c.faceTrack.length-1,Math.max(0,Math.round(v.currentTime*c.fps)));const box=c.faceTrack[frame];
  ctx.fillStyle='#101722';ctx.fillRect(0,0,384,384);
  const info=$('players').querySelector(`[data-face-info="${index}"]`);
  if(!box){info.textContent='这一帧没有找到脸';return;}
  const [x0,y0,x1,y1]=box;const x=(x0+x1)/2-96,y=(y0+y1)/2-96;
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(v,x,y,192,192,0,0,384,384);
  info.textContent=`脸 ${(x1-x0).toFixed(1)} × ${(y1-y0).toFixed(1)} px · 第 ${frame} 帧`;
}

function updateTime() {
  const master=videos[0];if(!master)return;
  const t=master.currentTime||0,duration=limit();$('timeline').value=t;$('time').textContent=`${clock(t)} / ${clock(duration)}`;
  const c=catalog.clips[master.dataset.clip];$('frame-info').textContent=`第 ${Math.min(c.frames-1,Math.round(t*c.fps))} / ${c.frames} 帧 · 每次按左侧视频前进一帧`;
  videos.forEach(drawFace);
}

function tick() {
  updateTime();const master=videos[0];if(!master||master.paused)return;
  videos.slice(1).forEach((v) => {if(v.readyState>=2&&Math.abs(v.currentTime-master.currentTime)>.12)v.currentTime=Math.min(master.currentTime,Math.max(0,v.duration-.001));});
  animation=requestAnimationFrame(tick);
}

async function playAll() {
  if(!videos.length)return;
  if(videos[0].currentTime>=limit()-.03)seek(0);
  try { await Promise.all(videos.map((v) => v.play()));$('play').innerHTML='Ⅱ <span>暂停</span>';$('play').setAttribute('aria-label','暂停');cancelAnimationFrame(animation);tick(); }
  catch(error){pauseAll();status('播放未开始：'+error.message);}
}
function pauseAll(){videos.forEach((v)=>v.pause());cancelAnimationFrame(animation);$('play').innerHTML='▶ <span>播放</span>';$('play').setAttribute('aria-label','播放');updateTime();}
function seek(t){videos.forEach((v)=>{v.currentTime=Math.min(Math.max(0,t),Math.max(0,(Number.isFinite(v.duration)?v.duration:limit())-.001));});updateTime();}
function step(direction){pauseAll();if(videos[0])seek(videos[0].currentTime+direction/catalog.clips[videos[0].dataset.clip].fps);}

function renderDetails() {
  $('technical-content').innerHTML=clips().map((c)=>`<div class="technical-row"><strong>${escape(c.label)}</strong><br>模型／原实验名：${escape(c.technicalName)}<br>${escape(format(c))} · 时长 ${c.duration.toFixed(3)}秒${c.engineSeconds?` · 处理耗时 ${c.engineSeconds.toFixed(3)}秒`:''}${c.face?`<br>检测到的人脸大小中位数：${c.face.join(' × ')} 像素`:''}<br>${escape(c.params)}${c.browserTranscoded?'<br>浏览器审片编码：原始RGB／PNG结果转H.264，未新增修复。':''}<br><code>${escape(c.originalPath||c.sourcePath)}</code><br><code>SHA256 ${escape(c.sha256)}</code></div>`).join('');
  $('observation-content').innerHTML=clips().map((c)=>`<p><strong>${escape(c.label)}</strong><br>${escape(c.note)}</p>`).join('');
}

function renderReview() {
  if(!experiment)return;
  $('review-target').innerHTML=clips().map((c)=>`<option value="${c.id}" ${c.id===target?'selected':''}>${escape(c.label)}</option>`).join('');
  $('review-target').title=catalog.clips[target].label;
  const current=notes[target]||{};$('note').value=current.note||'';
  document.querySelectorAll('[data-verdict]').forEach((b)=>b.setAttribute('aria-pressed',b.dataset.verdict===current.verdict));
  $('review-count').textContent=Object.values(notes).filter((n)=>n.verdict||n.note).length;
}
function saveReview(verdict) {
  const current=notes[target]||{};
  notes[target]={...current,label:catalog.clips[target].label,note:$('note').value,verdict:verdict===undefined?current.verdict:(current.verdict===verdict?null:verdict),updatedAt:new Date().toISOString()};
  document.querySelectorAll('[data-verdict]').forEach((b)=>b.setAttribute('aria-pressed',b.dataset.verdict===notes[target].verdict));
  $('review-count').textContent=Object.values(notes).filter((n)=>n.verdict||n.note).length;
  $('save-status').textContent='正在保存…';clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{try{await window.localforage.setItem('decisions',notes);$('save-status').textContent='已保存到本机 · 可导出评价文件';}catch{$('save-status').textContent='本地保存不可用，请导出本次判断';}},250);
}

async function showResearch() {
  stopPlayers();category='research';history.replaceState(null,'','#research');renderNavigation();$('workspace').hidden=true;$('research-area').hidden=false;
  const container=$('research-content');container.innerHTML='<p class="research-status">正在读取调研记录…</p>';
  try {
    const response=await fetch('./research.json',{cache:'no-store'});if(!response.ok)throw new Error('调研记录尚未发布');const research=await response.json();
    container.innerHTML=`<p class="research-lead">${escape(research.summary)}</p>`+research.groups.map((group)=>`<section class="research-group"><h3>${escape(group.title)}</h3>${group.findings.map((item)=>`<article class="research-card"><h4>${escape(item.title)}</h4><div class="evidence">${escape(item.evidence)}</div><p>${escape(item.summary)}</p><details><summary>查看模型或作品原名、参数与验证限制</summary><p><strong>原名：</strong>${escape(item.technicalName)}</p>${item.recipe?`<p><strong>公开配置：</strong>${escape(item.recipe)}</p>`:''}${item.limits?`<p><strong>尚未证明的部分：</strong>${escape(item.limits)}</p>`:''}${item.next?`<p><strong>后续怎么验证：</strong>${escape(item.next)}</p>`:''}</details><div class="research-links">${(item.sources||[]).filter((s)=>/^https?:\/\//.test(s.url)).map((s)=>`<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.label)} ↗</a>`).join('')}</div></article>`).join('')}</section>`).join('');
  }catch(error){container.innerHTML=`<p class="research-status">${escape(error.message)}。三路调研分别关注生成配方、完整制作案例与后期修复。完成后点击“刷新调研结果”。</p>`;}
}

$('categories').addEventListener('click',(event)=>{const button=event.target.closest('[data-category]');if(!button)return;if(button.dataset.category==='research')showResearch();else showExperiment(catalog.experiments.find((e)=>e.category===button.dataset.category).id);});
$('experiment-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-experiment]');if(button)showExperiment(button.dataset.experiment);});
$('view-modes').addEventListener('click',(event)=>{const button=event.target.closest('[data-view]');if(button&&!button.disabled){view=button.dataset.view;renderMedia();}});
$('players').addEventListener('change',(event)=>{
  if(event.target.matches('[data-case-index]')){selected[Number(event.target.dataset.caseIndex)]=Number(event.target.value);target=experiment.cases[Number(event.target.value)];renderMedia();renderReview();}
  if(event.target.matches('[data-zoom]')){const v=videos[Number(event.target.dataset.zoom)],native=event.target.value!=='fit';v.parentElement.classList.toggle('native',native);v.style.width=native?(v.videoWidth*Number(event.target.value))+'px':'';}
});
$('players').addEventListener('click',async(event)=>{
  const button=event.target.closest('[data-action]');if(!button)return;const index=Number(button.dataset.index),v=videos[index];
  if(button.dataset.action==='sound'){const open=v.muted;videos.forEach((other)=>other.muted=true);v.muted=!open;$('players').querySelectorAll('[data-action="sound"]').forEach((b,i)=>{if(!b.disabled)b.textContent=videos[i].muted?'打开声音':'声音已开';});}
  if(button.dataset.action==='fullscreen'){try{v.controls=true;await v.requestFullscreen();}catch{status('此浏览器无法全屏，可下载原文件查看。');}}
  if(button.dataset.action==='capture'){
    if(v.readyState<2){status('请先加载视频画面。');return;}const canvas=document.createElement('canvas');canvas.width=v.videoWidth;canvas.height=v.videoHeight;canvas.getContext('2d').drawImage(v,0,0);canvas.toBlob((blob)=>{if(blob)download(blob,`${catalog.clips[v.dataset.clip].label}-${v.currentTime.toFixed(3)}秒.png`);},'image/png');
  }
});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)videos.forEach((v)=>v.controls=false);});
$('play').onclick=()=>videos[0]?.paused?playAll():pauseAll();$('previous').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('timeline').oninput=(event)=>seek(Number(event.target.value));
$('speed').onchange=()=>videos.forEach((v)=>v.playbackRate=Number($('speed').value));$('jump').onclick=()=>{pauseAll();seek(experiment.jump);};
document.addEventListener('keydown',(event)=>{if(event.target.closest('input,textarea,select,button,a')||$('workspace').hidden||category==='audio')return;if(event.code==='Space'){event.preventDefault();$('play').click();}if(event.code==='ArrowLeft'){event.preventDefault();step(-1);}if(event.code==='ArrowRight'){event.preventDefault();step(1);}});
$('review-target').onchange=(event)=>{target=event.target.value;renderReview();};document.querySelectorAll('[data-verdict]').forEach((button)=>button.onclick=()=>saveReview(button.dataset.verdict));$('note').oninput=()=>saveReview();
$('audio-area').onclick=(event)=>{const button=event.target.closest('[data-review]');if(button){target=button.dataset.review;renderReview();$('note').focus();}};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>download(new Blob([JSON.stringify({title:'红岸视频审片判断',exportedAt:new Date().toISOString(),notes},null,2)],{type:'application/json'}),'红岸-我的审片判断.json');
$('reference-toggle').onclick=()=>{$('identity-dialog').querySelector('img').src=catalog.identity;$('identity-dialog').showModal();};$('close-identity').onclick=()=>$('identity-dialog').close();$('refresh-research').onclick=showResearch;
window.addEventListener('hashchange',()=>location.hash==='#research'?showResearch():showExperiment(location.hash.slice(1)));

try {
  const response=await fetch('./catalog.json',{cache:'no-store'});if(!response.ok)throw new Error('样本目录尚未准备完成');catalog=await response.json();
  window.localforage.config({name:'redcoast-video-review',storeName:'review_notes'});
  try{notes=await window.localforage.getItem('decisions')||{};}catch{$('save-status').textContent='本地保存不可用，可导出本次判断';}
  $('sample-count').textContent=Object.keys(catalog.clips).length;$('identity').src=catalog.identity;
  if(location.hash==='#research')await showResearch();else showExperiment(catalog.experiments.some((e)=>e.id===location.hash.slice(1))?location.hash.slice(1):'generation-candidates');
}catch(error){$('load-error').hidden=false;$('load-error').textContent='页面加载失败：'+error.message+'。请从现有画布入口打开此页。';}
