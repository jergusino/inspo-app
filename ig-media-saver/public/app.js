(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const CODE_KEY = 'igsaver.code';

  let current = null;     // { shortcode, items: [{ type, blob, name }] }
  let lastText = '';      // last link, retried after the access code is entered
  let busy = false;
  let previewUrls = [];

  function setStatus(msg, isError = false) {
    const s = $('status');
    s.textContent = msg;
    s.className = isError ? 'error' : '';
  }

  function getCode() {
    try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
  }
  function setCode(v) {
    try { localStorage.setItem(CODE_KEY, v); } catch { /* private mode: keep going */ }
  }

  function api(path, init = {}) {
    const headers = { ...(init.headers || {}), 'x-access-token': getCode() };
    return fetch(path, { ...init, headers });
  }

  function extFor(mime, kind) {
    if (kind === 'video' || /mp4|quicktime/.test(mime)) return 'mp4';
    if (/png/.test(mime)) return 'png';
    if (/webp/.test(mime)) return 'webp';
    return 'jpg';
  }

  function filesFor(items) {
    return items.map(it => new File([it.blob], it.name, {
      type: it.blob.type || (it.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    }));
  }

  function canShareFiles(items) {
    try {
      return Boolean(navigator.share && navigator.canShare && navigator.canShare({ files: filesFor(items) }));
    } catch {
      return false;
    }
  }

  function clearPreviews() {
    previewUrls.forEach(u => URL.revokeObjectURL(u));
    previewUrls = [];
    $('thumbs').textContent = '';
  }

  function render(post) {
    current = post;
    clearPreviews();
    $('result').hidden = false;
    $('title').textContent = `Post ${post.shortcode}`;
    const n = post.items.length;
    $('sub').textContent = `${n} file${n === 1 ? '' : 's'}`;

    for (const it of post.items) {
      const url = URL.createObjectURL(it.blob);
      previewUrls.push(url);
      let el;
      if (it.type === 'video') {
        el = document.createElement('video');
        el.src = url;
        el.controls = true;
        el.muted = true;
        el.loop = true;
        el.setAttribute('playsinline', '');
      } else {
        el = document.createElement('img');
        el.src = url;
        el.alt = '';
      }
      $('thumbs').appendChild(el);
    }

    $('share').hidden = !canShareFiles(post.items);
  }

  async function fetchPost(text) {
    if (busy) return;
    const input = (text || '').trim();
    if (!input) return setStatus('Paste an Instagram link first.', true);

    busy = true;
    lastText = input;
    $('go').disabled = true;
    $('result').hidden = true;
    $('auth').hidden = true;
    setStatus('Reading post…');

    try {
      const res = await api('api/post?url=' + encodeURIComponent(input));
      if (res.status === 401) {
        $('auth').hidden = false;
        return setStatus('Enter your access code to continue.', true);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not read that link.');

      setStatus(`Downloading ${data.items.length} file${data.items.length === 1 ? '' : 's'}…`);
      const items = [];
      for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i];
        const r = await api('api/media?u=' + encodeURIComponent(it.url));
        if (!r.ok) throw new Error(`File ${i + 1} failed to download (${r.status}).`);
        const blob = await r.blob();
        const num = String(i + 1).padStart(2, '0');
        items.push({
          type: it.type,
          blob,
          name: `ig_${data.shortcode}_${num}.${extFor(blob.type, it.type)}`,
        });
      }

      render({ shortcode: data.shortcode, items });
      setStatus('Ready. Save to Photos or download a zip.');
      history.replaceState(null, '', location.pathname);
    } catch (err) {
      setStatus(err.message || 'Something went wrong.', true);
    } finally {
      busy = false;
      $('go').disabled = false;
    }
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  $('form').addEventListener('submit', e => {
    e.preventDefault();
    fetchPost($('link').value);
  });

  $('authForm').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('code').value.trim();
    if (!code) return;
    setCode(code);
    $('code').value = '';
    fetchPost(lastText);
  });

  $('share').addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.share({ files: filesFor(current.items), title: current.shortcode });
      setStatus('Shared.');
    } catch (err) {
      if (err.name !== 'AbortError') setStatus('Share failed: ' + err.message, true);
    }
  });

  $('zip').addEventListener('click', async () => {
    if (!current || !window.JSZip) return;
    setStatus('Building zip…');
    const zip = new JSZip();
    for (const it of current.items) zip.file(it.name, it.blob);
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    downloadBlob(out, `ig_${current.shortcode}.zip`);
    setStatus('Zip downloaded.');
  });

  // Android share sheet: the manifest's share_target sends ?url=... or ?text=... to this page.
  const params = new URLSearchParams(location.search);
  const incoming = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  if (incoming) {
    $('link').value = incoming;
    history.replaceState(null, '', location.pathname);
    fetchPost(incoming);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
