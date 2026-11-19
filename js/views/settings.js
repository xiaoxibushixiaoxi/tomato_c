import { getSettings, saveSettings } from '../store.js';
import { toast, sheet } from '../ui.js';
import { canInstall, isStandalone, promptInstall, offlineReady, onInstallChange } from '../pwa.js';
import { exportJSON, exportCSV, importJSON } from '../backup.js';

const INSTALL_HELP = `
  <p class="hint">装好后会像 App 一样全屏打开，断网也能用。按你的设备选一种：</p>
  <div class="int-card">
    <div class="k">Android（Chrome / Edge）</div>
    <div class="d">右上角「⋮」菜单 →「添加到主屏幕」或「安装应用」</div>
  </div>
  <div class="int-card">
    <div class="k">iPhone / iPad（Safari）</div>
    <div class="d">底部「分享」按钮 →「添加到主屏幕」→ 添加</div>
  </div>
  <div class="int-card">
    <div class="k">电脑（Chrome / Edge）</div>
    <div class="d">地址栏右侧的安装图标，或菜单里的「安装番茄钟」</div>
  </div>
`;

export async function render(root) {
  const s = getSettings();
  const standalone = isStandalone();
  const installable = canInstall();

  const sw = (key, on) => `<button class="switch ${on ? 'on' : ''}" data-sw="${key}" role="switch" aria-checked="${on}"><i></i></button>`;
  const num = (key, val, min, max, unit) => `
    <div style="display:flex;align-items:center;gap:6px">
      <input class="num-input" type="number" data-num="${key}" min="${min}" max="${max}" value="${val}">
      <span style="font-size:13px;color:var(--muted)">${unit}</span>
    </div>`;

  const installLabel = standalone ? '已安装' : installable ? '安装' : '怎么装';

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
      <div class="setting"><div><div class="k">桌面通知</div><div class="d">切到后台也能收到（安装到主屏幕后最稳）</div></div>${sw('notify', s.notify)}</div>
    </div>

    <div class="section-title">安装</div>
    <div class="card">
      <div class="setting">
        <div><div class="k">添加到主屏幕</div><div class="d">${standalone ? '已经作为独立应用在运行' : '像 App 一样全屏打开，断网也能用'}</div></div>
        <button class="btn small" id="install-btn" ${standalone ? 'disabled' : ''}>${installLabel}</button>
      </div>
      <div class="setting">
        <div><div class="k">离线缓存</div><div class="d">首次打开后把全部文件存到本机</div></div>
        <span class="pill" id="offline-state">检查中</span>
      </div>
    </div>

    <div class="section-title">数据</div>
    <div class="card">
      <div class="setting"><div><div class="k">导出备份</div><div class="d">JSON，含任务、计划、记录和设置</div></div><button class="btn small" data-act="export-json">导出</button></div>
      <div class="setting"><div><div class="k">导出记录表</div><div class="d">CSV，Excel 可以直接打开</div></div><button class="btn small" data-act="export-csv">导出</button></div>
      <div class="setting"><div><div class="k">导入备份</div><div class="d">换手机或清缓存后用，会覆盖当前数据</div></div><button class="btn small" data-act="import-json">导入</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>

    <p class="app-meta">番茄钟 PWA · v1.0.0<br>依据《番茄工作法图解》实现</p>
  `;

  /* 数值与开关 */
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

  /* 安装 */
  const installBtn = root.querySelector('#install-btn');
  installBtn.addEventListener('click', async () => {
    if (standalone) return;
    if (canInstall()) {
      const ok = await promptInstall();
      toast(ok ? '已开始安装' : '安装已取消');
      return;
    }
    sheet({ title: '添加到主屏幕', body: INSTALL_HELP, actions: [{ label: '知道了', kind: 'ghost' }] });
  });
  const off = onInstallChange(() => {
    if (!installBtn.isConnected) return;
    installBtn.textContent = isStandalone() ? '已安装' : canInstall() ? '安装' : '怎么装';
    installBtn.disabled = isStandalone();
  });

  /* 离线状态 */
  const pill = root.querySelector('#offline-state');
  offlineReady().then((ok) => {
    if (!pill.isConnected) return;
    pill.textContent = ok ? '已缓存' : '未就绪';
  });

  /* 数据：导出 / 导入 */
  root.querySelector('[data-act="export-json"]').addEventListener('click', async () => {
    try {
      const r = await exportJSON();
      toast(`已导出备份 · ${r.sessions} 条记录`);
    } catch (e) {
      toast('导出失败：' + e.message);
    }
  });

  root.querySelector('[data-act="export-csv"]').addEventListener('click', async () => {
    try {
      const n = await exportCSV();
      toast(`已导出 ${n} 条记录`);
    } catch (e) {
      toast('导出失败：' + e.message);
    }
  });

  const fileInput = root.querySelector('#import-file');
  root.querySelector('[data-act="import-json"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const r = await importJSON(file);
      if (!r) { toast('已取消导入'); return; }
      toast(`已导入 ${r.tasks} 个任务 · ${r.sessions} 条记录`);
      setTimeout(() => location.reload(), 1000);
    } catch (e) {
      toast('导入失败：' + e.message);
    } finally {
      fileInput.value = '';
    }
  });

  return () => off();
}
