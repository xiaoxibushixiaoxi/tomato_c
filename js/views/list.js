import * as data from '../data.js';
import { esc, ymd } from '../util.js';
import { sheet, toast, confirmBox } from '../ui.js';

export async function render(root) {
  let filter = 'all';
  let tasks = await data.listTasks({ includeArchived: true });
  let projects = await data.listProjects();
  let actual = await data.focusCountByTask();

  function split() {
    const inFilter = (t) => filter === 'all' || t.project === filter;
    return {
      active: tasks.filter((t) => !t.archived && !t.done && inFilter(t)),
      done: tasks.filter((t) => (t.archived || t.done) && inFilter(t)),
    };
  }

  root.innerHTML = `
    <div class="section-title" style="margin-top:8px">
      <span>活动清单</span>
      <span class="link" id="count"></span>
    </div>
    <div class="chips" id="chips">
      ${['all', ...projects].map((p) => `<button class="chip ${p === filter ? 'on' : ''}" data-p="${esc(p)}">${p === 'all' ? '全部' : esc(p)}</button>`).join('')}
    </div>
    <div class="add-bar">
      <input class="input" id="new-title" placeholder="加一件事，回车保存" autocomplete="off">
      <button class="btn primary" id="add-btn">添加</button>
    </div>
    <div class="list" id="task-list" style="margin-top:12px"></div>
    <div class="section-title" id="done-head" style="margin-top:26px">
      <span>已完成</span>
      <span><span class="link" data-act="archiveAll">归档</span></span>
    </div>
    <div class="list" id="done-list"></div>
  `;

  function meta(t) {
    const a = actual.get(t.id) || 0;
    const est = t.estimate ? `预估 ${t.estimate}` : '未预估';
    return `
      ${t.project ? `<span class="tag">${esc(t.project)}</span>` : ''}
      <span>${est} · 实际 ${a} 个</span>
      ${t.archived ? '<span>· 已归档</span>' : ''}`;
  }

  function paint() {
    const { active, done } = split();
    root.querySelector('#count').textContent = `${active.length} 项在办 · ${done.length} 项已完成`;
    root.querySelector('#done-head').style.display = done.length ? '' : 'none';

    const el = root.querySelector('#task-list');
    if (!active.length) {
      el.innerHTML = `<div class="card empty"><span class="big">📝</span>${tasks.length ? '这个筛选下没有在办的事' : '清单还是空的'}<br>把脑子里的事先倒出来，不用排序</div>`;
    } else {
      el.innerHTML = active.map((t) => `
        <div class="row" data-id="${t.id}">
          <button class="check" data-check="${t.id}" aria-label="完成">
            <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>
          </button>
          <div class="grow" data-open="${t.id}">
            <div class="title">${esc(t.title)}</div>
            <div class="meta">${meta(t)}</div>
          </div>
        </div>`).join('');
      bindRows(el);
    }

    const del = root.querySelector('#done-list');
    del.innerHTML = done.map((t) => `
      <div class="row" data-id="${t.id}">
        <button class="check on" data-restore="${t.id}" aria-label="恢复">
          <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>
        </button>
        <div class="grow" data-open="${t.id}">
          <div class="title done">${esc(t.title)}</div>
          <div class="meta">${meta(t)}</div>
        </div>
        <button class="link" data-restore="${t.id}">恢复</button>
      </div>`).join('');
    bindRows(del);
  }

  function bindRows(el) {
    el.querySelectorAll('[data-check]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await data.updateTask(btn.dataset.check, { done: true });
        await refresh();
      });
    });
    el.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await data.updateTask(btn.dataset.restore, { done: false, archived: false });
        await refresh();
        toast('已恢复到在办');
      });
    });
    el.querySelectorAll('[data-open]').forEach((row) => {
      row.addEventListener('click', () => {
        const t = tasks.find((x) => x.id === row.dataset.open);
        if (t) openTask(t);
      });
    });
  }

  async function refresh() {
    tasks = await data.listTasks({ includeArchived: true });
    projects = await data.listProjects();
    actual = await data.focusCountByTask();
    paint();
  }

  async function openTask(t) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="field" style="margin-bottom:10px">
        <label>标题</label>
        <input class="input" id="e-title" value="${esc(t.title)}">
      </div>
      <div class="row-line" style="display:flex;gap:10px;margin-bottom:10px">
        <div class="field" style="flex:1">
          <label>项目</label>
          <input class="input" id="e-project" value="${esc(t.project || '')}" placeholder="可留空">
        </div>
        <div class="field" style="width:96px">
          <label>预估番茄</label>
          <input class="input" id="e-est" type="number" min="0" max="20" value="${t.estimate || ''}" placeholder="—">
        </div>
      </div>
      <div style="font-size:12.5px;color:var(--muted);line-height:1.7">
        实际已完成 ${actual.get(t.id) || 0} 个番茄 · 预估留空或填 0 都表示「还没估」
      </div>`;

    const actions = [
      {
        label: '保存',
        kind: 'primary',
        onClick: async () => {
          const title = body.querySelector('#e-title').value.trim();
          if (!title) { toast('标题不能为空'); return; }
          const rawEst = body.querySelector('#e-est').value.trim();
          await data.updateTask(t.id, {
            title,
            project: body.querySelector('#e-project').value.trim(),
            estimate: rawEst === '' ? null : Number(rawEst),
          });
          await refresh();
          toast('已保存');
        },
      },
      { label: '加入今日', onClick: async () => { await data.addToPlan(t.id); toast('已加入今日待办'); } },
    ];
    if (t.done || t.archived) {
      actions.push({
        label: '恢复为在办',
        onClick: async () => { await data.updateTask(t.id, { done: false, archived: false }); await refresh(); toast('已恢复'); },
      });
    }
    actions.push({
      label: '删除',
      kind: 'danger',
      onClick: async () => {
        const ok = await confirmBox({ title: '删除任务？', message: `「${t.title}」会从清单和今日待办里拿掉。`, okText: '删除', danger: true });
        if (!ok) return;
        await data.removeTask(t.id);
        await refresh();
        toast('已删除');
      },
    });
    actions.push({ label: '取消', kind: 'ghost' });

    sheet({ title: '编辑任务', body, actions });
  }

  root.querySelector('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-p]');
    if (!chip) return;
    filter = chip.dataset.p;
    root.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.p === filter));
    paint();
  });

  root.querySelector('[data-act="archiveAll"]').addEventListener('click', async () => {
    const n = await data.archiveCompleted();
    if (!n) { toast('没有可归档的已完成任务'); return; }
    await refresh();
    toast(`已归档 ${n} 项`);
  });

  const input = root.querySelector('#new-title');
  const add = async () => {
    const title = input.value.trim();
    if (!title) return;
    await data.addTask({ title, project: filter === 'all' ? '' : filter });
    input.value = '';
    await refresh();
    toast('已加入清单');
  };
  root.querySelector('#add-btn').addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  paint();
}
