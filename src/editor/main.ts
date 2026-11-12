import { CHARACTER_IDS, getChar } from '../core/characters';
import type { MoveDef } from '../core/types';
import { animSlots, type AnimSlot } from '../shared/animations';
import { deriveTiming, rectToSpriteBox, spriteBoxToRect, type CharacterSpriteData, type MoveProps } from '../shared/spriteFormat';
import { buildExport, download, fetchFromProject, importExport, saveToProject } from './exporter';
import { anchorOf, loadImage, naturalCompare, opaqueBounds, processFile, toCanvas, type Processed } from './image';
import {
  History,
  emptyProject,
  loadProject,
  newId,
  saveProject,
  type EditorAnim,
  type EditorFrame,
  type EditorProject,
} from './project';
import { BOX_COLOR, FrameView, Preview, imageFor, type BoxKind, type Tool } from './view';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ───── 狀態 ─────
let charId = CHARACTER_IDS[0];
let project: EditorProject = emptyProject(charId);
let slots: AnimSlot[] = animSlots(getChar(charId));
let animKey = slots[0].key;
let frameIdx = 0;
let tool: Tool = 'select';
const history = new History();
let saveTimer = 0;
let dirty = false; // 有尚未存檔的修改

function anim(): EditorAnim {
  const slot = slots.find((s) => s.key === animKey);
  return (project.anims[animKey] ??= { loop: slot?.loop ?? false, frames: [] });
}
function frames(): EditorFrame[] { return project.anims[animKey]?.frames ?? []; }
function frame(): EditorFrame | null { return frames()[frameIdx] ?? null; }
function slot(): AnimSlot | undefined { return slots.find((s) => s.key === animKey); }

function status(text: string, error = false): void {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

// ───── 變更 / 儲存 ─────
function beforeChange(): void { history.push(project); }

function changed(full = false): void {
  view.render();
  if (full) renderAll();
  else { renderFramePanel(); renderTiming(); updateThumb(frameIdx); }
  scheduleSave();
}

function scheduleSave(): void {
  dirty = true;
  clearTimeout(saveTimer);
  status('尚未儲存…');
  saveTimer = window.setTimeout(flushSave, 500);
}

async function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  if (!dirty) return; // 沒有修改就不寫入（避免用空白專案蓋掉已存的資料）
  dirty = false;
  try {
    await saveProject(project);
    status('已自動儲存在瀏覽器');
  } catch (e) {
    dirty = true;
    status(`自動儲存失敗：${(e as Error).message}`, true);
  }
}

// ───── 畫面元件 ─────
const view = new FrameView($<HTMLCanvasElement>('view'), {
  frame,
  onion: () => (frameIdx > 0 ? frames()[frameIdx - 1] : anim().loop && frames().length > 1 ? frames()[frames().length - 1] : null),
  tool: () => tool,
  beforeChange,
  changed: () => changed(false),
  selectionChanged: () => renderFramePanel(),
});

const preview = new Preview($<HTMLCanvasElement>('preview'), () => ({
  frames: frames(),
  loop: anim().loop,
  scale: project.scale,
  mirror: $<HTMLInputElement>('pvMirror').checked,
}));

function renderAll(): void {
  renderAnimList();
  renderStrip();
  renderAnimPanel();
  renderFramePanel();
  renderMovePanel();
  view.render();
}

function renderAnimList(): void {
  const el = $('animList');
  el.innerHTML = '';
  let group = '';
  for (const s of slots) {
    if (s.group !== group) {
      group = s.group;
      const h = document.createElement('h4');
      h.textContent = group;
      el.appendChild(h);
    }
    const fs = project.anims[s.key]?.frames ?? [];
    const item = document.createElement('div');
    item.className = `anim-item${s.key === animKey ? ' current' : ''}`;
    const needsHit = s.attack && !fs.some((f) => f.hit.length > 0);
    const state = fs.length === 0 ? '' : fs.length < s.suggested || needsHit ? 'partial' : 'done';
    item.innerHTML = `<span class="dot ${state}"></span><span></span><span class="count">${fs.length}/${s.suggested}</span>`;
    (item.children[1] as HTMLElement).textContent = s.label;
    item.title = `${s.key}${needsHit && fs.length ? '（還沒畫攻擊框）' : ''}`;
    item.onclick = () => selectAnim(s.key);
    el.appendChild(item);
  }
}

