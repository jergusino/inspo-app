'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseInstagramLink,
  isAllowedMediaUrl,
  extractMedia,
  getPost,
  InstagramError,
} = require('../lib/instagram');

// Synthetic fixtures that mimic the embedded-JSON shape. They test the parser, not live Instagram.
const carouselHtml = `<html><head><meta property="og:image" content="https://scontent.cdninstagram.com/og.jpg"></head><body>
<script type="application/json">{"xdt":{"items":[{"carousel_media":[
{"id":"1","image_versions2":{"candidates":[{"width":320,"height":400,"url":"https:\\/\\/scontent.cdninstagram.com\\/a-320.jpg"},{"width":1080,"height":1350,"url":"https:\\/\\/scontent.cdninstagram.com\\/a-1080.jpg?x=1\\u0026y=2"}]}},
{"id":"2","video_versions":[{"width":480,"height":600,"url":"https:\\/\\/scontent.cdninstagram.com\\/v-480.mp4"},{"width":720,"height":900,"url":"https:\\/\\/scontent.cdninstagram.com\\/v-720.mp4"}],"image_versions2":{"candidates":[{"width":720,"height":900,"url":"https:\\/\\/scontent.cdninstagram.com\\/thumb.jpg"}]}},
{"id":"3","image_versions2":{"candidates":[{"width":1080,"height":1350,"url":"https:\\/\\/scontent.cdninstagram.com\\/c-1080.jpg"}]}}
]}]}}</script></body></html>`;

const ogVideoHtml = `<html><head>
<meta content="https://scontent.cdninstagram.com/reel.mp4?a=1&amp;b=2" property="og:video">
<meta property="og:image" content="https://scontent.cdninstagram.com/thumb.jpg">
</head><body></body></html>`;

const ogImageHtml = `<html><head><meta property="og:image" content="https://scontent.cdninstagram.com/p.jpg"></head></html>`;

test('parseInstagramLink handles share text, reels, and old username paths', () => {
  assert.deepEqual(parseInstagramLink('https://www.instagram.com/reel/C9abcDEF12/?igsh=xyz'), { shortcode: 'C9abcDEF12' });
  assert.deepEqual(parseInstagramLink('instagram.com/p/ABC_def-12/'), { shortcode: 'ABC_def-12' });
  assert.deepEqual(parseInstagramLink('https://instagram.com/someone/p/Xyz12345/'), { shortcode: 'Xyz12345' });
  assert.deepEqual(parseInstagramLink('Look at this https://www.instagram.com/p/ABCDE12345/ so good'), { shortcode: 'ABCDE12345' });
  assert.equal(parseInstagramLink('https://example.com/p/ABCDE12345/'), null);
  assert.equal(parseInstagramLink('just some text'), null);
});

test('extractMedia reads every carousel slide in order, choosing the largest size', () => {
  const { items, source } = extractMedia(carouselHtml);
  assert.equal(source, 'carousel-data');
  assert.deepEqual(items.map(i => i.type), ['image', 'video', 'image']);
  assert.equal(items[0].url, 'https://scontent.cdninstagram.com/a-1080.jpg?x=1&y=2');
  assert.equal(items[1].url, 'https://scontent.cdninstagram.com/v-720.mp4');
  assert.equal(items[2].url, 'https://scontent.cdninstagram.com/c-1080.jpg');
});

test('extractMedia falls back to Open Graph video for a reel and decodes entities', () => {
  const { items, source } = extractMedia(ogVideoHtml);
  assert.equal(source, 'open-graph');
  assert.deepEqual(items, [{ type: 'video', url: 'https://scontent.cdninstagram.com/reel.mp4?a=1&b=2' }]);
});

test('extractMedia falls back to Open Graph image for a single photo', () => {
  assert.deepEqual(extractMedia(ogImageHtml).items, [{ type: 'image', url: 'https://scontent.cdninstagram.com/p.jpg' }]);
});

test('extractMedia returns nothing for a page without media', () => {
  assert.deepEqual(extractMedia('<html><title>Log in</title></html>').items, []);
});

test('getPost returns shortcode and items from a fetched page', async () => {
  const fakeFetch = async (url) => {
    assert.equal(url, 'https://www.instagram.com/p/C9abcDEF12/');
    return { ok: true, status: 200, url, text: async () => carouselHtml };
  };
  const post = await getPost('https://www.instagram.com/reel/C9abcDEF12/', fakeFetch);
  assert.equal(post.shortcode, 'C9abcDEF12');
  assert.equal(post.items.length, 3);
});

test('getPost reports a login wall instead of returning empty results', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, url: 'https://www.instagram.com/accounts/login/', text: async () => '' });
  await assert.rejects(getPost('https://www.instagram.com/p/ABCDE12345/', fakeFetch), err => {
    assert.ok(err instanceof InstagramError);
    assert.equal(err.code, 'LOGIN_WALL');
    return true;
  });
});

test('getPost rejects non-Instagram input before any network call', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  await assert.rejects(getPost('https://example.com/', fakeFetch), err => err.code === 'INVALID_LINK');
  assert.equal(called, false);
});

test('getPost reports pages with no media', async () => {
  const fakeFetch = async (url) => ({ ok: true, status: 200, url, text: async () => '<html></html>' });
  await assert.rejects(getPost('https://www.instagram.com/p/ABCDE12345/', fakeFetch), err => err.code === 'NO_MEDIA');
});

test('isAllowedMediaUrl only allows https Instagram and Facebook CDN hosts', () => {
  assert.equal(isAllowedMediaUrl('https://scontent.cdninstagram.com/x.jpg'), true);
  assert.equal(isAllowedMediaUrl('https://scontent-x.xx.fbcdn.net/x.mp4'), true);
  assert.equal(isAllowedMediaUrl('http://scontent.cdninstagram.com/x.jpg'), false);
  assert.equal(isAllowedMediaUrl('https://evil.com/?x=.cdninstagram.com'), false);
  assert.equal(isAllowedMediaUrl('https://cdninstagram.com.evil.com/x.jpg'), false);
  assert.equal(isAllowedMediaUrl('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isAllowedMediaUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedMediaUrl('not a url'), false);
});
