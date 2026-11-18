export const pad = (n) => String(n).padStart(2, '0');

/** ms -> "25:00" */
export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 本地日期 yyyy-mm-dd */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return [start, start + 86400000];
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekday(d = new Date()) { return WEEK[d.getDay()]; }

export function dateLabel(d = new Date()) {
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${weekday(d)}`;
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