function selectAnim(key: string): void {
  animKey = key;
  frameIdx = 0;
  view.selection = null;
  preview.restart();
  renderAll();
  view.fit();
}

function selectFrame(i: number): void {
  frameIdx = Math.max(0, Math.min(frames().length - 1, i));
  view.selection = null;
  document.querySelectorAll('.thumb').forEach((t, k) => t.classList.toggle('current', k === frameIdx));
  renderFramePanel();
  view.render();
}

function renderStrip(): void {
  const el = $('strip');
  el.innerHTML = '';
  const s = slot();
  $('animTitle').textContent = s ? `${s.label}（${s.key}）・${frames().length} 格，建議 ${s.suggested} 格` : animKey;
  frames().forEach((f, i) => {
    const div = document.createElement('div');
    div.className = `thumb${i === frameIdx ? ' current' : ''}`;
    const c = document.createElement('canvas');
    c.width = 68;
    c.height = 68;
    div.appendChild(c);
    const meta = document.createElement('div');
    meta.className = 'meta';
    div.appendChild(meta);
    div.onclick = () => selectFrame(i);
    el.appendChild(div);
    drawThumb(c, meta, f, i);
  });
}

function drawThumb(c: HTMLCanvasElement, meta: HTMLElement, f: EditorFrame, i: number): void {
  meta.innerHTML = `#${i + 1} · ${f.duration}f${f.hit.length ? ' <span class="hasHit">●攻</span>' : ''}`;
  const g = c.getContext('2d')!;
  const paint = () => {
    const img = imageFor(f.png, paint);
    g.clearRect(0, 0, 68, 68);
    if (!img) return;
    g.imageSmoothingEnabled = false;
    const s = Math.min(68 / f.w, 68 / f.h);
    g.drawImage(img, (68 - f.w * s) / 2, (68 - f.h * s) / 2, f.w * s, f.h * s);
  };
  paint();
}

function updateThumb(i: number): void {
  const t = document.querySelectorAll('.thumb')[i];
  const f = frames()[i];
  if (!t || !f) return;
  drawThumb(t.querySelector('canvas')!, t.querySelector('.meta') as HTMLElement, f, i);
}

function renderAnimPanel(): void {
  $<HTMLInputElement>('loop').checked = anim().loop;
  $<HTMLInputElement>('scale').value = String(project.scale);
  renderTiming();
}

function baseMove(): MoveDef | undefined {
  const id = slot()?.moveId;
  return id ? getChar(charId).moves[id] : undefined;
}

function renderTiming(): void {
  const el = $('timing');
  const fs = frames();
  const t = deriveTiming(fs);
  const sec = (n: number) => (n / 60).toFixed(2);
  let html = `總長 <b>${t.total}</b> 影格（${sec(t.total)} 秒）`;
  const m = baseMove();
  const s = slot();
  if (s?.attack) {
    if (t.hitWindows.length) {
      html += `<br>動畫：發生 <b>${t.startup}</b>／持續 <b>${t.active}</b>／收招 <b>${t.recovery}</b>`;
      if (t.hitWindows.length > 1) html += `（${t.hitWindows.length} 段攻擊）`;
    } else if (fs.length) html += '<br><span class="warn">還沒有任何一格畫攻擊框（紅框）</span>';
    if (m) {
      html += `<br><span class="muted">程式預設：發生 ${m.startup}／持續 ${m.active}／收招 ${m.recovery}（共 ${m.startup + m.active + m.recovery}）</span>`;
      if (t.hitWindows.length && (t.startup !== m.startup || t.active !== m.active || t.recovery !== m.recovery)) {
        html += '<br><span class="muted">接入遊戲後會以動畫的影格為準。</span>';
      }
    }
  }
  el.innerHTML = html;
}

