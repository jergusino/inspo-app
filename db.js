// Tiny IndexedDB layer shared by the page and the service worker.
const DB_NAME = 'igsaver', STORE = 'items';

function dbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbTx(mode, fn) {
  const db = await dbOpen();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const q = fn(t.objectStore(STORE));
    t.oncomplete = () => res(q && q.result);
    t.onerror = () => rej(t.error);
  });
}
const dbAll = () => dbTx('readonly', s => s.getAll());
const dbPut = item => dbTx('readwrite', s => s.put(item));
const dbDel = id => dbTx('readwrite', s => s.delete(id));

function parseIg(text) {
  const m = (text || '').match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i);
  if (!m) return null;
  let u = m[0].split('?')[0].split('#')[0];
  if (!u.endsWith('/')) u += '/';
  return u;
}
function igKind(url) { return /\/reels?\//.test(url) ? 'Reel' : 'Post'; }

// Returns 'saved' | 'dup' | null (no Instagram link found)
async function saveLink(text, cover) {
  const url = parseIg(text);
  if (!url) return null;
  const all = await dbAll();
  const existing = all.find(i => i.url === url);
  if (existing) {
    if (cover && !existing.cover) { existing.cover = cover; await dbPut(existing); }
    return 'dup';
  }
  await dbPut({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url, kind: igKind(url), cover: cover || null, created: Date.now()
  });
  return 'saved';
}
