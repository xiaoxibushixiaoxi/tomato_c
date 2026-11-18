import * as data from '../data.js';
import { esc, hhmm, ymd } from '../util.js';

const dayKey = (ts) => ymd(new Date(ts));

export async function render(root) {
  const weekStartTs = data.startOfWeek();
  const morning = (d) => { d.setHours(0, 0, 0, 0); return d.getTime(); };
  const sevenStartTs = (() => { const d = new Date(); d.setDate(d.getDate() - 6); return morning(d); })();

  const [recent, tasks, weekRows, sevenRows] = await Promise.all([
    data.recentSessions(400),
    data.listTasks({ includeArchived: true }),
    data.sessionsSince(weekStartTs),
    data.sessionsSince(sevenStartTs),
  ]);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // ---------- 近 7 天：每天完成的番茄数 ----------
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(ymd(d));
  }
  const doneFocus = sevenRows.filter((s) => s.kind === 'focus' && s.outcome === 'done');
  const counts = days.map((d) => doneFocus.filter((s) => dayKey(s.startedAt) === d).length);
  const totalDone = counts.reduce((a, b) => a + b, 0);

  // ---------- 近 7 天：中断类型分布 ----------
  const ints = sevenRows.filter((s) => s.kind === 'focus').flatMap((s) => s.interruptions || []);
  const nIn = ints.filter((i) => i.type === 'internal').length;
  const nOut = ints.filter((i) => i.type === 'external').length;

  // ---------- 本周卡片 ----------
  const weekDone = weekRows.filter((s) => s.kind === 'focus' && s.outcome === 'done');
  const weekCount = weekDone.length;
  const interrupted = weekDone.filter((s) => (s.interruptions || []).length > 0).length;
  const rate = weekCount ? Math.round((interrupted / weekCount) * 100) : null;
  const weekInts = weekDone.reduce((a, s) => a + (s.interruptions || []).length, 0);

  const byTask = new Map();
  for (const s of weekDone) {
    if (!s.taskId) continue;
    byTask.set(s.taskId, (byTask.get(s.taskId) || 0) + 1);
  }
  let hit = 0;
  let estimated = 0;
  for (const [id, n] of byTask) {
    const t = taskMap.get(id);
    if (!t || !t.estimate) continue;
    estimated++;
    if (n <= t.estimate) hit++;
  }

  // ---------- 手写 SVG：7 天柱状图 ----------
  const W = 340, H = 132, PAD_B = 22, TOP = 12, PAD_L = 4;
  const plotH = H - PAD_B - TOP;
  const slot = (W - PAD_L * 2) / 7;
  const bw = Math.min(26, slot * 0.5);
  const max = Math.max(1, ...counts);
  const today = ymd();
  const barsSvg = days.map((d, i) => {
    const c = counts[i];
    const h = c ? Math.max(4, Math.round((c / max) * plotH)) : 2;
    const x = PAD_L + slot * i + (slot - bw) / 2;
    const y = H - PAD_B - h;
    const isToday = d === today;
    const fill = c ? 'var(--accent)' : 'var(--track)';
    const opacity = c ? (isToday ? 1 : 0.45) : 0.6;
    const label = d.slice(5).replace('-', '/');
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h}" rx="4" fill="${fill}" opacity="${opacity}"/>
      ${c ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)">${c}</text>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - PAD_B + 14}" text-anchor="middle" font-size="9" fill="var(--muted)">${label}</text>`;
  }).join('');

  const chartSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="近 7 天番茄数">
    <line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_L}" y2="${H - PAD_B}" stroke="var(--line)" stroke-width="1"/>
    ${barsSvg}
  </svg>`;

  // ---------- 手写 SVG：中断类型环形图 ----------
  const totalInt = nIn + nOut;
  const R = 46, C = 2 * Math.PI * R, CX = 64, CY = 64;
  const arc = (n) => ((totalInt ? n / totalInt : 0) * C);
  const lenIn = arc(nIn);
  const lenOut = arc(nOut);
  const donutSvg = `<svg viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="中断类型分布">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--track)" stroke-width="16"/>
    ${totalInt ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--accent)" stroke-width="16"
        stroke-dasharray="${lenIn.toFixed(1)} ${(C - lenIn).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})"/>
      ${nOut ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--accent-3)" stroke-width="16"
        stroke-dasharray="${lenOut.toFixed(1)} ${(C - lenOut).toFixed(1)}" stroke-dashoffset="${(-lenIn).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})"/>` : ''}` : ''}
    <text x="${CX}" y="${CY - 2}" text-anchor="middle" font-size="22" font-weight="600" fill="var(--ink)">${totalInt}</text>
    <text x="${CX}" y="${CY + 18}" text-anchor="middle" font-size="10" fill="var(--muted)">次打断</text>
  </svg>`;

  // ---------- 明细：按日分组 ----------
  const groups = [];
  for (const s of recent.slice(0, 60)) {
    const k = dayKey(s.startedAt);
    let g = groups.find((x) => x.date === k);
    if (!g) { g = { date: k, items: [] }; groups.push(g); }
    g.items.push(s);
  }

  root.innerHTML = `
    <div class="section-title" style="margin-top:8px">本周回顾 <span class="link">${weekCount} 个番茄</span></div>
    <div class="stats-strip three">
      <div class="stat"><div class="n">${weekCount}</div><div class="k">番茄</div></div>
      <div class="stat"><div class="n">${rate === null ? '—' : `${rate}%`}</div><div class="k">中断率</div></div>
      <div class="stat"><div class="n">${estimated ? `${hit}/${estimated}` : '—'}</div><div class="k">预估命中</div></div>
    </div>
    <div class="note">本周按周一起算 · 共 ${weekInts} 次打断 · 中断率 = 有中断的番茄 ÷ 完成番茄 · 预估命中 = 实际 ≤ 预估的任务数 ÷ 已估任务数</div>

    <div class="section-title">近 7 天 <span class="link">${totalDone} 个番茄</span></div>
    <div class="card chart-card">${chartSvg}</div>

    <div class="section-title">打断类型</div>
    <div class="card chart-donut">
      ${donutSvg}
      <div class="legend">
        <div class="lg"><i style="background:var(--accent)"></i>内部 · 走神<b>${nIn}</b></div>
        <div class="lg"><i style="background:var(--accent-3)"></i>外部 · 人/事<b>${nOut}</b></div>
      </div>
    </div>

    <div class="section-title">明细</div>
    ${groups.length ? groups.map((g) => `
      <div class="card" style="padding:6px 14px;margin-bottom:10px">
        <div style="padding:10px 0 6px;font-size:12.5px;color:var(--muted)">${g.date === today ? '今天' : g.date}</div>
        ${g.items.map((s) => itemRow(s, taskMap)).join('')}
      </div>`).join('') : `<div class="card empty"><span class="big">⏳</span>还没有记录<br>完成第一个番茄就会出现在这里</div>`}
  `;
}