function renderFramePanel(): void {
  const f = frame();
  const panel = $('framePanel');
  panel.style.opacity = f ? '1' : '0.4';
  $<HTMLInputElement>('duration').value = f ? String(f.duration) : '';
  const bp = $('boxPanel');
  bp.innerHTML = '';
  if (!f) return;
  const counts = document.createElement('div');
  counts.className = 'muted';
  counts.textContent = `受擊框 ${f.hurt.length}・攻擊框 ${f.hit.length}・推擠框 ${f.push ? 1 : 0}　腳底點 (${f.anchor.x}, ${f.anchor.y})　圖片 ${f.w}×${f.h}`;
  bp.appendChild(counts);
  const sel = view.selection;
  const r = view.selectedRect();
  if (!sel || !r) {
    const tip = document.createElement('div');
    tip.className = 'muted';
    tip.textContent = '點選一個判定框可以輸入精確數值。';
    bp.appendChild(tip);
    return;
  }
  const name: Record<BoxKind, string> = { hurt: '受擊框', hit: '攻擊框', push: '推擠框' };
  const title = document.createElement('div');
  title.innerHTML = `<b style="color:rgb(${BOX_COLOR[sel.kind]})">${name[sel.kind]}</b> <span class="muted">（以腳底為原點、y 往上，單位：素材像素）</span>`;
  bp.appendChild(title);
  const b = rectToSpriteBox(r, f.anchor);
  const fields = document.createElement('div');
  fields.className = 'fields';
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    const lab = document.createElement('label');
    lab.textContent = k;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(b[k]);
    inp.onchange = () => {
      const v = Math.round(Number(inp.value));
      if (!Number.isFinite(v)) return;
      beforeChange();
      const nb = { ...rectToSpriteBox(r, f.anchor), [k]: k === 'w' || k === 'h' ? Math.max(1, v) : v };
      Object.assign(r, spriteBoxToRect(nb, f.anchor));
      changed();
    };
    lab.appendChild(inp);
    fields.appendChild(lab);
  }
  bp.appendChild(fields);
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = '刪除這個框（Delete）';
  del.onclick = () => view.deleteSelected();
  bp.appendChild(del);
}

