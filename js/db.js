// IndexedDB 极简封装：tasks / plans / sessions / settings
const NAME = 'pomodoro';
const VERSION = 1;

let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tasks')) {
        const s = db.createObjectStore('tasks', { keyPath: 'id' });
        s.createIndex('project', 'project');
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('plans')) {
        db.createObjectStore('plans', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt');
        s.createIndex('taskId', 'taskId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被其它标签页占用'));
  });
  return dbp;
}

async function os(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  return wrap((await os(store, 'readwrite')).put(value));
}

export async function get(store, key) {
  return wrap((await os(store)).get(key));
}

export async function del(store, key) {
  return wrap((await os(store, 'readwrite')).delete(key));
}

export async function all(store) {
  return wrap((await os(store)).getAll());
}

export async function getAllBy(store, index, key) {
  return wrap((await os(store)).index(index).getAll(key));
}
