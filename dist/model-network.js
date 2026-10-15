/* Interactive display renderer. Inputs are RGBA appearance pixels and display geometry. */
const byId = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COLORS = Array.from({ length: 257 }, (_, i) => {
  const t = (i - 128) / 128, a = [34, 68, 60];
  const start = t > .7 ? [165, 228, 176] : a;
  const end = t < 0 ? [122, 178, 226] : t <= .7 ? [165, 228, 176] : [252, 219, 145];
  const k = t < 0 ? -t : t <= .7 ? t / .7 : (t - .7) / .3;
  return `rgb(${start.map((v, j) => Math.round(v + (end[j] - v) * k)).join(',')})`;
});
const STAGES = [
  { id: 'eyes', x: .06, name: '双眼画面', detail: '32 × 32 RGB / 眼' },
  { id: 'vision', x: .265, name: 'FlyVis 视觉网络', detail: '真实细胞活动 · 节点抽样' },
  { id: 'pooled', x: .50, name: '运动特征', detail: '144 · T4/T5 × 3×3 × 双眼' },
  { id: 'readout', x: .625, name: '特征整合', detail: '80 · ReLU' },
  { id: 'latent', x: .735, name: '视觉编码', detail: '32 · ReLU' },
  { id: 'control', x: .835, name: '动作控制', detail: '32 · tanh' },
  { id: 'actions', x: .945, name: '飞行动作', detail: '3 · tanh' },
];
const COMPACT_LABELS = {
  eyes: ['双眼画面', 'RGB'], vision: ['视觉网络', 'FlyVis'], pooled: ['运动特征', '144维'],
  readout: ['特征整合', '80维'], latent: ['视觉编码', '32维'], control: ['动作控制', '32维'],
  actions: ['飞行动作', '3项'],
};
// Fit the explanatory projection to both dimensions; display nodes retain their original placement.
const projectionScale = (width, height, overview = false) => Math.min(Math.max(0, height - 54) / 360, width / (overview ? 650 : 1100), 1.4);

export class ModelNetwork {
  constructor() {
    this.small = byId('network-canvas'); this.large = byId('network-canvas-large');
    this.dialog = byId('network-dialog'); this.frame = 0; this.playing = false;
    this.hasActivity = false; this.needsDraw = true; this.lastPaint = 0;
    this.yaw = -.22; this.pitch = .10; this.focus = 'all'; this.cellType = -1;
    this.data = null; this.loadId = 0; this.projected = new Map();
    this.eyeCanvas = [document.createElement('canvas'), document.createElement('canvas')];
    this.eyeCanvas.forEach(c => { c.width = c.height = 32; });
    this.bind(); requestAnimationFrame(now => this.loop(now));
  }

  applyTopology(topology) {
    if (topology.format !== 'rendered-rgba-v1') throw new Error('模型活动版本不匹配');
    this.topology = topology;
    this.multimodal = topology.layers.some(l => l.id === 'odorMemory');
    this.stages = this.multimodal ? [...STAGES,
      { id:'odorInput', x:.625 }, { id:'odorMemory', x:.735 }] : STAGES;
    this.projectionCache = new Map(); this.hover = null; this.cellType = -1; this.focus = 'all';
    byId('network-population').textContent = `${(topology.fullNodesPerEye * 2).toLocaleString()} 个视觉单元 · 显示 ${(topology.sampledNodesPerEye * 2).toLocaleString()} 个 · ${topology.cellTypes.length} 类细胞`;
    byId('network-sampling').textContent = '节点使用量化后的显示颜色；图形布局与交互保留，精确活动数值不公开。';
    this.buildNodes(); this.buildTypeControls(); this.updateFocusButtons();
  }

  clearScene() {
    this.loadId++; this.data = null; this.frame = 0; this.hasActivity = false; this.hover = null;
    byId('network-load').classList.remove('hidden');
    byId('network-load').textContent = '正在加载同一回放的真实模型活动…';
    byId('network-validation').textContent = '正在读取展示颜色贴图…';
    byId('network-expand').disabled = true;
    this.showInspection('悬停查看类型 · 拖动调整视角');
    this.updateReadouts();
    this.needsDraw = true;
  }

