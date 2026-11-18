// 全局设置 + 极简事件总线
import * as db from './db.js';

export const DEFAULTS = {
  focusMin: 25,
  shortMin: 5,
  longMin: 20,
  longEvery: 4,
  strict: true,      // true=不能暂停；false=允许暂停
  autoBreak: false,  // 专注结束后自动开始休息
  autoNext: false,   // 休息结束后自动开始下一个番茄
  sound: true,
  notify: true,
};

let settings = { ...DEFAULTS };

export function getSettings() { return settings; }

export async function loadSettings() {
  const row = await db.get('settings', 'app');
  settings = { ...DEFAULTS, ...(row?.value || {}) };
  return settings;
}

export async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await db.put('settings', { key: 'app', value: settings });
  emit('settings', settings);
  return settings;
}

/* ---------------- 事件总线 ---------------- */
const listeners = new Set();

export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(type, detail) {
  for (const fn of listeners) {
    try { fn(type, detail); } catch (e) { console.error(e); }
  }
}
