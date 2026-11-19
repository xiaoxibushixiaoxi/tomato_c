// PWA：Service Worker 注册、离线提示、安装引导
// 部署在子路径（比如 github.io/tomato_c/）也能工作，路径全部相对本文件所在目录。

let installEvent = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canInstall() {
  return !!installEvent && !isStandalone();
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const res = await installEvent.userChoice;
  if (res.outcome === 'accepted') installEvent = null;
  emit();
  return res.outcome === 'accepted';
}

// 离线缓存是否就绪
export async function offlineReady() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    return keys.some((k) => k.startsWith('pomodoro-'));
  } catch (e) {
    return false;
  }
}

export function initPWA() {
  // Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
        console.warn('[pwa] Service Worker 注册失败', err);
      });
    });
  }

  // 离线提示条
  const bar = document.createElement('div');
  bar.className = 'offline-bar';
  bar.textContent = '离线模式 · 计时和记录照常，数据只在这台设备上';
  document.body.appendChild(bar);
  const sync = () => document.body.classList.toggle('offline', !navigator.onLine);
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();

  // 安装引导
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    emit();
  });
}