  async loadScene(scene, taskName) {
    const loadId = ++this.loadId;
    const layout = scene.networkLayout;
    const image = new Image(); image.src = `${layout.appearance}?v=interactive-20261015`;
    await image.decode();
    if (loadId !== this.loadId) return;
    if (image.width !== layout.imageWidth || image.height !== layout.imageHeight) throw new Error('展示颜色贴图尺寸不匹配');
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', {willReadFrequently:true}); ctx.drawImage(image, 0, 0);
    this.applyTopology(layout);
    this.data = { pixels: ctx.getImageData(0,0,image.width,image.height).data };
    this.scene = scene; this.taskName = taskName; this.frame = 0; this.hasActivity = false;
    this.stride = layout.imageWidth * layout.rowsPerFrame; this.rgbCache = new Map();
    this.eyeSize = scene.sensorOffsets.eyeSize;
    this.eyeCanvas.forEach(c => { c.width = c.height = this.eyeSize; });
    this.updateEyes(); this.updateReadouts(); this.needsDraw = true;
    byId('network-load').classList.add('hidden'); byId('network-expand').disabled = false;
    byId('network-validation').textContent = '显示颜色与同一回放帧同步；不读取或运行模型参数。';
  }

  buildNodes() {
    this.nodes = this.topology.nodes.map(([stage,eye,type,unit,u,v,dx,dy,dz], index) => ({stage,eye,type,unit,original:unit,u,v,dx,dy,dz,index}));
    this.visionCount = this.topology.sampledNodesPerEye * 2;
    this.needsDraw = true;
  }

  pixelOffset(index) { return (this.frame * this.stride + index) * 4; }

  colorAt(index) {
    const p = this.pixelOffset(index), data = this.data.pixels;
    const key = data[p] * 65536 + data[p+1] * 256 + data[p+2];
    if (!this.rgbCache.has(key)) this.rgbCache.set(key, `rgb(${data[p]},${data[p+1]},${data[p+2]})`);
    return this.rgbCache.get(key);
  }

