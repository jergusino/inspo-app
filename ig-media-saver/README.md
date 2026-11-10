# IG Media Saver

A small installable web app (PWA) for saving the media from public Instagram posts, carousels and reels, for moodboards. Paste a link (or share a post to the app on Android) and it downloads every slide or the reel video. Then you can save them to Photos or download a zip.

## How it works

- `public/` is the PWA: one input, a preview, "Save to Photos" (uses the system share sheet) and "Download .zip".
- `server.js` is a small Node server with no dependencies. It reads the public post page, pulls out the media URLs, and proxies the files. The proxy only allows Instagram and Facebook CDN hosts, so it cannot be used to fetch arbitrary sites.
- `ACCESS_TOKEN` (optional but recommended) protects the API so only you can use your hosted copy.

## Run locally

```bash
npm test                      # unit tests for the parser and guards
ACCESS_TOKEN=choose-a-code npm start
# open http://localhost:3000
```

## Deploy (hosted)

1. Put this folder in a GitHub repo, or upload it to Render.
2. On [render.com](https://render.com): New → Web Service → connect the repo. The included `render.yaml` sets the build and start commands and generates an `ACCESS_TOKEN`. Copy that value from the Render dashboard (Environment tab).
3. Open the service URL on your phone:
   - **iPhone (Safari):** Share → Add to Home Screen. iOS does not support receiving links from the share sheet, so paste the link into the app.
   - **Android (Chrome):** menu → Install app. Then in Instagram, Share → IG Saver sends the link straight to the app.
4. Enter the access code once. It is stored on that device only.

## Limits to know about

- **Instagram has no official download API for other people's posts.** This reads the public page, and Instagram changes that page often. Expect occasional breakage, and check the parser in `lib/instagram.js` if posts start failing.
- **Hosted servers are often blocked.** Instagram frequently refuses or shows a login page to data-center IPs. If you see "asked for a login" or "could not reach Instagram" errors often, run the server on your own computer instead (`npm start`) and open the app over your home network.
- **Carousels:** the app reads the full carousel from the page data. If that data is missing, it falls back to the first slide only.
- **Free Render instances sleep** after inactivity, so the first request can take about a minute.
- **Terms and copyright:** Instagram's Terms restrict scraping, and the saved posts belong to their creators. Keep them for personal reference and moodboards, and do not repost them without permission.
