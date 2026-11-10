'use strict';

// Best-effort reader for public Instagram post and reel pages.
// Instagram has no official download API for other people's posts, and its
// page markup changes often. Everything here is heuristic and may need updating.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LINK_RE = /(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/[^\s"'<>]*/i;
const POST_RE = /instagram\.com\/(?:[^/?#\s]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i;
const MEDIA_HOST_RE = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

class InstagramError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Accepts a full share text ("Look at this https://instagram.com/reel/AbC123/ ...") or a bare link.
function parseInstagramLink(text) {
  const m = String(text || '').match(LINK_RE);
  if (!m) return null;
  const p = m[0].match(POST_RE);
  return p ? { shortcode: p[1] } : null;
}

// Only Instagram/Facebook CDN hosts over https may be proxied, so the server is not an open proxy.
function isAllowedMediaUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && MEDIA_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

// Walks a JSON array or object starting at `start` (the opening bracket), honouring strings and escapes.
function walkJson(html, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

// Finds the first `"key":[...]` in the page's embedded JSON and parses it.
function findJsonArray(html, key) {
  const marker = `"${key}":`;
  let from = 0;
  for (;;) {
    const idx = html.indexOf(marker, from);
    if (idx < 0) return null;
    let j = idx + marker.length;
    while (html[j] === ' ') j++;
    if (html[j] === '[') {
      const raw = walkJson(html, j);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch {
          // malformed blob, keep searching
        }
      }
    }
    from = idx + marker.length;
  }
}

function bestBy(list, sizeOf) {
  return list.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a));
}

// One media node from Instagram's embedded data (a carousel child or a single post).
function mediaFromNode(node) {
  if (!node || typeof node !== 'object') return null;

  const videos = (Array.isArray(node.video_versions) ? node.video_versions : []).filter(v => v && v.url);
  if (videos.length) {
    const v = bestBy(videos, x => (x.width || 0) * (x.height || 0));
    return { type: 'video', url: v.url, width: v.width, height: v.height };
  }

  const cands = (node.image_versions2 && Array.isArray(node.image_versions2.candidates)
    ? node.image_versions2.candidates
    : []).filter(c => c && c.url);
  if (cands.length) {
    const c = bestBy(cands, x => (x.width || 0) * (x.height || 0));
    return { type: 'image', url: c.url, width: c.width, height: c.height };
  }

  if (typeof node.display_url === 'string') return { type: 'image', url: node.display_url };
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;|&#47;/g, '/')
    .replace(/&amp;/g, '&');
}

// Fallback: Open Graph tags. Gives the main image or video only, not the full carousel.
function ogMedia(html) {
  const found = {};
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of tags) {
    const p = t.match(/property=["']og:(video|image)(?::secure_url)?["']/i);
    const c = t.match(/content=["']([^"']+)["']/i);
    if (p && c) {
      const k = p[1].toLowerCase();
      if (!found[k]) found[k] = decodeEntities(c[1]);
    }
  }
  if (found.video) return [{ type: 'video', url: found.video }];
  if (found.image) return [{ type: 'image', url: found.image }];
  return [];
}

function extractMedia(html) {
  const carousel = findJsonArray(html, 'carousel_media');
  if (Array.isArray(carousel)) {
    const items = carousel.map(mediaFromNode).filter(Boolean);
    if (items.length) return { items, source: 'carousel-data' };
  }
  const items = ogMedia(html);
  return { items, source: items.length ? 'open-graph' : null };
}

async function getPost(input, fetchImpl = globalThis.fetch) {
  const parsed = parseInstagramLink(input);
  if (!parsed) {
    throw new InstagramError('INVALID_LINK', 'That is not an Instagram post or reel link.', 400);
  }

  let res;
  try {
    res = await fetchImpl(`https://www.instagram.com/p/${parsed.shortcode}/`, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new InstagramError('NETWORK', 'The server could not reach Instagram. Try again in a minute.', 502);
  }

  if (!res.ok) {
    throw new InstagramError('UPSTREAM', `Instagram responded with ${res.status}.`, 502);
  }
  if (/\/accounts\/login/.test(res.url || '')) {
    throw new InstagramError(
      'LOGIN_WALL',
      'Instagram asked for a login, so this post cannot be read right now. Try again later.',
      502
    );
  }

  const html = await res.text();
  const { items, source } = extractMedia(html);
  if (!items.length) {
    throw new InstagramError(
      'NO_MEDIA',
      "Couldn't find any media in this post. It may be private, deleted, or blocked from this server.",
      404
    );
  }
  return { shortcode: parsed.shortcode, source, items };
}

module.exports = {
  UA,
  InstagramError,
  parseInstagramLink,
  isAllowedMediaUrl,
  extractMedia,
  getPost,
};