function renderMovePanel(): void {
  const panel = $('movePanel');
  const box = $('moveFields');
  box.innerHTML = '';
  const m = baseMove();
  panel.style.display = m && m.kind !== 'taunt' && m.kind !== 'transform' ? '' : 'none';
  if (!m) return;
  const props: MoveProps = (project.moves[m.id] ??= {});
  const grid = document.createElement('div');
  grid.className = 'move-grid';
  const addNum = (key: 'damage' | 'hitstun' | 'blockstun' | 'pushback', label: string) => {
    const lab = document.createElement('span');
    lab.textContent = label;
    const wrap = document.createElement('span');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(props[key] ?? m[key]);
    inp.onchange = () => {
      beforeChange();
      const v = Math.round(Number(inp.value));
      if (v === m[key]) delete props[key];
      else props[key] = v;
      changed(true);
    };
    const def = document.createElement('span');
    def.className = 'def';
    def.textContent = ` 預設 ${m[key]}`;
    wrap.append(inp, def);
    grid.append(lab, wrap);
  };
  addNum('damage', '傷害');
  addNum('hitstun', '命中硬直');
  addNum('blockstun', '防禦硬直');
  addNum('pushback', '擊退力道');

  const gl = document.createElement('span');
  gl.textContent = '防禦方式';
  const sel = document.createElement('select');
  for (const [v, t] of [['mid', '中段（站蹲都能防）'], ['low', '下段（要蹲防）'], ['high', '上段（要站防）']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = props.guard ?? m.guard;
  sel.onchange = () => {
    beforeChange();
    const v = sel.value as MoveProps['guard'];
    if (v === m.guard) delete props.guard; else props.guard = v;
    changed(true);
  };
  grid.append(gl, sel);

  const kl = document.createElement('span');
  kl.textContent = '擊倒';
  const kd = document.createElement('input');
  kd.type = 'checkbox';
  kd.checked = props.knockdown ?? !!m.knockdown;
  kd.onchange = () => {
    beforeChange();
    if (kd.checked === !!m.knockdown) delete props.knockdown; else props.knockdown = kd.checked;
    changed(true);
  };
  grid.append(kl, kd);

  const cl = document.createElement('span');
  cl.textContent = '可取消成';
  const ci = document.createElement('input');
  ci.type = 'text';
  ci.placeholder = '例如 sp, super';
  ci.value = (props.cancel ?? m.cancel ?? []).join(', ');
  ci.onchange = () => {
    beforeChange();
    const list = ci.value.split(/[,\s，]+/).map((s) => s.trim()).filter(Boolean);
    if (list.join() === (m.cancel ?? []).join()) delete props.cancel; else props.cancel = list;
    changed(true);
  };
  grid.append(cl, ci);
  box.appendChild(grid);
}

// ───── 影格操作 ─────
async function importFiles(files: File[]): Promise<void> {
  const imgs = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => naturalCompare(a.name, b.name));
  if (!imgs.length) return;
  status(`匯入 ${imgs.length} 張圖中…`);
  const opt = {
    chromaKey: $<HTMLInputElement>('chroma').checked,
    columns: Math.max(0, Math.round(Number($<HTMLInputElement>('columns').value)) || 0),
    shrink: Math.max(1, Number($<HTMLInputElement>('shrink').value) || 1),
  };
  const processed: (Processed & { file: File; name: string })[] = [];
  for (const file of imgs) {
    try {
      const parts = await processFile(file, opt);
      parts.forEach((p, k) => processed.push({ file, name: parts.length > 1 ? `${file.name}#${k + 1}` : file.name, ...p }));
    } catch (e) {
      status(`${file.name} 讀取失敗：${(e as Error).message}`, true);
      return;
    }
  }
  beforeChange();
  const a = anim();
  const insertAt = a.frames.length ? frameIdx + 1 : 0;
  const dur = a.frames[frameIdx]?.duration ?? 4;
  const added: EditorFrame[] = processed.map((p) => ({
    id: newId(),
    name: p.name,
    png: p.png,
    w: p.w,
    h: p.h,
    anchor: p.anchor,
    duration: dur,
    hurt: [],
    hit: [],
    push: null,
  }));
  a.frames.splice(insertAt, 0, ...added);
  frameIdx = insertAt;
  changed(true);
  view.fit();
  status(`已匯入 ${added.length} 格到「${slot()?.label ?? animKey}」`);
}

function moveFrame(dir: -1 | 1): void {
  const fs = frames();
  const j = frameIdx + dir;
  if (j < 0 || j >= fs.length) return;
  beforeChange();
  [fs[frameIdx], fs[j]] = [fs[j], fs[frameIdx]];
  frameIdx = j;
  changed(true);
}

function cloneFrame(f: EditorFrame): EditorFrame {
  return { ...f, id: newId(), anchor: { ...f.anchor }, hurt: f.hurt.map((r) => ({ ...r })), hit: f.hit.map((r) => ({ ...r })), push: f.push ? { ...f.push } : null };
}

async function autoBoxes(f: EditorFrame): Promise<void> {
  const img = await loadImage(f.png);
  const { ctx } = toCanvas(img, f.w, f.h);
  const b = opaqueBounds(ctx.getImageData(0, 0, f.w, f.h));
  if (!b) return;
  if (!f.hurt.length) {
    // 受擊框：角色輪廓左右各內縮 10%
    const inset = Math.round(b.w * 0.1);
    f.hurt = [{ x: b.x + inset, y: b.y, w: Math.max(1, b.w - inset * 2), h: b.h }];
  }
  if (!f.push) {
    // 推擠框：以腳底為中心、寬度約輪廓的 45%
    const w = Math.max(4, Math.round(b.w * 0.45));
    f.push = { x: f.anchor.x - Math.round(w / 2), y: b.y + Math.round(b.h * 0.2), w, h: f.anchor.y - (b.y + Math.round(b.h * 0.2)) };
  }
}

// ───── 角色切換 / 讀寫 ─────
async function switchCharacter(id: string): Promise<void> {
  await flushSave();
  charId = id;
  slots = animSlots(getChar(id));
  history.clear();
  status('讀取中…');
  project = (await loadProject(id)) ?? emptyProject(id);
  if (!Object.keys(project.anims).length) {
    const fromRepo = await fetchFromProject(id).catch(() => null);
    if (fromRepo) project = await importExport(fromRepo.png, fromRepo.json);
  }
  animKey = slots.find((s) => project.anims[s.key]?.frames.length)?.key ?? slots[0].key;
  frameIdx = 0;
  view.selection = null;
  renderAll();
  view.fit();
  status(`${getChar(id).name}：${Object.values(project.anims).reduce((n, a) => n + a.frames.length, 0)} 格`);
}

async function doExport(target: 'project' | 'download'): Promise<void> {
  const total = Object.values(project.anims).reduce((n, a) => n + a.frames.length, 0);
  if (!total) { status('還沒有任何影格可以匯出', true); return; }
  status('打包中…');
  try {
    const r = await buildExport(project);
    if (target === 'project') {
      await saveToProject(charId, r);
      status(`已存到 public/assets/characters/${charId}/（${total} 格，sheet ${r.json.sheet.width}×${r.json.sheet.height}）`);
    } else {
      download(r.png, `${charId}-sheet.png`);
      download(new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' }), `${charId}-data.json`);
      status('已下載 sheet.png 與 data.json');
    }
  } catch (e) {
    status(`匯出失敗：${(e as Error).message}`, true);
  }
}

// ───── 事件 ─────
function bind(): void {
  const charSel = $<HTMLSelectElement>('char');
  for (const id of CHARACTER_IDS) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = getChar(id).name;
    charSel.appendChild(o);
  }
  charSel.onchange = () => void switchCharacter(charSel.value);

  $<HTMLInputElement>('importFrames').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    void importFiles([...(input.files ?? [])]).finally(() => (input.value = ''));
  };

  $<HTMLInputElement>('importExport').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    const jf = files.find((f) => f.name.endsWith('.json'));
    const pf = files.find((f) => f.type === 'image/png');
    if (!jf || !pf) { status('請同時選取 data.json 與 sheet.png 兩個檔案', true); return; }
    try {
      const json = JSON.parse(await jf.text()) as CharacterSpriteData;
      if (json.characterId !== charId && !confirm(`這份檔案是「${json.characterId}」的，要讀進目前的角色「${charId}」嗎？`)) return;
      beforeChange();
      project = await importExport(pf, json);
      project.characterId = charId;
      changed(true);
      view.fit();
      status('已讀取檔案');
    } catch (err) {
      status(`讀取失敗：${(err as Error).message}`, true);
    }
  };

  $('saveProject').onclick = () => void doExport('project');
  $('exportDl').onclick = () => void doExport('download');
  $('loadProject').onclick = async () => {
    const r = await fetchFromProject(charId).catch(() => null);
    if (!r) { status('遊戲專案裡還沒有這個角色的檔案', true); return; }
    if (!confirm('用遊戲專案裡的檔案取代目前編輯的內容？（可以按「復原」還原）')) return;
    beforeChange();
    project = await importExport(r.png, r.json);
    changed(true);
    view.fit();
    status('已從遊戲專案讀取');
  };

  $('undo').onclick = undo;
  $('redo').onclick = redo;

  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => {
    b.onclick = () => setTool(b.dataset.tool as Tool);
  });
  $<HTMLInputElement>('onion').onchange = (e) => { view.showOnion = (e.target as HTMLInputElement).checked; view.render(); };
  $('fit').onclick = () => view.fit();

  $('frameLeft').onclick = () => moveFrame(-1);
  $('frameRight').onclick = () => moveFrame(1);
  $('frameDup').onclick = () => {
    const f = frame();
    if (!f) return;
    beforeChange();
    frames().splice(frameIdx + 1, 0, cloneFrame(f));
    frameIdx++;
    changed(true);
  };
  $('frameDel').onclick = () => {
    if (!frame()) return;
    beforeChange();
    frames().splice(frameIdx, 1);
    frameIdx = Math.max(0, Math.min(frameIdx, frames().length - 1));
    view.selection = null;
    changed(true);
  };
  $('animClear').onclick = () => {
    if (!frames().length || !confirm(`清空「${slot()?.label}」的 ${frames().length} 格？（可以按「復原」還原）`)) return;
    beforeChange();
    anim().frames = [];
    frameIdx = 0;
    view.selection = null;
    changed(true);
  };

  $('play').onclick = togglePlay;
  $<HTMLInputElement>('pvBoxes').onchange = (e) => { preview.showBoxes = (e.target as HTMLInputElement).checked; };
  $<HTMLInputElement>('scale').onchange = (e) => {
    const v = Math.max(1, Math.min(8, Math.round(Number((e.target as HTMLInputElement).value)) || 1));
    beforeChange();
    project.scale = v;
    changed(true);
  };
  $<HTMLInputElement>('loop').onchange = (e) => { beforeChange(); anim().loop = (e.target as HTMLInputElement).checked; changed(true); };
  $<HTMLInputElement>('duration').onchange = (e) => {
    const f = frame();
    if (!f) return;
    beforeChange();
    f.duration = Math.max(1, Math.min(120, Math.round(Number((e.target as HTMLInputElement).value)) || 1));
    changed(false);
    renderTiming();
  };
  $('durationAll').onclick = () => {
    const f = frame();
    if (!f) return;
    beforeChange();
    for (const x of frames()) x.duration = f.duration;
    changed(true);
  };
  $('autoAnchor').onclick = async () => {
    const f = frame();
    if (!f) return;
    beforeChange();
    f.anchor = await anchorOf(f.png);
    changed();
  };
  $('autoAnchorAll').onclick = async () => {
    if (!frames().length) return;
    beforeChange();
    for (const f of frames()) f.anchor = await anchorOf(f.png);
    changed(true);
    status('整組已自動對齊腳底');
  };
  $('autoBoxesAll').onclick = async () => {
    if (!frames().length) return;
    beforeChange();
    for (const f of frames()) await autoBoxes(f);
    changed(true);
    status('已替沒有判定框的格子自動產生受擊框與推擠框');
  };
  $('copyPrevBoxes').onclick = () => {
    const f = frame();
    const p = frames()[frameIdx - 1];
    if (!f || !p) { status('這是第一格，沒有上一格可以複製', true); return; }
    beforeChange();
    const dx = f.anchor.x - p.anchor.x;
    const dy = f.anchor.y - p.anchor.y;
    const mv = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
    f.hurt = p.hurt.map(mv);
    f.hit = p.hit.map(mv);
    f.push = p.push ? mv(p.push) : null;
    view.selection = null;
    changed();
  };

  // 拖放匯入
  const hint = $('dropHint');
  window.addEventListener('dragover', (e) => { e.preventDefault(); hint.classList.add('show'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hint.classList.remove('show'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    hint.classList.remove('show');
    void importFiles([...(e.dataTransfer?.files ?? [])]);
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'v': case 'V': setTool('select'); break;
      case '1': setTool('hurt'); break;
      case '2': setTool('hit'); break;
      case '3': setTool('push'); break;
      case 'a': case 'A': setTool('anchor'); break;
      case 'o': case 'O': { const cb = $<HTMLInputElement>('onion'); cb.checked = !cb.checked; view.showOnion = cb.checked; view.render(); break; }
      case ',': case '<': selectFrame(frameIdx - 1); break;
      case '.': case '>': selectFrame(frameIdx + 1); break;
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); view.deleteSelected(); break;
      case 'ArrowLeft': e.preventDefault(); view.nudge(-step, 0); break;
      case 'ArrowRight': e.preventDefault(); view.nudge(step, 0); break;
      case 'ArrowUp': e.preventDefault(); view.nudge(0, -step); break;
      case 'ArrowDown': e.preventDefault(); view.nudge(0, step); break;
      case 'Escape': view.selection = null; renderFramePanel(); view.render(); break;
    }
  });
  window.addEventListener('beforeunload', () => void flushSave());
}

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}

function togglePlay(): void {
  preview.playing = !preview.playing;
  $('play').innerHTML = `${preview.playing ? '暫停' : '播放'} <kbd>Space</kbd>`;
}

function undo(): void {
  const p = history.undo(project);
  if (!p) return;
  project = p;
  frameIdx = Math.min(frameIdx, Math.max(0, frames().length - 1));
  view.selection = null;
  changed(true);
}

function redo(): void {
  const p = history.redo(project);
  if (!p) return;
  project = p;
  frameIdx = Math.min(frameIdx, Math.max(0, frames().length - 1));
  view.selection = null;
  changed(true);
}

bind();
setTool('select');
void switchCharacter(charId);
