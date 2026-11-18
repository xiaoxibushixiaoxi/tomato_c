// 业务数据层（任务 / 每日计划 / 番茄记录）
//
// 数据结构（IndexedDB 库 `pomodoro`，v1；时间戳一律毫秒，日期键一律本地 'YYYY-MM-DD'）：
//   tasks    { id, title, project, estimate:number|null, done:boolean, archived:boolean, createdAt }
//   plans    { date, taskIds:string[], closed:boolean, closedAt?:number }
//   sessions { id, taskId:string|null, kind:'focus'|'short'|'long', plannedMin:number,
//              durMs:number, startedAt, endedAt, outcome:'done'|'abandoned'|'skipped',
//              interruptions:Array<{ id, at, type:'internal'|'external'|null, note, callback?:string }>, createdAt }
//   settings { key:'app', value:{ focusMin, shortMin, longMin, longEvery, strict, autoBreak, autoNext, sound, notify } }
//
// 约定：任务硬删除；「丢弃」只移出当日计划，不删任务；计划按日期存，closed 表示当天已收工。
import * as db from './db.js';
import { uid, ymd, dayRange } from './util.js';

/* ---------------- 任务 ---------------- */

export async function listTasks({ includeArchived = false } = {}) {
  const rows = await db.all('tasks');
  return rows
    .filter((t) => includeArchived || !t.archived)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listProjects() {
  const rows = await db.all('tasks');
  const set = new Set();
  for (const t of rows) if (t.project && !t.archived) set.add(t.project);
  return [...set];
}

export async function addTask({ title, project = '', estimate = null }) {
  const task = {
    id: uid(),
    title: title.trim(),
    project: project.trim(),
    estimate: estimate ? Number(estimate) : null,
    done: false,
    archived: false,
    createdAt: Date.now(),
  };
  await db.put('tasks', task);
  return task;
}

export async function updateTask(id, patch) {
  const old = await db.get('tasks', id);
  if (!old) return null;
  const next = { ...old, ...patch };
  await db.put('tasks', next);
  return next;
}

export async function removeTask(id) {
  await db.del('tasks', id);
}

// 归档 = 从清单里收起来（不删除）；已完成的任务靠 done 标记区分
export async function archiveTask(id) {
  return updateTask(id, { archived: true });
}

export async function unarchiveTask(id) {
  return updateTask(id, { archived: false });
}

export async function archiveCompleted() {
  const rows = await db.all('tasks');
  const done = rows.filter((t) => t.done && !t.archived);
  for (const t of done) await db.put('tasks', { ...t, archived: true });
  return done.length;
}

// 每个任务实际完成的番茄数（用于「预估 vs 实际」对比）
export async function focusCountByTask() {
  const rows = await db.all('sessions');
  const m = new Map();
  for (const s of rows) {
    if (s.kind !== 'focus' || s.outcome !== 'done' || !s.taskId) continue;
    m.set(s.taskId, (m.get(s.taskId) || 0) + 1);
  }
  return m;
}

/* ---------------- 每日计划 ---------------- */

export async function getPlan(date = ymd()) {
  const row = await db.get('plans', date);
  return row || { date, taskIds: [], closed: false };
}

export async function savePlan(plan) {
  const next = { ...plan, date: plan.date || ymd() };
  await db.put('plans', next);
  return next;
}

export async function addToPlan(taskId, date = ymd()) {
  const plan = await getPlan(date);
  if (!plan.taskIds.includes(taskId)) plan.taskIds.push(taskId);
  // 往已收工的一天里加事，等于重新开工
  if (plan.closed) { plan.closed = false; delete plan.closedAt; }
  return savePlan(plan);
}

export async function removeFromPlan(taskId, date = ymd()) {
  const plan = await getPlan(date);
  plan.taskIds = plan.taskIds.filter((id) => id !== taskId);
  return savePlan(plan);
}

/* ---------------- 番茄记录 ---------------- */

export async function addSession(session) {
  const row = { id: uid(), createdAt: Date.now(), ...session };
  await db.put('sessions', row);
  return row;
}

export async function updateSession(id, patch) {
  const old = await db.get('sessions', id);
  if (!old) return null;
  const next = { ...old, ...patch };
  await db.put('sessions', next);
  return next;
}

export async function sessionsOfDate(date = ymd()) {
  const [start, end] = dayRange(date);
  const rows = await db.getAllBy('sessions', 'startedAt', IDBKeyRange.bound(start, end - 1));
  return rows.sort((a, b) => a.startedAt - b.startedAt);
}

export async function recentSessions(limit = 200) {
  const rows = await db.all('sessions');
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

// 从某个时间戳起的会话（升序），用于周统计 / 近 7 天图表
export async function sessionsSince(ts) {
  const rows = await db.all('sessions');
  return rows.filter((s) => s.startedAt >= ts).sort((a, b) => a.startedAt - b.startedAt);
}

// 本周一 00:00 的时间戳（本地时区）
export function startOfWeek(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const wd = (d.getDay() + 6) % 7; // 周一 = 0
  d.setDate(d.getDate() - wd);
  return d.getTime();
}

export async function countFocus(date = ymd()) {
  const rows = await sessionsOfDate(date);
  return rows.filter((s) => s.kind === 'focus' && s.outcome === 'done').length;
}

/* ---------------- 当日汇总 & 日终处理 ---------------- */

export function nextDate(date = ymd()) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return ymd(d);
}

export async function statsOfDate(date = ymd()) {
  const [tasks, plan, sessions] = await Promise.all([
    listTasks({ includeArchived: true }), getPlan(date), sessionsOfDate(date),
  ]);
  const map = new Map(tasks.map((t) => [t.id, t]));
  const focus = sessions.filter((s) => s.kind === 'focus');
  const doneFocus = focus.filter((s) => s.outcome === 'done');
  const plannedIds = plan.taskIds.filter((id) => map.has(id));
  return {
    pomodoros: doneFocus.length,
    minutes: doneFocus.reduce((a, s) => a + (s.plannedMin || 0), 0),
    interruptions: focus.reduce((a, s) => a + (s.interruptions?.length || 0), 0),
    planned: plannedIds.length,
    finished: plannedIds.filter((id) => map.get(id).done).length,
    remaining: plannedIds.filter((id) => !map.get(id).done).length,
    closed: !!plan.closed,
  };
}

// 把一个没做完的任务顺延到次日计划（先从当日移除，避免两边重复）
export async function carryTaskToNextDay(taskId, from = ymd()) {
  await removeFromPlan(taskId, from);
  const to = nextDate(from);
  const plan = await getPlan(to);
  if (!plan.taskIds.includes(taskId)) plan.taskIds.push(taskId);
  await savePlan(plan);
  return to;
}

export async function closeDay(date = ymd()) {
  const plan = await getPlan(date);
  plan.closed = true;
  plan.closedAt = Date.now();
  await savePlan(plan);
  return plan;
}

export async function reopenDay(date = ymd()) {
  const plan = await getPlan(date);
  plan.closed = false;
  delete plan.closedAt;
  await savePlan(plan);
  return plan;
}
