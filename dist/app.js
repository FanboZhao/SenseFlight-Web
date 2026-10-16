import { ModelNetwork } from './model-network.js?v=release-20261016';
import { OdorFieldLayer } from './odor-field.js?v=release-20261016';
const byId = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TASKS = {
  D3: { name: '纯视觉任务', model: 'ConnectomeFlight-V · T4/T5 · 3131 参数', frames: 187, media: './media/d3.mp4?v=release-20261016', summary: '随机树林 · 绕行抵达可见棋盘目标' },
  D4: { name: '多模态任务', model: 'ConnectomeFlight-M-VO', frames: 408, media: './media/d4.mp4?v=release-20261016', summary: '视觉与嗅觉导航 · 选定成功案例' },
};
const CROPS = {follow:[0,0,1280,720],topdown:[1280,0,1280,720]};
const modelNetwork = new ModelNetwork();
const odorField = new OdorFieldLayer();
const TRACE_COLOR = '#a9dfc7';
const video = byId('replay-source');
const state = { task: 'D3', scene: null, frame: 0, cell: 0, ready: false, pendingFrame: null, generation: 0, expanded: 'follow' };
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
  if (crop === CROPS.topdown) drawTopdownMarker(canvas, ctx);
}

function drawTopdownMarker(canvas, ctx) {
  const point = state.scene?.topdownMarkerXY[state.frame];
  if (!point) return;
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
  if (scale <= 0) return;
  ctx.save(); ctx.translate(point[0], point[1]); ctx.scale(1 / scale, 1 / scale);
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.strokeStyle = '#c4fff1'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.restore();
}
function render(frame = Math.floor(video.currentTime * 20 + .001)) {
  if (!state.ready || video.readyState < 2 || video.seeking) return;
  state.frame = clamp(frame, 0, task().frames - 1);
  state.pendingFrame = null;
  paint('camera-image', CROPS.follow); paint('topdown-image', CROPS.topdown);
  modelNetwork.setFrame(state.frame);
  for(let eye=0;eye<2;eye++) {
    const canvas=byId(eye?'eye-right':'eye-left'),source=modelNetwork.eyeCanvas[eye];
    canvas.width=source.width; canvas.height=source.height; canvas.getContext('2d').drawImage(source,0,0);
    drawHex(byId(eye?'hex-right':'hex-left'),'visual',eye);
    drawHex(byId(eye?'t4-right':'t4-left'),'activity',eye);
  }
  drawTrajectory();
  const position=state.scene.positionsXYZCm[state.frame];
  byId('position-xy').textContent=`${position[0].toFixed(2)}, ${position[1].toFixed(2)}`;
  byId('distance').textContent=`${state.scene.distanceCm[state.frame].toFixed(2)} cm`;
  byId('camera-position').textContent=`高度 ${position[2].toFixed(2)} cm`;
  if(state.scene.odorConcentrations) {
    state.scene.odorConcentrations[state.frame].forEach((v,i)=>{byId(`odor-${i}`).textContent=v.toFixed(4);byId(`odor-meter-${i}`).value=v;});
    const [mean,diff]=state.scene.odorFeatures[state.frame];byId('odor-features').textContent=`强度 ${mean.toFixed(3)} · 左右差 ${diff.toFixed(3)}`;
  }
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
    el.max = String(task().frames-1); el.value = String(state.pendingFrame ?? state.frame);
    el.style.setProperty('--progress', `${state.frame/(task().frames-1)*100}%`);
    el.setAttribute('aria-valuetext', `第 ${state.frame+1} 帧，共 ${task().frames} 帧`);
  });
  modelNetwork.setPlaybackActive(playing);
}
function setEnabled(enabled) {
  document.querySelectorAll('#play-button, #step-back, #step-forward, #timeline, #network-expand, [data-camera-view], [data-playback-toggle], [data-playback-timeline]').forEach(el => { el.disabled = !enabled; });
}
function showError() {
  state.ready = false; video.pause(); setEnabled(false); modelNetwork.clearScene();
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
async function loadScene(key) {
  if (!Object.hasOwn(TASKS,key)) key='D3';
  const generation=++state.generation;
  video.pause(); state.ready=false; state.task=key; state.scene=null; state.frame=0; state.pendingFrame=null;
  modelNetwork.clearScene();
  if(videoCallback!==null) {
    if(video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoCallback);
    else cancelAnimationFrame(videoCallback);
  }
  videoListenerController?.abort(); videoListenerController=new AbortController();
  const options={signal:videoListenerController.signal};
  setEnabled(false);
  byId('loading').textContent='正在加载同步展示…';byId('loading').classList.remove('hidden');
  document.body.classList.toggle('multimodal',key==='D4');byId('odor-card').hidden=key!=='D4';
  document.querySelector('.model-tag').textContent=task().model;
  document.querySelector('.column-heading h1').lastChild.textContent=key==='D4'?'视嗅输入':'视觉输入';
  document.querySelector('.column-heading > span').textContent=key==='D4'?'双眼 + 触角':'左眼 / 右眼';
  document.querySelector('.eye-card .card-tag').textContent=key==='D4'?'64 × 64':'32 × 32';
  byId('camera-resolution-badge').textContent=' · HD';byId('task-summary').textContent=task().summary;byId('scene-id').textContent='';
  byId('network-dialog-title').textContent=`${task().model} · ${key==='D4'?'视嗅融合到动作':'从视觉到动作'}`;
  document.querySelector('.footer span').textContent=`${key==='D4'?'SenseFlight-VisOlf':'SenseFlight-Vis'} · ConnectomeFlight → FlyBody`;
  document.querySelectorAll('[data-difficulty]').forEach(button=>{const active=button.dataset.difficulty===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const url=new URL(location.href);url.searchParams.set('task',key);history.replaceState(null,'',url);
  try {
    const mediaReady=new Promise((resolve,reject)=>{
      video.addEventListener('loadeddata',resolve,{...options,once:true});
      video.addEventListener('error',()=>reject(new Error('视频加载失败')),{...options,once:true});
    });
    video.src=task().media;video.load();
    const [scene]=await Promise.all([
      fetch(`./media/${key.toLowerCase()}-display.json?v=release-20261016`,{signal:options.signal}).then(r=>{if(!r.ok)throw new Error('展示信息加载失败');return r.json();}),
      mediaReady,key==='D4'?odorField.load():Promise.resolve(),
    ]);
    if(generation!==state.generation)return;
    if(scene.format!=='presentation-v2'||scene.difficulty!==key||scene.frames!==task().frames)throw new Error('展示帧数不匹配');
    state.scene=scene;
    await modelNetwork.loadScene(scene,task().name);
    if(generation!==state.generation)return;
    state.ready=true;byId('loading').classList.add('hidden');setEnabled(true);render(0);scheduleFrames(generation);
  }catch(error){if(generation===state.generation){console.error(error);showError();}}
}

function seek(frame) {
  if(!state.ready) return;
  frame=clamp(Math.round(frame),0,task().frames-1);
  state.pendingFrame=frame; video.pause();
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
byId('step-back').addEventListener('click',()=>seek((state.pendingFrame ?? state.frame)-1));
byId('step-forward').addEventListener('click',()=>seek((state.pendingFrame ?? state.frame)+1));
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

for(const id of ['info','camera']) byId(`${id}-close`).addEventListener('click',()=>byId(`${id}-dialog`).close());
byId('info-open').addEventListener('click',()=>byId('info-dialog').showModal());
byId('cell-types-open').addEventListener('click',()=>{byId('cell-type-details').open=true;byId('info-dialog').showModal();byId('cell-type-details').scrollIntoView({block:'nearest'});});
byId('network-cell-types').addEventListener('click',event=>{if(event.target.closest('button'))byId('info-dialog').close();});
byId('camera-original').addEventListener('click',()=>{byId('camera-original').href=byId('camera-image-large').toDataURL('image/png');});
window.addEventListener('resize',()=>{if(state.ready)render();});

window.addEventListener('keydown',event=>{
  if(byId('info-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(event.code==='Space'&&document.activeElement?.tagName!=='BUTTON'){event.preventDefault();togglePlay();}
  if(event.code==='ArrowLeft'){event.preventDefault();seek((state.pendingFrame ?? state.frame)-1);}
  if(event.code==='ArrowRight'){event.preventDefault();seek((state.pendingFrame ?? state.frame)+1);}
});
function canvasContext(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth; canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function hexGeometry(width, height) {
  const unit = Math.min((width - 9) / 28.8, (height - 9) / 32.5);
  return { unit, radius: unit / Math.sqrt(3) * 0.97, x0: width / 2, y0: height / 2 };
}
function hexCenter(uv, geometry) {
  const [u, v] = uv;
  // FlyVis BoxEye receptor_centers are stored as (y, x) = (u + v/2, v).
  // Scale x by sqrt(3)/2 only to draw a regular hex lattice.
  return [geometry.x0 + v * Math.sqrt(3) / 2 * geometry.unit,
    geometry.y0 + (u + v / 2) * geometry.unit];
}

function drawHex(canvas, kind, eye) {
  const { ctx, width, height } = canvasContext(canvas);
  const geometry = hexGeometry(width, height);
  const uv = state.scene.hexUV;
  ctx.fillStyle = '#0d1820';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < uv.length; i++) {
    const [x, y] = hexCenter(uv[i], geometry);
    const index = kind === 'visual' ? state.scene.sensorOffsets.hexVisual + eye * 721 + i : state.scene.sensorOffsets.hexActivity + (eye * 8 + state.cell) * 721 + i;
    ctx.fillStyle = modelNetwork.colorAt(index);
    ctx.beginPath();
    for (let point = 0; point < 6; point++) {
      const angle = point * Math.PI / 3;
      const px = x + Math.cos(angle) * geometry.radius;
      const py = y + Math.sin(angle) * geometry.radius;
      if (point === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}


function drawTrajectory() {
  const canvas = byId('trajectory');
  const { ctx, width, height } = canvasContext(canvas);
  const points = state.scene.positionsXYZCm;
  const obstacles = state.scene.obstaclePositionsXYCm;
  const source = state.scene.sourcePositionXYCm;
  const marker = state.scene.goalMarkerSegmentXYCm;
  const markerPoint = fraction => marker[0].map((v, axis) => v + (marker[1][axis] - v) * (fraction + .5));
  const markerEnds = marker ? [markerPoint(-.5), markerPoint(.5)] : [];
  const allX = [...points.map((p) => p[0]), ...obstacles.map((p) => p[0]), ...markerEnds.map(p => p[0]), ...(state.scene.goalPositionsXYCm || []).map(p => p[0]), source[0]];
  const allY = [...points.map((p) => p[1]), ...obstacles.map((p) => p[1]), ...markerEnds.map(p => p[1]), ...(state.scene.goalPositionsXYCm || []).map(p => p[1]), source[1]];
  const minX = Math.min(...allX) - 2.5, maxX = Math.max(...allX) + 2.5;
  const minY = Math.min(...allY) - 2.5, maxY = Math.max(...allY) + 2.5;
  // Rotate the display by 90 degrees in a tall panel; preserve uniform scale and scene geometry.
  const vertical = height > width * 1.2;
  const scale = Math.min((width - 34) / (vertical ? maxY - minY : maxX - minX), (height - 34) / (vertical ? maxX - minX : maxY - minY));
  const worldWidth = (vertical ? maxY - minY : maxX - minX) * scale, worldHeight = (vertical ? maxX - minX : maxY - minY) * scale;
  const offsetX = (width - worldWidth) / 2, offsetY = (height - worldHeight) / 2;
  const project = (p) => vertical
    ? [width - offsetX - (p[1] - minY) * scale, height - offsetY - (p[0] - minX) * scale]
    : [offsetX + (p[0] - minX) * scale, height - offsetY - (p[1] - minY) * scale];
  const unproject = (p) => vertical
    ? [minX + (height - offsetY - p[1]) / scale, minY + (width - offsetX - p[0]) / scale]
    : [minX + (p[0] - offsetX) / scale, minY + (height - offsetY - p[1]) / scale];
  const odor = state.scene.odorConcentrations;
  byId('trajectory-view').textContent = vertical ? '俯视 · X↑' : '俯视 · X→';
  ctx.fillStyle = '#0d1820'; ctx.fillRect(0, 0, width, height);
  if (odor) odorField.draw(ctx, { width, height, unproject, source, time: state.frame * .05 });
  ctx.strokeStyle = 'rgba(170,199,207,.07)'; ctx.lineWidth = 1;
  const extraX = (vertical ? offsetY : offsetX) / scale, extraY = (vertical ? offsetX : offsetY) / scale;
  for (let x = Math.ceil((minX - extraX) / 2) * 2; x <= maxX + extraX; x += 2) {
    const [px, py] = project([x, 0]); ctx.beginPath(); ctx.moveTo(vertical ? 0 : px, vertical ? py : 0); ctx.lineTo(vertical ? width : px, vertical ? py : height); ctx.stroke();
  }
  for (let y = Math.ceil((minY - extraY) / 2) * 2; y <= maxY + extraY; y += 2) {
    const [px, py] = project([0, y]); ctx.beginPath(); ctx.moveTo(vertical ? px : 0, vertical ? 0 : py); ctx.lineTo(vertical ? px : width, vertical ? height : py); ctx.stroke();
  }
  ctx.fillStyle = '#79949f'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'left';
  ctx.fillText(vertical ? 'Y ←' : 'Y ↑', 11, 17);
  ctx.fillText('2 cm', 11, height - 19); ctx.strokeStyle = '#79949f';
  ctx.beginPath(); ctx.moveTo(11, height - 11); ctx.lineTo(11 + scale * 2, height - 11); ctx.stroke();
  obstacles.forEach((position, i) => {
    const [x, y] = project(position), radius = state.scene.obstacleRadiiCm[i] * scale;
    ctx.fillStyle = '#2b414b'; ctx.strokeStyle = '#728b96'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, Math.max(radius, 3), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d2e0e5'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x, y + 3);
  });
  (state.scene.goalPositionsXYCm || []).forEach((goal, index) => {
    if (index === state.scene.activeGoal) return;
    const [gx, gy] = project(goal);
    ctx.strokeStyle = '#92a5b6'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI * 2); ctx.stroke();
  });
  const [tx, ty] = project(source);
  if (marker) {
    for (let column = 0; column < 3; column++) {
      const a = project(markerPoint(column / 3 - .5));
      const b = project(markerPoint((column + 1) / 3 - .5));
      ctx.strokeStyle = column % 2 ? '#59656c' : '#e7edee'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
  }
  ctx.strokeStyle = '#dfbb83'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx - 12, ty); ctx.lineTo(tx - 8, ty); ctx.moveTo(tx + 8, ty); ctx.lineTo(tx + 12, ty); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx, ty - 12); ctx.lineTo(tx, ty - 8); ctx.moveTo(tx, ty + 8); ctx.lineTo(tx, ty + 12); ctx.stroke();
  ctx.fillStyle = '#dfbb83'; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(state.scene.odorFeatures ? '气味源' : marker ? '棋盘目标' : '目标', tx, ty + 25);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#617b84'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
  ctx.beginPath(); points.forEach((p, i) => { const [x, y] = project(p); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = TRACE_COLOR; ctx.lineWidth = 2.5;
  ctx.beginPath(); points.slice(0, state.frame + 1).forEach((p, i) => { const [x, y] = project(p); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  const [sx, sy] = project(points[0]);
  ctx.fillStyle = '#0d1820'; ctx.strokeStyle = TRACE_COLOR; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9fbbb4'; ctx.fillText('起点', sx, sy + 22);
  const position = points[state.frame], previous = points[Math.max(0, state.frame - 1)];
  const following = points[Math.min(points.length - 1, state.frame + 1)];
  const [fx, fy] = project(position);
  ctx.fillStyle = '#a9dfc71a'; ctx.beginPath(); ctx.arc(fx, fy, 16, 0, Math.PI * 2); ctx.fill();
  const angle = Math.atan2(following[1] - previous[1], following[0] - previous[0]);
  ctx.save(); ctx.translate(fx, fy); ctx.rotate(-angle - (vertical ? Math.PI / 2 : 0));
  ctx.fillStyle = TRACE_COLOR; ctx.strokeStyle = '#0d1820'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}


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
