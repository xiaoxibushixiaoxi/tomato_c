// 轻量 UI：toast / 底部弹层 / 确认框（不使用 alert/confirm）
import { esc } from './util.js';

const sheetRoot = () => document.getElementById('sheet-root');
const toastRoot = () => document.getElementById('toast-root');

let openMask = null;

export function toast(msg, ms = 1800) {
  const root = toastRoot();
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/**
 * 底部弹层
 * @param {{title?:string, body?:string|Node, actions?:Array<{label:string,kind?:string,onClick?:Function}>}} opt
 */
export function sheet({ title = '', body = '', actions = [] } = {}) {
  closeSheet();
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const box = document.createElement('div');
  box.className = 'sheet';
  box.setAttribute('role', 'dialog');

  if (title) {
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
  }

  if (body instanceof Node) box.appendChild(body);
  else if (body) {
    const div = document.createElement('div');
    div.innerHTML = body;
    box.appendChild(div);
  }

  if (actions.length) {
    const wrap = document.createElement('div');
    wrap.className = 'actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${a.kind || ''}`.trim();
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        closeSheet();
        a.onClick?.();
      });
      wrap.appendChild(btn);
    }
    box.appendChild(wrap);
  }

  mask.addEventListener('click', (e) => { if (e.target === mask) closeSheet(); });
  mask.appendChild(box);
  sheetRoot().appendChild(mask);
  openMask = mask;
  return closeSheet;
}

export function closeSheet() {
  if (openMask) { openMask.remove(); openMask = null; }
}

export function confirmBox({ title = '确认', message = '', okText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    sheet({
      title,
      body: `<p style="margin:0;color:var(--ink-2);font-size:14.5px;line-height:1.7">${esc(message)}</p>`,
      actions: [
        { label: okText, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
        { label: cancelText, kind: 'ghost', onClick: () => resolve(false) },
      ],
    });
    // 点遮罩关闭视为取消
    const mask = sheetRoot().lastElementChild;
    if (mask) {
      const obs = new MutationObserver(() => {
        if (!mask.isConnected) { obs.disconnect(); resolve(false); }
      });
      obs.observe(sheetRoot(), { childList: true });
    }
  });
}
