// 番茄计时状态机
// phase: idle(准备专注) | focus(专注中) | break(休息中)
// status: idle | running | paused
import { getSettings, emit as busEmit } from './store.js';
import * as data from './data.js';

const KEY = 'pomodoro.timer';
const listeners = new Set();
let st = null;
let timer = null;

const min = (m) => Math.round(m * 60000);

function blank() {
  return {
    phase: 'idle',
    status: 'idle',
    kind: 'short',
    plannedMs: 0,
    endAt: 0,
    remainMs: 0,
    startAt: 0,
    taskId: null,
    interruptions: [],
    cycle: 0,
  };
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 隐私模式忽略 */ }
}

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : null;
  } catch (e) { return null; }
}

function emit(type, detail) {
  for (const fn of listeners) {
    try { fn(type, detail); } catch (e) { console.error(e); }
  }
  busEmit(`timer:${type}`, detail);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearLastSession() {
  if (st) { delete st.lastSession; persist(); }
}

export function getState() { return st; }

export function setTask(id) {
  if (!st) return;
  st.taskId = id;
  persist();
  emit('state');
}

export function remainingMs() {
  if (!st) return 0;
  if (st.status === 'running') return Math.max(0, st.endAt - Date.now());
  return st.remainMs;
}

export function elapsedRatio() {
  if (!st || !st.plannedMs) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs() / st.plannedMs));
}

/* ---------------- 启动 & 后台校准 ---------------- */

export async function initTimer() {
  st = readStored() || blank();
  const s = getSettings();
  if (!st.plannedMs) st.plannedMs = min(s.focusMin);
  if (st.status === 'idle' && !st.remainMs) st.remainMs = st.plannedMs;

  if (st.status === 'running') {
    if (st.endAt <= Date.now()) {
      // 页面关着的时候已经响过了：补记一笔（结束时间用原本的 endAt）
      await complete({ silent: true });
    } else {
      startTicker();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && st?.status === 'running') {
      if (st.endAt <= Date.now()) complete();
      else emit('tick');
    }
  });
  emit('state');
  return st;
}

function startTicker() {
  stopTicker();
  timer = setInterval(() => {
    if (st.status !== 'running') return;
    if (st.endAt <= Date.now()) { complete(); return; }
    emit('tick');
  }, 250);
}

function stopTicker() {
  if (timer) { clearInterval(timer); timer = null; }
}

/* ---------------- 开始 / 暂停 / 放弃 ---------------- */

export async function startFocus(taskId) {
  const s = getSettings();
  const keepTask = taskId === undefined ? st.taskId : taskId;
  st = {
    ...blank(),
    phase: 'focus',
    status: 'running',
    plannedMs: min(s.focusMin),
    endAt: Date.now() + min(s.focusMin),
    remainMs: min(s.focusMin),
    startAt: Date.now(),
    taskId: keepTask || null,
    interruptions: [],
    cycle: st.cycle || 0,
  };
  persist();
  startTicker();
  emit('state');
  unlockAudio();
  askNotifyPermission();
}

export async function startBreak() {
  const s = getSettings();
  const planned = min(st.kind === 'long' ? s.longMin : s.shortMin);
  st = {
    ...st,
    phase: 'break',
    status: 'running',
    plannedMs: planned,
    remainMs: planned,
    endAt: Date.now() + planned,
    startAt: Date.now(),
    interruptions: [],
  };
  persist();
  startTicker();
  emit('state');
  emit('tick');
}

export function pause() {
  if (getSettings().strict) return;
  if (st.status !== 'running' || st.phase !== 'focus') return;
  st.remainMs = Math.max(0, st.endAt - Date.now());
  st.status = 'paused';
  stopTicker();
  persist();
  emit('state');
}

export function resume() {
  if (st.status !== 'paused') return;
  st.endAt = Date.now() + st.remainMs;
  st.status = 'running';
  persist();
  startTicker();
  emit('state');
}

export async function abandon() {
  if (st.phase !== 'focus' || st.status === 'idle') return;
  await data.addSession({
    taskId: st.taskId,
    kind: 'focus',
    plannedMin: Math.round(st.plannedMs / 60000),
    durMs: Math.max(0, Date.now() - st.startAt),
    startedAt: st.startAt,
    endedAt: Date.now(),
    outcome: 'abandoned',
    interruptions: st.interruptions.map((i) => ({ ...i })),
  });
  const s = getSettings();
  st = {
    ...blank(),
    phase: 'focus',
    status: 'idle',
    plannedMs: min(s.focusMin),
    remainMs: min(s.focusMin),
    taskId: st.taskId,
    cycle: st.cycle,
  };
  stopTicker();
  persist();
  emit('state');
}

