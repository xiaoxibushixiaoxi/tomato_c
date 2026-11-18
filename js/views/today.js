import * as timer from '../timer.js';
import * as data from '../data.js';
import { esc, ymd, dateLabel } from '../util.js';
import { sheet, toast, confirmBox } from '../ui.js';

export async function render(root) {
  const date = ymd();
  const [tasks, plan, stats] = await Promise.all([
    data.listTasks({ includeArchived: true }), data.getPlan(date), data.statsOfDate(date),
  ]);
  const map = new Map(tasks.map((t) => [t.id, t]));
  const st = timer.getState();

  const focus = stats;
  const running = st.status === 'running' && st.phase === 'focus';
  const current = st.taskId ? map.get(st.taskId) : null;

  const perTask = new Map();
  for (const id of plan.taskIds) perTask.set(id, 0);
  const sessions = await data.sessionsOfDate(date);
  for (const s of sessions) {
    if (s.kind === 'focus' && s.outcome === 'done' && s.taskId && perTask.has(s.taskId)) {
      perTask.set(s.taskId, perTask.get(s.taskId) + 1);
    }
  }

  const planned = plan.taskIds.filter((id) => map.has(id));

  root.innerHTML = `
    <div class="day-head">
      <div>
        <div class="d1">${dateLabel()}</div>
        <div class="d2">${planned.length ? `今日 ${focus.planned} 项 · 已完成 ${focus.finished} 项` : '还没有挑今天要做的事'}</div>
      </div>
      <button class="icon-btn" data-act="add" aria-label="添加">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>

    ${running && current ? `<div class="banner-running">
      <span class="dot"></span>正在专注 · ${esc(current.title)}
    </div>` : ''}

    <div class="stats-strip">
      <div class="stat"><div class="n">${focus.pomodoros}</div><div class="k">今日番茄</div></div>
      <div class="stat"><div class="n">${focus.minutes}</div><div class="k">专注分钟</div></div>
      <div class="stat"><div class="n">${focus.interruptions}</div><div class="k">中断次数</div></div>
      <div class="stat"><div class="n">${focus.finished}/${focus.planned}</div><div class="k">待办完成</div></div>
    </div>

    ${plan.closed ? `<div class="closed-note">
      <span>今天已收工${plan.closedAt ? ` · ${new Date(plan.closedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }).replace(/^24:/, '00:')}` : ''}</span>
      <span class="link" data-act="reopen">撤销收工</span>
    </div>` : ''}

    <div class="section-title">
      <span>今日待办</span>
      <span>
        <span class="link" data-act="add">从清单挑</span>
        ${!plan.closed && planned.length ? '<span class="link" data-act="wrap">收工</span>' : ''}
      </span>
    </div>
    <div class="list" id="plan-list">
      ${planned.length ? planned.map((id) => row(map.get(id), st.taskId === id, perTask.get(id) || 0)).join('') : `
        <div class="card empty"><span class="big">🍅</span>今天还没安排<br>从「活动清单」里挑几件事进来</div>`}
    </div>
  `;

  function row(t, isCurrent, actual) {
    return `<div class="row ${isCurrent ? 'current' : ''}" data-id="${t.id}">
      <button class="check ${t.done ? 'on' : ''}" data-check="${t.id}" aria-label="完成">
        <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>
      </button>
      <div class="grow" data-pick="${t.id}">
        <div class="title ${t.done ? 'done' : ''}">${esc(t.title)}</div>
        <div class="meta">
          ${t.project ? `<span class="tag">${esc(t.project)}</span>` : ''}
          <span>${actual}${t.estimate ? ` / ${t.estimate}` : ''} 个番茄</span>
          ${isCurrent ? '<span style="color:var(--accent)">· 当前</span>' : ''}
        </div>
      </div>
      <button class="icon-btn" data-remove="${t.id}" aria-label="移出今日">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>`;
  }

  root.querySelectorAll('[data-act="add"]').forEach((el) => el.addEventListener('click', openPick));
  root.querySelector('[data-act="wrap"]')?.addEventListener('click', startWrapUp);
  root.querySelector('[data-act="reopen"]')?.addEventListener('click', async () => {
    await data.reopenDay(date);
    toast('已撤销收工');
    render(root);
  });

  root.querySelectorAll('[data-check]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.check;
      const t = map.get(id);
      const done = !t.done;
      await data.updateTask(id, { done });
      // 完成的任务不应该继续占着当前番茄
      if (done && timer.getState().taskId === id && timer.getState().status !== 'running') {
        timer.setTask(null);
      }
      render(root);
    });
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await data.removeFromPlan(btn.dataset.remove);
      toast('已移出今日');
      render(root);
    });
  });

  root.querySelectorAll('[data-pick]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.pick;
      const cur = timer.getState();
      if (cur.status === 'running' && cur.phase === 'focus') { toast('番茄进行中，先做完这一个'); return; }
      timer.setTask(id);
      toast('已设为当前任务');
      location.hash = '#timer';
    });
  });

  async function openPick() {
    const all = await data.listTasks();
    const cur = await data.getPlan(date);
    const chosen = new Set(cur.taskIds);
    const candidates = all.filter((t) => !t.done);

    const body = document.createElement('div');
    if (!candidates.length) {
      body.innerHTML = '<div class="empty">清单是空的，先去「清单」页加几件事</div>';
    } else {
      body.innerHTML = `<div class="list">${candidates.map((t) => `
        <div class="row" data-id="${t.id}">
          <div class="grow">
            <div class="title">${esc(t.title)}</div>
            <div class="meta">${t.project ? `<span class="tag">${esc(t.project)}</span>` : ''}${t.estimate ? `<span>预估 ${t.estimate} 个</span>` : ''}</div>
          </div>
          <span class="estimate">${chosen.has(t.id) ? '已在今日' : '添加'}</span>
        </div>`).join('')}</div>`;
      body.querySelectorAll('[data-id]').forEach((r) => {
        r.addEventListener('click', async () => {
          const id = r.dataset.id;
          if (chosen.has(id)) return;
          await data.addToPlan(id, date);
          chosen.add(id);
          r.querySelector('.estimate').textContent = '已在今日';
          toast('已加入今日');
        });
      });
    }

    sheet({
      title: '从清单挑到今日',
      body,
      actions: [{ label: '完成', kind: 'primary', onClick: () => render(root) }],
    });
  }

  // 日终处理：没做完的逐个问「延续到明天 / 丢弃」
  async function startWrapUp() {
    const tst = timer.getState();
    if (tst.status === 'running' && tst.phase === 'focus') {
      toast('番茄进行中，先结束这个番茄再收工');
      return;
    }

    const freshPlan = await data.getPlan(date);
    const all = await data.listTasks();
    const m = new Map(all.map((t) => [t.id, t]));
    const unfinished = freshPlan.taskIds.filter((id) => m.has(id) && !m.get(id).done);

    if (!unfinished.length) {
      const ok = await confirmBox({
        title: '收工',
        message: '今天安排的事都完成了，结束今天？',
        okText: '收工',
      });
      if (ok) {
        await data.closeDay(date);
        toast('今天收工，明天见');
        render(root);
      }
      return;
    }

    await step(unfinished, 0, { carried: 0, dropped: 0 }, m);
  }

  async function step(ids, i, tally, m) {
    if (i >= ids.length) {
      await data.closeDay(date);
      const parts = [
        tally.carried ? `${tally.carried} 项顺延到明天` : '',
        tally.dropped ? `${tally.dropped} 项已丢弃` : '',
      ].filter(Boolean);
      toast(parts.length ? `今天收工 · ${parts.join('，')}` : '今天收工，明天见');
      render(root);
      return;
    }

    const t = m.get(ids[i]);
    sheet({
      title: `收工 · 还有 ${ids.length - i} 项没完成`,
      body: `<div style="font-size:15px;line-height:1.7">
        「${esc(t.title)}」${t.estimate ? `（预估 ${t.estimate} 个番茄）` : ''}
        <div style="color:var(--muted);font-size:13px;margin-top:6px">没做完的番茄活动，明天还接着做，还是放下？</div>
      </div>`,
      actions: [
        { label: '延续到明天', kind: 'primary', onClick: async () => { await data.carryTaskToNextDay(t.id, date); tally.carried += 1; step(ids, i + 1, tally, m); } },
        { label: '丢弃', kind: 'ghost', onClick: async () => { await data.removeFromPlan(t.id, date); tally.dropped += 1; step(ids, i + 1, tally, m); } },
        { label: '先放着', kind: 'ghost', onClick: () => { toast('还没收工，随时可以再来'); render(root); } },
      ],
    });
  }
}