  buildTypeControls() {
    const container = byId('network-cell-types'); container.replaceChildren();
    this.topology.cellTypes.forEach((info, type) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = info.name; button.dataset.type = String(type); button.setAttribute('aria-pressed', 'false');
      button.title = `${info.name} · 每眼 ${info.count} 个节点`;
      button.addEventListener('click', () => {
        this.cellType = this.cellType === type ? -1 : type; this.focus = this.cellType >= 0 ? 'vision' : 'all';
        this.updateFocusButtons(); this.updateReadouts(); this.needsDraw = true;
      }); container.append(button);
    });
  }

  setPlaybackActive(value) {
    this.playing = Boolean(value);
    if (this.playing && this.data) this.hasActivity = true;
    this.updateReadouts(); this.needsDraw = true;
  }

  setFrame(frame) {
    if (!this.data) return;
    const f = clamp(Math.round(frame), 0, this.scene.frames - 1);
    if (f === this.frame && !this.needsDraw) return;
    this.frame = f; if (f > 0 || this.playing) this.hasActivity = true;
    this.updateEyes(); this.updateReadouts(); this.needsDraw = true;
  }

  value(node) { return node.stage === 'actions' ? this.scene.actions[this.frame][node.unit] : 0; }

  normalized(node) {
    if (!this.hasActivity) return 0;
    const alpha = this.data.pixels[this.pixelOffset(node.index) + 3] / 255;
    return clamp(node.stage === 'vision' ? (alpha - .30) / .66 : (alpha - .60) / .40, 0, 1);
  }

  updateEyes() {
    if (!this.data) return;
    const size = this.eyeSize;
    for(let eye=0;eye<2;eye++) {
      const ctx = this.eyeCanvas[eye].getContext('2d'), image = ctx.createImageData(size,size);
      const width=this.topology.imageWidth, columns=Math.floor(width/size), tile=this.frame*2+eye;
      for(let y=0;y<size;y++) {
        const start=(this.scene.sensorOffsets.eyes+(Math.floor(tile/columns)*size+y)*width+(tile%columns)*size)*4;
        image.data.set(this.data.pixels.subarray(start,start+size*4),y*size*4);
      }
      ctx.putImageData(image,0,0);
    }
  }

  updateReadouts() {
    const status = !this.data ? '等待展示数据' : !this.hasActivity ? `${this.taskName} · 点击播放，点亮模型活动` : `${this.taskName} · ${this.playing ? '● 同步播放' : '○ 当前帧已冻结'} · ${String(this.frame+1).padStart(3,'0')} / ${this.scene.frames}`;
    byId('network-sync').textContent = status; byId('network-dialog-status').textContent = status;
    for(let a=0;a<3;a++) {
      const v = this.data && this.hasActivity ? this.scene.actions[this.frame][a] : 0;
      byId(`network-action-${a}`).textContent = this.hasActivity ? v.toFixed(3) : '—';
      byId(`network-action-bar-${a}`).style.setProperty('--value', `${Math.abs(v)*50}%`);
      byId(`network-action-bar-${a}`).classList.toggle('negative',v<0);
    }
    if (this.hover && this.data) this.showInspection(this.inspect(this.nodes[this.hover.index]));
    else if(this.cellType>=0) this.showInspection(`${this.topology.cellTypes[this.cellType].name} · 拖动调整视角 · 显示颜色已量化`);
    else this.showInspection(this.multimodal ? '上路：视觉编码 · 下路：嗅觉记忆 · 拖动调整视角' : '悬停查看类型 · 拖动调整视角');
  }

  updateFocusButtons() {
    document.querySelectorAll('#network-cell-types button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.type) === this.cellType)));
    byId('cell-types-open').textContent = this.cellType >= 0 ? this.topology.cellTypes[this.cellType].name : '细胞类型';
  }

  project(canvas, width, height) {
    const cache = this.projectionCache?.get(canvas);
    const key = `${width}/${height}/${this.yaw}/${this.pitch}/${this.multimodal}`;
    if (cache?.key === key) return cache.points;
    const points = new Float32Array(this.nodes.length * 2), anchors = Object.fromEntries(this.stages.map(s => [s.id, s.x * width]));
    const s = projectionScale(width, height, canvas === this.small), center = height * .51;
    // Policy layers use the available vertical space independently of the two-eye projection.
    const policyX = Math.min(width / 850, 1.3), policyY = Math.min(Math.max(0, height - 96) / 150, 1.6);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.nodes.forEach((node, i) => {
      const x = node.dx * cy + node.dz * sy, z = -node.dx * sy + node.dz * cy;
      const y = node.dy * cp - z * sp;
      points[i * 2] = anchors[node.stage] + x * s;
      points[i * 2 + 1] = center + y * s + (node.stage === 'vision' ? (node.eye ? 92 : -92) * s : 0);
      if (node.stage !== 'vision' && node.stage !== 'actions') {
        points[i * 2] = anchors[node.stage] + x * policyX;
        points[i * 2 + 1] = center + y * policyY;
      }
      if (this.multimodal && ['readout', 'latent', 'odorInput', 'odorMemory'].includes(node.stage)) {
        const lower = node.stage.startsWith('odor');
        points[i * 2 + 1] = height * (lower ? .76 : .34) + y * policyY * .43;
      }
      if (node.stage === 'actions') points[i * 2 + 1] = center + node.dy * Math.min(height / 340, 1.4);
    });
    this.projected.set(canvas, points);
    if (!this.projectionCache) this.projectionCache = new Map();
    this.projectionCache.set(canvas, { key, points }); return points;
  }

  draw(canvas) {
    if (!this.topology || canvas.clientWidth < 2) return;
    const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, width, height); bg.addColorStop(0, '#0b1520'); bg.addColorStop(.48, '#0c1a20'); bg.addColorStop(1, '#0b141b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    for (const stage of STAGES.filter(stage => ['pooled', 'readout', 'latent', 'control'].includes(stage.id))) {
      const bandWidth = width * (stage.id === 'pooled' ? .095 : .078);
      ctx.fillStyle = '#afcbd005'; ctx.fillRect(stage.x * width - bandWidth / 2, 43, bandWidth, height - 76);
      ctx.strokeStyle = '#afcbd012'; ctx.beginPath(); ctx.moveTo(stage.x * width - bandWidth / 2, 43); ctx.lineTo(stage.x * width - bandWidth / 2, height - 33); ctx.stroke();
    }
    const compact = width < 760 || height < 320;
    for (const stage of STAGES) {
      const x = stage.x * width, labels = compact || width < 1100 ? COMPACT_LABELS[stage.id] : [stage.name, stage.detail];
      ctx.textAlign = 'center'; ctx.fillStyle = '#dceae7'; ctx.font = `600 ${width < 640 ? 11 : 12}px -apple-system, sans-serif`;
      // Keep semantic names readable when several stages share a narrow panel.
      const titleLines = compact && width < 520 ? [labels[0].slice(0, 2), labels[0].slice(2)] : [labels[0]];
      titleLines.forEach((line, i) => ctx.fillText(line, x, titleLines.length > 1 ? 17 + i * 14 : compact ? 20 : 26));
      ctx.fillStyle = '#99bba5'; ctx.font = '10px ui-monospace, monospace'; if (!this.multimodal || !['readout', 'latent'].includes(stage.id)) ctx.fillText(labels[1], x, height - (compact ? 12 : 18));
    }
    if (this.multimodal) {
      ctx.fillStyle = '#d6bcf1'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center';
      if (width < 520) {
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillText('嗅觉', width * .625, height * .60); ctx.fillText('输入', width * .625, height * .60 + 12);
        ctx.fillText('RNN', width * .735, height * .60); ctx.fillText('记忆', width * .735, height * .60 + 12);
      } else {
        ctx.fillText('嗅觉输入', width * .625, height * .62);
        ctx.fillText('RNN 记忆', width * .735, height * .62);
      }
      ctx.fillStyle = '#99aebb'; ctx.font = '9px -apple-system, sans-serif';
      ctx.fillText('2维 → 32维 · tanh', width * .68, height - 30);
    }
    const overview = canvas === this.small;
    const p = this.project(canvas, width, height), s = projectionScale(width, height, overview), center = height * .51;
    for (let eye = 0; eye < 2; eye++) {
      const y = center + (eye ? 92 : -92) * s, x = .265 * width;
      const glow = ctx.createRadialGradient(x, y, 4, x, y, 92 * s); glow.addColorStop(0, '#92deb81b'); glow.addColorStop(1, '#92deb800');
      ctx.fillStyle = glow; ctx.fillRect(x - 100 * s, y - 100 * s, 200 * s, 200 * s);
      ctx.strokeStyle = '#75b49740'; ctx.beginPath(); ctx.ellipse(x, y, 80 * s, 74 * s, -.20, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#b1d5bd'; ctx.font = `${compact ? 9 : 10}px ui-monospace,monospace`; ctx.fillText(compact ? (eye ? 'R' : 'L') : (eye ? 'RIGHT NETWORK' : 'LEFT NETWORK'), x, y - 82 * s);
      ctx.imageSmoothingEnabled = false; const imageSize = 54 * s;
      if (this.data) ctx.drawImage(this.eyeCanvas[eye], .06 * width - imageSize / 2, y - imageSize / 2, imageSize, imageSize);
      ctx.strokeStyle = '#9fc8ad70'; ctx.strokeRect(.06 * width - imageSize / 2 - 3, y - imageSize / 2 - 3, imageSize + 6, imageSize + 6);
      ctx.fillStyle = '#a1bcaa'; ctx.fillText(compact ? (eye ? 'R' : 'L') : (eye ? 'RIGHT EYE' : 'LEFT EYE'), .06 * width, y + imageSize / 2 + (compact ? 12 : 20));
      // These arrows describe the preprocessing flow, not inferred synapses.
      ctx.strokeStyle = '#96d5ad50'; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(.06 * width + imageSize / 2 + 8, y); ctx.lineTo(x - 86 * s, y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.data) this.topology.edges.forEach(([source,target],index) => this.drawEdge(ctx,p,{source,target,index}));
    this.nodes.forEach((node, i) => {
      const x = p[i * 2], y = p[i * 2 + 1], norm = this.normalized(node);
      const focused = (this.focus === 'all' || this.focus === node.stage) && (this.cellType < 0 || node.stage !== 'vision' || node.type === this.cellType);
      ctx.globalAlpha = focused ? (this.hasActivity ? this.data.pixels[this.pixelOffset(i)+3]/255 : node.stage === 'vision' ? .30 : .6) : .13;
      ctx.fillStyle = this.hasActivity ? this.colorAt(i) : COLORS[128];
      const size = node.stage === 'actions' ? (compact ? 6 : 8) : node.stage === 'vision' ? Math.max(overview ? .9 : 0, (1 + Math.abs(norm) * .8) * s) : Math.max(overview ? 1.2 : 0, (2.3 + Math.abs(norm) * 1.3) * s);
      if (node.stage !== 'vision') {
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        if (node.stage !== 'actions') { ctx.strokeStyle = '#9bbfb43d'; ctx.lineWidth = .55; ctx.stroke(); }
      }
      else ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (node.stage === 'actions') {
        ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.fillStyle = '#e7edda'; ctx.font = `600 ${compact ? 10 : 12}px -apple-system, sans-serif`;
        ctx.fillText(['前进', '转向', '升降'][node.unit], x, y + (compact ? 16 : 25));
        if (!compact) {
          ctx.fillStyle = '#e9d395'; ctx.font = '700 12px ui-monospace,monospace'; ctx.fillText(this.hasActivity ? this.value(node).toFixed(3) : '—', x, y + 43);
        }
      }
    }); ctx.globalAlpha = 1;
    if (this.hover?.canvas === canvas) {
      const i = this.hover.index, node = this.nodes[i], x = p[i * 2], y = p[i * 2 + 1];
      ctx.strokeStyle = '#f6d88d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    }
  }

  drawEdge(ctx,p,edge) {
    const src = this.nodes[edge.source], dst = this.nodes[edge.target];
    const index = this.nodes.length + edge.index;
    const alpha = this.hasActivity ? this.data.pixels[this.pixelOffset(index)+3]/255 : .035;
    const strength = clamp((alpha-.035)/.30,0,1);
    const focused = this.focus==='all' || src.stage===this.focus || dst.stage===this.focus;
    ctx.globalAlpha = focused ? alpha : .018;
    ctx.strokeStyle = this.hasActivity ? this.colorAt(index) : '#b0deb0';
    ctx.lineWidth = (ctx.canvas===this.small ? .65 : .45) + strength;
    const x1=p[edge.source*2],y1=p[edge.source*2+1],x2=p[edge.target*2],y2=p[edge.target*2+1];
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.bezierCurveTo(x1+(x2-x1)*.4,y1,x1+(x2-x1)*.6,y2,x2,y2); ctx.stroke(); ctx.globalAlpha=1;
  }

  inspect(node) {
    if (!this.hasActivity) return '点击播放或拖动时间轴后查看活动画面。';
    if (node.stage==='vision') return `${node.eye?'右':'左'}眼 ${this.topology.cellTypes[node.type].name} · 节点 ${node.original} · (u,v)=(${node.u},${node.v}) · 显示颜色已量化`;
    const layer=this.topology.layers.find(l=>l.id===node.stage);
    return `${layer.title} · 单元 ${node.unit} · 显示颜色已量化`;
  }

  showInspection(text) {
    byId('network-inspector').textContent = text;
    byId('network-dialog-inspector').textContent = text;
    byId('model-network').classList.toggle('has-inspection', Boolean(this.hover) || (this.hasActivity && this.cellType >= 0));
  }

  bindCanvas(canvas) {
    canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; canvas.setPointerCapture(e.pointerId); this.drag = { canvas, id: e.pointerId, x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointermove', e => {
      if (this.drag?.canvas === canvas && this.drag.id === e.pointerId) {
        this.yaw = clamp(this.yaw + (e.clientX - this.drag.x) * .006, -.8, .8); this.pitch = clamp(this.pitch + (e.clientY - this.drag.y) * .004, -.4, .4);
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.needsDraw = true; return;
      }
      if (!this.data) return;
      const p = this.projected.get(canvas); if (!p) return;
      const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      let nearest = -1, distance = 100;
      for (let i = 0; i < this.nodes.length; i++) { const d = (p[i * 2] - x) ** 2 + (p[i * 2 + 1] - y) ** 2; if (d < distance) { nearest = i; distance = d; } }
      this.hover = nearest < 0 ? null : { canvas, index: nearest }; this.needsDraw = true;
      if (nearest >= 0) this.showInspection(this.inspect(this.nodes[nearest]));
      else this.updateReadouts();
    });
    const release = () => { this.drag = null; };
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.updateReadouts(); this.needsDraw = true; });
  }

  bind() {
    this.bindCanvas(this.small); this.bindCanvas(this.large);
    byId('network-expand').addEventListener('click', () => { this.dialog.showModal(); this.needsDraw = true; });
    byId('network-close').addEventListener('click', () => this.dialog.close());
    window.addEventListener('resize', () => { this.needsDraw = true; });
    this.resizeObserver = new ResizeObserver(() => { this.needsDraw = true; });
    this.resizeObserver.observe(this.small.parentElement);
    this.resizeObserver.observe(this.large.parentElement);
  }

  loop(now) {
    if (document.visibilityState === 'visible' && this.topology && this.needsDraw && now - this.lastPaint >= 40) {
      this.draw(this.small); if (this.dialog.open) this.draw(this.large);
      this.lastPaint = now; this.needsDraw = false;
    }
    requestAnimationFrame(next => this.loop(next));
  }
}
