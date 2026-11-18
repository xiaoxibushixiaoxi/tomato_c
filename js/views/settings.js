import { getSettings, saveSettings } from '../store.js';
import { toast } from '../ui.js';

export async function render(root) {
  const s = getSettings();

  const sw = (key, on) => `<button class="switch ${on ? 'on' : ''}" data-sw="${key}" role="switch" aria-checked="${on}"><i></i></button>`;
  const num = (key, val, min, max, unit) => `
    <div style="display:flex;align-items:center;gap:6px">
      <input class="num-input" type="number" data-num="${key}" min="${min}" max="${max}" value="${val}">
      <span style="font-size:13px;color:var(--muted)">${unit}</span>
    </div>`;

  root.innerHTML = `
    <div class="section-title" style="margin-top:8px">时长</div>
    <div class="card">
      <div class="setting"><div><div class="k">专注</div><div class="d">一个番茄的长度</div></div>${num('focusMin', s.focusMin, 1, 90, '分钟')}</div>
      <div class="setting"><div><div class="k">短休息</div><div class="d">每个番茄之后</div></div>${num('shortMin', s.shortMin, 1, 30, '分钟')}</div>
      <div class="setting"><div><div class="k">长休息</div><div class="d">每轮之后</div></div>${num('longMin', s.longMin, 5, 60, '分钟')}</div>
      <div class="setting"><div><div class="k">几个番茄一轮</div><div class="d">之后进入长休息</div></div>${num('longEvery', s.longEvery, 2, 8, '个')}</div>
    </div>

    <div class="section-title">规则</div>
    <div class="card">
      <div class="setting"><div><div class="k">严格模式</div><div class="d">番茄不可暂停，只能放弃；更贴近书里的做法</div></div>${sw('strict', s.strict)}</div>
      <div class="setting"><div><div class="k">自动开始休息</div><div class="d">专注结束后直接进入休息计时</div></div>${sw('autoBreak', s.autoBreak)}</div>
      <div class="setting"><div><div class="k">自动开始下一个</div><div class="d">休息结束后直接开始专注</div></div>${sw('autoNext', s.autoNext)}</div>
    </div>

    <div class="section-title">提醒</div>
    <div class="card">
      <div class="setting"><div><div class="k">提示音</div><div class="d">番茄结束时的三声铃</div></div>${sw('sound', s.sound)}</div>
      <div class="setting"><div><div class="k">桌面通知</div><div class="d">切到后台也能收到（需安装到主屏幕）</div></div>${sw('notify', s.notify)}</div>
    </div>

    <div class="section-title">数据</div>
    <div class="card">
      <div class="setting"><div><div class="k">导出备份</div><div class="d">JSON 格式，下一步做</div></div><span style="font-size:13px;color:var(--muted)">待完成</span></div>
    </div>

    <p style="text-align:center;color:var(--muted);font-size:12px;margin:26px 0 0;line-height:1.9">
      番茄钟 PWA · v0.1<br>依据《番茄工作法图解》实现
    </p>
  `;

  root.querySelectorAll('[data-sw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.sw;
      const next = !getSettings()[key];
      await saveSettings({ [key]: next });
      btn.classList.toggle('on', next);
      btn.setAttribute('aria-checked', String(next));
      if (key === 'notify' && next && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      toast(next ? '已开启' : '已关闭');
    });
  });

  root.querySelectorAll('[data-num]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const key = inp.dataset.num;
      let v = Number(inp.value);
      const min = Number(inp.min), max = Number(inp.max);
      v = Math.min(max, Math.max(min, Math.round(v) || min));
      inp.value = v;
      await saveSettings({ [key]: v });
      toast('已保存');
    });
  });
}
