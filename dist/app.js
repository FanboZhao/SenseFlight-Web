const byId = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TASKS = {
  D3: { name: '纯视觉任务', model: 'ConnectomeFlight-M-V', frames: 210, media: './media/d3.mp4', summary: '纯视觉导航 · 选定成功案例' },
  D4: { name: '多模态任务', model: 'ConnectomeFlight-M-VO', frames: 408, media: './media/d4.mp4', summary: '视觉与嗅觉导航 · 选定成功案例' },
};
const CROPS = {
  follow: [0,0,1280,720], topdown: [1280,0,1280,720], network: [0,720,1600,480],
  trajectory: [1600,720,384,640], eyeL: [1984,720,160,160], eyeR: [2144,720,160,160],
  hexL: [1984,880,160,176], hexR: [2144,880,160,176],
  position: [2304,720,256,64], odor: [2304,816,256,160], altitude: [2304,976,256,32], actions: [1984,1056,320,208],
};
const video = byId('replay-source');
const state = { task: 'D3', frame: 0, cell: 0, ready: false, generation: 0, expanded: 'follow' };
let videoCallback = null;
let videoListenerController = null;
const task = () => TASKS[state.task];

function paint(id, crop, smooth = true) {
  const canvas = byId(id);
  if (!canvas || video.readyState < 2) return;
  const [x,y,w,h] = crop;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(video, x,y,w,h, 0,0,w,h);
}
function render(frame = Math.floor(video.currentTime * 20 + .001)) {
  if (!state.ready || video.readyState < 2 || video.seeking) return;
  state.frame = clamp(frame, 0, task().frames - 1);
  paint('camera-image', CROPS.follow); paint('topdown-image', CROPS.topdown);
  paint('eye-left', CROPS.eyeL, false); paint('eye-right', CROPS.eyeR, false);
  paint('hex-left', CROPS.hexL); paint('hex-right', CROPS.hexR);
  paint('t4-left', [state.cell*256,1360,128,144]); paint('t4-right', [state.cell*256+128,1360,128,144]);
  paint('trajectory', CROPS.trajectory); paint('position-display', CROPS.position);
  paint('actions-display', CROPS.actions); paint('camera-position', CROPS.altitude);
  if (state.task === 'D4') paint('odor-display', CROPS.odor);
  paint('network-canvas', CROPS.network);
  if (byId('network-dialog').open) paint('network-canvas-large', CROPS.network);
  if (byId('camera-dialog').open) paint('camera-image-large', CROPS[state.expanded]);
  updateControls();
}
function updateControls() {
  const playing = !video.paused && !video.ended;
  byId('play-button').setAttribute('aria-label', playing ? '暂停' : '播放');
  document.querySelectorAll('[data-playback-toggle]').forEach(button => {
    button.textContent = playing ? 'Ⅱ 暂停' : '▶ 播放'; button.setAttribute('aria-label', playing ? '暂停' : '播放');
  });
  const elapsed = (state.frame*.005).toFixed(3), duration = ((task().frames-1)*.005).toFixed(3);
  byId('frame-label').textContent = `${String(state.frame+1).padStart(4,'0')} / ${String(task().frames).padStart(4,'0')}`;
  byId('sim-time').textContent = byId('topdown-time').textContent = `T + ${elapsed} S`;
  document.querySelectorAll('[data-playback-time]').forEach(el => { el.textContent = `${elapsed} / ${duration} s`; });
  document.querySelectorAll('#timeline, [data-playback-timeline]').forEach(el => {
    el.max = String(task().frames-1); el.value = String(state.frame);
    el.style.setProperty('--progress', `${state.frame/(task().frames-1)*100}%`);
    el.setAttribute('aria-valuetext', `第 ${state.frame+1} 帧，共 ${task().frames} 帧`);
  });
  const status = `${task().name} · ${playing ? '● 同步播放' : '○ 当前帧'} · ${state.frame+1} / ${task().frames}`;
  byId('network-sync').textContent = byId('network-dialog-status').textContent = status;
}
function setEnabled(enabled) {
  document.querySelectorAll('#play-button, #step-back, #step-forward, #timeline, #network-expand, [data-camera-view], [data-playback-toggle], [data-playback-timeline]').forEach(el => { el.disabled = !enabled; });
}
function showError() {
  state.ready = false; video.pause(); setEnabled(false);
  byId('loading').textContent = '展示画面加载失败，请重新选择任务重试。';
  byId('loading').classList.remove('hidden');
}
function scheduleFrames(generation) {
  if (generation !== state.generation) return;
  if (video.requestVideoFrameCallback) {
    videoCallback = video.requestVideoFrameCallback((now, metadata) => {
      if (generation !== state.generation) return;
      render(Math.round(metadata.mediaTime*20)); scheduleFrames(generation);
    });
  } else {
    videoCallback = requestAnimationFrame(() => { render(); scheduleFrames(generation); });
  }
}
function loadScene(key) {
  if (!Object.hasOwn(TASKS,key)) key='D3';
  const generation=++state.generation;
  video.pause(); state.ready=false; state.task=key; state.frame=0;
  if(videoCallback!==null) {
    if(video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoCallback);
    else cancelAnimationFrame(videoCallback);
  }
  videoListenerController?.abort(); videoListenerController=new AbortController();
  const options={signal:videoListenerController.signal};
  setEnabled(false);
  byId('loading').textContent='正在加载同步展示画面…'; byId('loading').classList.remove('hidden');
  byId('network-load').classList.add('hidden');
  document.body.classList.toggle('multimodal',key==='D4'); byId('odor-card').hidden=key!=='D4';
  document.querySelector('.model-tag').textContent=task().model;
  document.querySelector('.column-heading h1').lastChild.textContent=key==='D4'?'视嗅输入':'视觉输入';
  document.querySelector('.column-heading > span').textContent=key==='D4'?'双眼 + 触角':'左眼 / 右眼';
  document.querySelector('.eye-card .card-tag').textContent=key==='D4'?'64 × 64':'32 × 32';
  byId('camera-resolution-badge').textContent=' · HD';
  byId('task-summary').textContent=task().summary; byId('scene-id').textContent='';
  byId('network-dialog-title').textContent=`${task().model} · 模型活动`;
  document.querySelector('.footer span').textContent=`${key==='D4'?'SenseFlight-VisOlf':'SenseFlight-Vis'} · ConnectomeFlight → FlyBody`;
  document.querySelectorAll('[data-difficulty]').forEach(button => {
    const active=button.dataset.difficulty===key; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
  });
  video.addEventListener('loadeddata', () => {
    if(generation!==state.generation) return;
    state.ready=true; byId('loading').classList.add('hidden'); setEnabled(true); render(0); scheduleFrames(generation);
  },{...options,once:true});
  video.addEventListener('error',showError,{...options,once:true});
  video.src=task().media; video.load();
  const url=new URL(location.href);url.searchParams.set('task',key);history.replaceState(null,'',url);
}
function seek(frame) {
  if(!state.ready) return;
  video.pause(); frame=clamp(Math.round(frame),0,task().frames-1);
  video.currentTime=(frame+.1)/20;
  updateControls();
}
async function togglePlay() {
  if(!state.ready) return;
  if(!video.paused) {video.pause();updateControls();return;}
  if(state.frame>=task().frames-1) video.currentTime=0;
  try{await video.play();updateControls();}catch{byId('network-sync').textContent='请再次点击播放';}
}
video.addEventListener('seeked',()=>render());
video.addEventListener('pause',updateControls);
video.addEventListener('ended',()=>{render(task().frames-1);updateControls();});
byId('play-button').addEventListener('click',togglePlay);
byId('step-back').addEventListener('click',()=>seek(state.frame-1));
byId('step-forward').addEventListener('click',()=>seek(state.frame+1));
document.querySelectorAll('#timeline, [data-playback-timeline]').forEach(el=>el.addEventListener('input',()=>seek(Number(el.value))));
document.querySelectorAll('[data-playback-toggle]').forEach(el=>el.addEventListener('click',togglePlay));
byId('speed').addEventListener('change',event=>{video.playbackRate=Number(event.target.value);});
document.querySelectorAll('[data-difficulty]').forEach(el=>el.addEventListener('click',()=>loadScene(el.dataset.difficulty)));
document.querySelectorAll('[data-cell]').forEach(button=>button.addEventListener('click',()=>{
  state.cell=Number(button.dataset.cell);
  document.querySelectorAll('[data-cell]').forEach(el=>{el.classList.toggle('selected',el===button);el.setAttribute('aria-pressed',String(el===button));});
  render();
}));
document.querySelectorAll('[data-camera-view]').forEach(button=>button.addEventListener('click',()=>{
  state.expanded=button.dataset.cameraView;
  byId('camera-dialog-title').textContent=state.expanded==='follow'?'高清跟随镜头':'TOPDOWN · 固定俯视镜头';
  byId('camera-dialog-resolution').textContent=`1280 × 720 · ${task().name}`;
  byId('camera-dialog').showModal();render();
}));
byId('network-expand').addEventListener('click',()=>{byId('network-dialog').showModal();render();});
for(const id of ['info','camera','network']) byId(`${id}-close`).addEventListener('click',()=>byId(`${id}-dialog`).close());
byId('info-open').addEventListener('click',()=>byId('info-dialog').showModal());
window.addEventListener('keydown',event=>{
  if(byId('info-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(event.code==='Space'&&document.activeElement?.tagName!=='BUTTON'){event.preventDefault();togglePlay();}
  if(event.code==='ArrowLeft'){event.preventDefault();seek(state.frame-1);}
  if(event.code==='ArrowRight'){event.preventDefault();seek(state.frame+1);}
});
function bindPanelDivider() {
  const workspace = document.querySelector('.workspace');
  const flight = byId('flight-panel');
  const divider = byId('panel-divider');
  const desktop = window.matchMedia('(min-width:760px) and (min-height:560px)');
  let preferredRatio = null;
  let drag = null;

  const limits = () => {
    const style = getComputedStyle(workspace);
    const available = workspace.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.rowGap);
    const min = Math.min(160, available * .48);
    // Both panels retain useful minimum heights; the camera never gains stretched space.
    const max = Math.max(min, Math.min((flight.clientWidth - 12) * 9 / 32 + 68, available - Math.min(280, available - min)));
    return { available, min, max };
  };
  const sync = () => {
    if (!desktop.matches) { workspace.style.removeProperty('--flight-height'); divider.hidden = true; return; }
    const { available, min, max } = limits();
    divider.hidden = max - min < 2;
    if (preferredRatio === null) workspace.style.removeProperty('--flight-height');
    else workspace.style.setProperty('--flight-height', `${clamp(preferredRatio * available, min, max)}px`);
    const height = flight.getBoundingClientRect().height;
    const percent = Math.round(height / available * 100);
    divider.setAttribute('aria-valuemin', String(Math.round(min / available * 100)));
    divider.setAttribute('aria-valuemax', String(Math.round(max / available * 100)));
    divider.setAttribute('aria-valuenow', String(percent));
    divider.setAttribute('aria-valuetext', `飞行画面 ${percent}%，模型活动 ${100 - percent}%`);
  };
  const adjust = height => {
    if (!desktop.matches) return;
    const { available, min, max } = limits();
    preferredRatio = clamp(height, min, max) / available;
    sync();
  };
  const reset = () => { preferredRatio = null; sync(); };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !desktop.matches) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    drag = { y: event.clientY, height: flight.getBoundingClientRect().height, pointer: event.pointerId };
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add('is-resizing');
  });
  divider.addEventListener('pointermove', event => {
    if (drag && event.pointerId === drag.pointer) adjust(drag.height + event.clientY - drag.y);
  });
  const release = () => { drag = null; workspace.classList.remove('is-resizing'); };
  divider.addEventListener('pointerup', release);
  divider.addEventListener('pointercancel', release);
  divider.addEventListener('lostpointercapture', release);
  divider.addEventListener('dblclick', reset);
  divider.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') reset();
    else if (event.key === 'End') adjust(limits().max);
    else adjust(flight.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 36 : 12));
  });
  new ResizeObserver(sync).observe(workspace);
  window.addEventListener('resize', sync);
  sync();
}

bindPanelDivider();
loadScene(new URLSearchParams(location.search).get('task'));
