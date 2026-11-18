import * as timer from '../timer.js';
import * as data from '../data.js';
import { getSettings } from '../store.js';
import { mmss, esc, hhmm, ymd } from '../util.js';
import { sheet, toast, confirmBox, closeSheet } from '../ui.js';

const R = 144;
const C = 2 * Math.PI * R;

export async function render(root, ctx) {
  let tasks = await data.listTasks();
  let plan = await data.getPlan(ymd());

  const byId = () => new Map(tasks.map((t) => [t.id, t]));
  const state = () => timer.getState();

  const html = () => {
    const st = state();
    const isBreak = st.phase === 'break';
    const task = st.taskId ? byId().get(st.taskId) : null;
    const remaining = mmss(timer.remainingMs());
    const s = getSettings();
    const per = s.longEvery || 4;

    let chip = '准备开始';
    if (st.phase === 'focus' && st.status === 'running') chip = '专注中';
    else if (st.status === 'paused') chip = '已暂停';
    else if (isBreak) chip = st.status === 'running' ? '休息中' : (st.kind === 'long' ? '长休息 · 待开始' : '短休息 · 待开始');

    let sub = '一次只做一件事';
    if (st.status === 'running') sub = isBreak ? '起身，看看远处' : '正在专注';
    else if (st.status === 'paused') sub = '暂停中';
    else if (isBreak) sub = `${Math.round(st.plannedMs / 60000)} 分钟`;

    const filled = isBreak && st.kind === 'long' ? per : st.cycle % per;
    const dots = Array.from({ length: per }, (_, i) =>
      `<i class="${i < filled ? (isBreak ? 'break' : 'on') : ''}"></i>`).join('');

    const nInt = st.interruptions.length;
    const nIn = st.interruptions.filter((i) => i.type === 'internal').length;
    const nOut = st.interruptions.filter((i) => i.type === 'external').length;
    const tip = st.phase !== 'focus'
      ? ''
      : nInt
        ? `已记 ${nInt} 笔（走神 ${nIn} · 外部 ${nOut}）· 结束后统一归类`
        : '被打断？先记一笔，别停表';

    return `
      <div class="timer-page">
        <div class="status-chip ${isBreak ? 'break' : ''}"><span class="dot"></span>${chip}</div>
        <div class="ring-wrap ${isBreak ? 'break' : ''}">
          <svg class="ring-svg" viewBox="0 0 320 320">
            <circle class="ring-track" cx="160" cy="160" r="${R}"/>
            <circle class="ring-fill" id="ring" cx="160" cy="160" r="${R}"
              transform="rotate(-90 160 160)"
              stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/>
          </svg>
          <div class="ring-center">
            <div class="time-text" id="t-time">${remaining}</div>
            <div class="time-sub" id="t-sub">${sub}</div>
          </div>
        </div>
        <button class="task-line" data-act="pick">
          <span class="muted">${task ? '正在做' : '未选择任务'}</span>
          ${task ? `<b>${esc(task.title)}</b>` : '<span class="muted">· 点这里挑一个</span>'}
        </button>
        <div class="cycle-dots">${dots}</div>
        <div class="timer-actions">${actions(st, isBreak, s)}</div>
        <div class="interrupt-tip" id="tip">${tip ? `<span data-act="why">${tip}</span>` : ''}</div>
      </div>`;
  };

  function actions(st, isBreak, s2) {
    if (st.phase !== 'break') {
      if (st.status === 'idle') {
        return `<div class="timer-actions"><button class="btn primary" data-act="start">开始专注</button></div>`;
      }
      if (st.status === 'paused') {
        return `<div class="timer-actions"><button class="btn primary" data-act="resume">继续</button></div>
                <div class="timer-actions secondary"><button class="btn danger" data-act="abandon">放弃</button></div>`;
      }
      const pauseBtn = s2.strict ? '' : `<button class="btn ghost" data-act="pause">暂停</button>`;
      return `<div class="timer-actions">
                <button class="btn" data-act="mark">记一笔</button>
                <button class="btn" data-act="excuse">被打断</button>
              </div>
              <div class="timer-actions secondary">
                ${pauseBtn}
                <button class="btn danger" data-act="abandon">放弃</button>
              </div>`;
    }
    if (st.status === 'running') {
      return `<div class="timer-actions"><button class="btn ghost" data-act="skipBreak">跳过休息</button></div>`;
    }
    return `<div class="timer-actions">
              <button class="btn primary" data-act="break">开始休息</button>
              <button class="btn ghost" data-act="skipBreak">跳过</button>
            </div>`;
  }

  function tick() {
    const st = state();
    const t = root.querySelector('#t-time');
    const ring = root.querySelector('#ring');
    if (!t || !ring) return;
    t.textContent = mmss(timer.remainingMs());
    ring.style.strokeDashoffset = (C * (1 - timer.elapsedRatio())).toFixed(2);
    if (!st.plannedMs) ring.style.strokeDashoffset = C.toFixed(2);
  }

  function bind() {
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', () => onAct(el.dataset.act, el));
    });
  }

  async function onAct(act) {
    const st = state();
    if (act === 'start') { await timer.startFocus(); }
    if (act === 'break') { await timer.startBreak(); }
    if (act === 'mark') {
      timer.markInterrupt('', 'internal');
      if (navigator.vibrate) navigator.vibrate(12);
      toast('记下了一次走神，继续这个番茄');
    }
    if (act === 'excuse') {
      timer.markInterrupt('', 'external');
      if (navigator.vibrate) navigator.vibrate(12);
      toast('记下了一次外部打断，继续这个番茄');
    }
    if (act === 'pause') { timer.pause(); toast('已暂停（宽松模式）'); }
    if (act === 'resume') { timer.resume(); }
    if (act === 'abandon') {
      const ok = await confirmBox({
        title: '放弃这个番茄？',
        message: '这个番茄会记为「作废」，并保留下你记录的中断。休息一下，重新开一个。',
        okText: '放弃',
        danger: true,
      });
      if (ok) { await timer.abandon(); toast('已作废，重新开始一个'); }
    }
    if (act === 'skipBreak') {
      if (st.status === 'running') {
        const ok = await confirmBox({ title: '跳过休息？', message: '提前回到专注状态。', okText: '跳过', cancelText: '再歇会儿' });
        if (!ok) return;
      }
      await timer.skipBreak();
    }
    if (act === 'pick') openPicker();
    if (act === 'why') toast('被打断时点「记一笔」，结束后再分类');
  }

  async function openPicker() {
    tasks = await data.listTasks();
    plan = await data.getPlan(ymd());
    const map = byId();
    const ids = plan.taskIds.filter((id) => map.has(id));
    const st = state();

    const body = document.createElement('div');
    if (!ids.length) {
      body.innerHTML = `<div class="empty"><span class="big">🗒️</span>今日待办还是空的<br>去「今日」页挑几个任务</div>`;
    } else {
      body.innerHTML = `<div class="list">${ids.map((id) => {
        const t = map.get(id);
        const cur = st.taskId === id;
        return `<div class="row ${cur ? 'current' : ''}" data-id="${id}">
          <div class="grow"><div class="title">${esc(t.title)}</div>
          <div class="meta">${t.project ? `<span class="tag">${esc(t.project)}</span>` : ''}${t.estimate ? `<span>预估 ${t.estimate} 个</span>` : ''}</div></div>
          ${cur ? '<span class="estimate">当前</span>' : ''}
        </div>`;
      }).join('')}</div>`;
      body.querySelectorAll('[data-id]').forEach((row) => {
        row.addEventListener('click', async () => {
          const id = row.dataset.id;
          const cur = state();
          if (cur.status === 'running' && cur.phase === 'focus') {
            toast('这个番茄已经开始，做完再换任务');
            return;
          }
          closeSheet();
          if (cur.phase === 'focus' && cur.status === 'idle') await timer.startFocus(id);
          else { timer.setTask(id); toast('已切换任务'); }
        });
      });
    }

    sheet({
      title: '这个番茄做什么？',
      body,
      actions: [{ label: '关闭', kind: 'ghost' }],
    });
  }

  /* 结束后的中断分类：内部/外部 + 外部「稍后回电」事项 */
  async function maybeClassify(info) {
    const ls = info || state().lastSession;
    if (!ls || !ls.interruptions?.length) return;

    const local = ls.interruptions.map((i) => ({ ...i, callback: i.callback || '' }));
    const body = document.createElement('div');

    const render = () => {
      // 重绘前先把已输入的回电事项收起来，免得切换类型时丢掉
      body.querySelectorAll('[data-cb]').forEach((inp) => {
        local[Number(inp.dataset.cb)].callback = inp.value;
      });
      body.innerHTML = `
        <p class="hint">先分清「内部（走神）」和「外部（人/事）」。外部的顺手记下要回的电，属于「稍后处理」，不是你一小时内的事。</p>
        <div class="list">${local.map((i, idx) => `
          <div class="int-card">
            <div class="meta">${hhmm(i.at)} 记下的一笔</div>
            <div class="int-types">
              <button class="chip ${i.type === 'internal' ? 'on' : ''}" data-t="internal" data-i="${idx}">内部 · 走神</button>
              <button class="chip ${i.type === 'external' ? 'on' : ''}" data-t="external" data-i="${idx}">外部 · 人/事/消息</button>
            </div>
            <input class="input cb ${i.type === 'external' ? '' : 'hide'}" data-cb="${idx}"
              placeholder="要回电/处理的事（可留空）" value="${esc(i.callback)}">
          </div>`).join('')}</div>
        <div class="actions"><button class="btn primary" data-save>保存分类</button></div>
        <div class="actions"><button class="btn ghost" data-skip>先不管</button></div>`;

      body.querySelectorAll('[data-t]').forEach((btn) => {
        btn.addEventListener('click', () => {
          local[Number(btn.dataset.i)].type = btn.dataset.t;
          render();
        });
      });

      body.querySelector('[data-save]').addEventListener('click', async () => {
        body.querySelectorAll('[data-cb]').forEach((inp) => {
          local[Number(inp.dataset.cb)].callback = inp.value.trim();
        });
        const missing = local.filter((i) => !i.type);
        if (missing.length) { toast(`还有 ${missing.length} 笔没归类`); return; }
        await data.updateSession(ls.id, { interruptions: local });
        timer.clearLastSession();
        closeSheet();
        toast('已记录');
      });

      body.querySelector('[data-skip]').addEventListener('click', () => {
        timer.clearLastSession();
        closeSheet();
      });
    };
    render();

    sheet({ title: `番茄结束 · ${local.length} 次打断`, body });
  }

  const off = timer.subscribe((type, detail) => {
    if (type === 'state') paint();
    else if (type === 'tick') tick();
    else if (type === 'finished') maybeClassify(detail);
  });

  function paint() {
    root.innerHTML = html();
    bind();
    tick();
  }

  paint();
  if (state().lastSession) setTimeout(() => maybeClassify(), 400);

  return () => off();
}
