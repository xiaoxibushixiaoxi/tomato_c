// 备份：导出/导入 JSON，导出 CSV
import * as db from './db.js';
import { confirmBox } from './ui.js';
import { ymd } from './util.js';

const STORES = ['tasks', 'plans', 'sessions', 'settings'];

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportJSON() {
  const [tasks, plans, sessions, settings] = await Promise.all(STORES.map((s) => db.all(s)));
  const dump = {
    app: 'pomodoro',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    plans,
    sessions,
    settings,
  };
  download(`pomodoro-backup-${ymd()}.json`, JSON.stringify(dump, null, 2), 'application/json');
  return { tasks: tasks.length, sessions: sessions.length };
}

async function replaceAll(dump) {
  const dbh = await db.openDB();
  await new Promise((resolve, reject) => {
    const tx = dbh.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      tx.objectStore(name).clear();
      for (const row of dump[name] || []) tx.objectStore(name).put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function importJSON(file) {
  const text = await file.text();
  let dump;
  try {
    dump = JSON.parse(text);
  } catch (e) {
    throw new Error('这不是有效的 JSON 文件');
  }
  if (!dump || dump.app !== 'pomodoro' || !Array.isArray(dump.tasks) || !Array.isArray(dump.sessions)) {
    throw new Error('文件不是番茄钟导出的备份');
  }

  const ok = await confirmBox({
    title: '导入备份',
    message: `备份里有 ${dump.tasks.length} 个任务、${dump.sessions.length} 条记录。导入会覆盖这台设备上的全部数据，确定吗？`,
    okText: '覆盖导入',
    cancelText: '取消',
    danger: true,
  });
  if (!ok) return null;

  await replaceAll(dump);
  return { tasks: dump.tasks.length, sessions: dump.sessions.length, plans: dump.plans?.length || 0 };
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function exportCSV() {
  const [sessions, tasks] = await Promise.all([db.all('sessions'), db.all('tasks')]);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const head = ['开始时间', '结束时间', '类型', '结果', '任务', '项目', '计划分钟', '实际分钟', '中断数', '内部', '外部', '回电事项'];
  const lines = [head.join(',')];

  sessions
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .forEach((s) => {
      const task = s.taskId ? taskMap.get(s.taskId) : null;
      const ints = s.interruptions || [];
      const kind = s.kind === 'focus' ? '专注' : s.kind === 'long' ? '长休息' : '短休息';
      const outcome = s.outcome === 'abandoned' ? '作废' : s.outcome === 'skipped' ? '跳过' : '完成';
      lines.push([
        localTime(s.startedAt),
        localTime(s.endedAt),
        kind,
        outcome,
        task ? task.title : '',
        task ? task.project : '',
        s.plannedMin || '',
        s.durMs ? Math.round(s.durMs / 60000) : '',
        ints.length,
        ints.filter((i) => i.type === 'internal').length,
        ints.filter((i) => i.type === 'external').length,
        ints.filter((i) => i.callback).map((i) => i.callback).join(' / '),
      ].map(csvCell).join(','));
    });

  download(`pomodoro-sessions-${ymd()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
  return sessions.length;
}