export async function skipBreak() {
  if (st.phase !== 'break') return;
  await complete({ silent: true, skipped: true });
}

/* ---------------- 中断 ---------------- */

// type 先按按钮区分：记一笔 = internal（走神），被打断 = external（人/事/消息）
export function markInterrupt(note = '', type = null) {
  if (st.phase !== 'focus') return null;
  const item = {
    id: Math.random().toString(36).slice(2, 8),
    at: Date.now(),
    note,
    type,
    callback: '',
  };
  st.interruptions = [...st.interruptions, item];
  persist();
  emit('state');
  return item;
}

export function setInterruptType(id, type, note) {
  st.interruptions = st.interruptions.map((i) =>
    i.id === id ? { ...i, type, note: note ?? i.note } : i
  );
  persist();
  emit('state');
}

/* ---------------- 完成 ---------------- */

async function complete({ silent = false, skipped = false } = {}) {
  if (st.status === 'idle' && st.phase !== 'break') return;
  stopTicker();
  const s = getSettings();
  const endedAt = st.endAt || Date.now();
  const startedAt = st.startAt || endedAt - st.plannedMs;

  if (st.phase === 'focus') {
    const row = await data.addSession({
      taskId: st.taskId,
      kind: 'focus',
      plannedMin: Math.round(st.plannedMs / 60000),
      durMs: Math.max(0, endedAt - startedAt),
      startedAt,
      endedAt,
      outcome: 'done',
      interruptions: st.interruptions.map((i) => ({ ...i })),
    });
    st.lastSession = { id: row.id, taskId: row.taskId, interruptions: row.interruptions };
    st.cycle = st.cycle + 1;
    const long = s.longEvery > 0 && st.cycle % s.longEvery === 0;
    const planned = min(long ? s.longMin : s.shortMin);
    st = {
      ...st,
      phase: 'break',
      kind: long ? 'long' : 'short',
      status: 'idle',
      plannedMs: planned,
      remainMs: planned,
      endAt: 0,
      interruptions: [],
      startAt: 0,
    };
    persist();
    emit('state');
    emit('finished', st.lastSession);
    if (!silent) {
      announce(long ? '长休息' : '短休息', long ? `${s.longMin} 分钟，起身走两步` : `${s.shortMin} 分钟，让眼睛离开屏幕`);
      if (s.autoBreak) await startBreak();
    }
  } else {
    // 休息也入库：结果记 done / skipped，实际时长用 durMs
    await data.addSession({
      taskId: null,
      kind: st.kind,
      plannedMin: Math.round(st.plannedMs / 60000),
      durMs: Math.max(0, endedAt - startedAt),
      startedAt,
      endedAt,
      outcome: skipped ? 'skipped' : 'done',
      interruptions: [],
    });
    const wasLong = st.kind === 'long';
    st = {
      ...st,
      phase: 'focus',
      status: 'idle',
      plannedMs: min(s.focusMin),
      remainMs: min(s.focusMin),
      endAt: 0,
      startAt: 0,
      interruptions: [],
      cycle: wasLong ? 0 : st.cycle,
    };
    persist();
    emit('state');
    if (!silent) {
      announce('休息结束', '开始下一个番茄吧');
      if (s.autoNext) await startFocus();
    }
  }
}

/* ---------------- 提示音 & 通知 ---------------- */

let audioCtx = null;

/** 在用户第一次点击时解锁音频（移动端自动播放策略） */
export function unlockAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch (e) { /* 静默 */ }
}

function beep() {
  const s = getSettings();
  if (!s.sound) return;
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const notes = [880, 1174.66, 1567.98];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1);
    });
  } catch (e) { /* 浏览器不支持就静默 */ }
}

export function askNotifyPermission() {
  const s = getSettings();
  if (!s.notify || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function announce(title, body) {
  beep();
  const s = getSettings();
  if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'pomodoro', renotify: true, silent: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { /* Android Chrome 需要 Service Worker，后续补 */ }
}
