'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { UA, InstagramError, getPost, isAllowedMediaUrl } = require('./lib/instagram');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' });
}

function authorized(req) {
  if (!ACCESS_TOKEN) return true;
  const given = Buffer.from(String(req.headers['x-access-token'] || ''));
  const want = Buffer.from(ACCESS_TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

async function handleMedia(res, url) {
  const target = url.searchParams.get('u') || '';
  if (!isAllowedMediaUrl(target)) return json(res, 400, { error: 'Media host not allowed.' });

  const upstream = await fetch(target, {
    headers: { 'user-agent': UA, referer: 'https://www.instagram.com/' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !upstream.body || !/^(image|video)\//.test(type)) {
    return json(res, 502, { error: `Media fetch failed (${upstream.status}).` });
  }

  const headers = { 'content-type': type, 'cache-control': 'private, max-age=3600' };
  const len = upstream.headers.get('content-length');
  if (len) headers['content-length'] = len;
  res.writeHead(200, headers);
  Readable.fromWeb(upstream.body).pipe(res);
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (rel === '/') rel = '/index.html';

  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/healthz') return send(res, 200, 'ok');

    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req)) return json(res, 401, { error: 'Access code required.' });
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });

      if (url.pathname === '/api/post') {
        return json(res, 200, await getPost(url.searchParams.get('url') || ''));
      }
      if (url.pathname === '/api/media') return handleMedia(res, url);
      return json(res, 404, { error: 'Not found.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    if (err instanceof InstagramError) {
      return json(res, err.status, { error: err.message, code: err.code });
    }
    console.error('[server]', err && err.message);
    if (!res.headersSent) json(res, 500, { error: 'Server error. Try again.' });
  }
});

if (require.main === module) {
  if (!ACCESS_TOKEN) console.warn('[warn] ACCESS_TOKEN is not set; the API is open to anyone with the URL.');
  server.listen(PORT, () => console.log(`IG Media Saver listening on port ${PORT}`));
}

module.exports = server;
