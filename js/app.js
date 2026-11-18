import { loadSettings } from './store.js';
import * as timer from './timer.js';
import { mmss, dateLabel } from './util.js';
import * as timerView from './views/timer.js';
import * as todayView from './views/today.js';
import * as listView from './views/list.js';
import * as recordsView from './views/records.js';
import * as settingsView from './views/settings.js';

const views = {
  timer: timerView,
  today: todayView,
  list: listView,
  records: recordsView,
  settings: settingsView,
};

const rootEl = document.getElementById('view');
const tabs = [...document.querySelectorAll('.tab')];

let cleanup = null;
let current = null;
let seq = 0;

async function go(name, force = false) {
  if (!views[name]) name = 'timer';
  if (name === current && !force) return;
  const my = ++seq;

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  current = name;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  rootEl.innerHTML = '';

  const res = await views[name].render(rootEl, { go });
  if (my !== seq) { if (typeof res === 'function') res(); return; }
  cleanup = typeof res === 'function' ? res : null;
  rootEl.scrollTop = 0;
  window.scrollTo(0, 0);
}

function tabOfHash() {
  const h = (location.hash || '').replace('#', '');
  return views[h] ? h : 'timer';
}

tabs.forEach((t) => {
  t.addEventListener('click', () => {
    const name = t.dataset.tab;
    if (location.hash === `#${name}`) go(name, true);
    else location.hash = `#${name}`;
  });
});

window.addEventListener('hashchange', () => go(tabOfHash()));

/* 标题栏显示剩余时间，切到别的页也知道还剩多久 */
function updateTitle() {
  const st = timer.getState();
  if (st && st.status === 'running') {
    document.title = `${mmss(timer.remainingMs())} · ${st.phase === 'break' ? '休息' : '专注'}`;
  } else {
    document.title = '番茄钟';
  }
}
timer.subscribe((type) => { if (type === 'tick' || type === 'state') updateTitle(); });

(async () => {
  await loadSettings();
  await timer.initTimer();
  const d = document.getElementById('topbar-date');
  if (d) d.textContent = dateLabel();
  updateTitle();
  await go(tabOfHash(), true);
})();
