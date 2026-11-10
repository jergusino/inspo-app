// Local storage layer shared by the page and the service worker.
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

// Images become PNG; videos are kept as shared (MP4 from Instagram).
async function normalizeMedia(file) {
  if (!file || typeof file === 'string' || !file.size) return null;
  if (file.type.startsWith('image/') && file.type !== 'image/png') {
    try {
      const bmp = await createImageBitmap(file);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d').drawImage(bmp, 0, 0);
      return await c.convertToBlob({ type: 'image/png' });
    } catch (e) { return file; }
  }
  return file;
}
function extFor(mime) {
  const m = { 'image/png': 'png', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  return m[mime] || (mime && mime.split('/')[1]) || 'bin';
}

// Returns { status: 'saved' | 'dup', item } or null when no Instagram link is found
async function saveLink(text, file) {
  const url = parseIg(text);
  if (!url) return null;
  const media = await normalizeMedia(file);
  const all = await dbAll();
  const existing = all.find(i => i.url === url);
  if (existing) {
    if (media && !existing.media) {
      Object.assign(existing, { media, mime: media.type, downloaded: false });
      await dbPut(existing);
    }
    return { status: 'dup', item: existing };
  }
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url, kind: igKind(url),
    media, mime: media ? media.type : null,
    downloaded: false, created: Date.now()
  };
  await dbPut(item);
  return { status: 'saved', item };
}