function itemRow(s, taskMap) {
  const isFocus = s.kind === 'focus';
  const kindLabel = isFocus ? '' : (s.kind === 'long' ? '长休息' : '短休息');
  const label = isFocus
    ? (s.outcome === 'abandoned' ? '作废' : s.outcome === 'skipped' ? '跳过' : '专注')
    : (s.outcome === 'skipped' ? '跳过' : kindLabel);
  const task = s.taskId ? taskMap.get(s.taskId) : null;
  const title = isFocus ? (task ? task.title : '未选任务') : kindLabel;

  const ints = s.interruptions || [];
  const nIn = ints.filter((i) => i.type === 'internal').length;
  const nOut = ints.filter((i) => i.type === 'external').length;
  const durMin = s.durMs ? Math.max(1, Math.round(s.durMs / 60000)) : s.plannedMin;
  const callbacks = ints.filter((i) => i.callback).map((i) => `回电 ${i.callback}`);

  const meta = [
    s.outcome === 'abandoned' ? '中途作废' : `${durMin} 分钟`,
    ints.length ? `中断 ${ints.length}（内 ${nIn} / 外 ${nOut}）` : '',
    callbacks.join(' · '),
  ].filter(Boolean).join(' · ');

  const cls = s.outcome === 'abandoned' ? 'abandoned' : s.outcome === 'skipped' ? 'skipped' : '';
  return `<div class="session-row">
    <span class="t">${hhmm(s.startedAt)}</span>
    <span class="n">${esc(title)}<small class="sub">${esc(meta)}</small></span>
    <span class="badge ${cls}">${label}</span>
  </div>`;
}
