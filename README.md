# FitRoom — You, in the garment, before you pay

A product-page virtual try-on with a fit verdict, built for
**HackTheFashion Global'26** (Devpost), **Try-On Commerce** track.

- **Live demo:** https://rsaxena3011.github.io/fitroom-c141/
- **Repo:** https://github.com/rsaxena3011/fitroom-c141
- **Try-on API:** Clothsy AI virtual try-on API, built on FabricVTON
  (`https://api.clothsyai.fabricvton.com/api/v1`)

## What it does

1. The shopper picks a photo — a bundled sample shopper or their own upload.
2. They pick a garment from a four-piece demo catalogue, each with stated
   measurements and a price.
3. They pick their usual size and tick the consent box.
4. They get back the try-on image **and** a fit verdict — *True to size*,
   *Size up*, or *Size down* — computed from the garment's stated chest
   measurement against the standard for that size, with both numbers shown.
5. Every try-on can be saved to a shoppable lookbook (localStorage) with its
   verdict and price.

The retail value is the track's own: fit and size guidance that cuts
returns. The verdict is what makes this more than a thin wrapper around one
API call.

## Demo mode vs live mode

- **Demo mode (GitHub Pages link above):** no server, no key. Sample
  shoppers Ana and Dev get instant, pre-generated sample results, clearly
  labelled "Sample result" in the app. An uploaded photo in demo mode gets
  an honest message instead of a faked result — live try-on needs the
  server below.
- **Live mode (this server + a Clothsy API key):** real try-on calls go
  through `POST /api/tryon` on this server, which uploads the photo and the
  catalogue garment image to Clothsy AI, creates the try-on, and polls until
  the result arrives (usually under 30 seconds). The app shows the measured
  latency for every live try-on.

## Run it live (free)

1. Get a Clothsy AI API key — sign up at
   https://app.clothsyai.fabricvton.com and create a key under
   **Developer API**. The first key adds 20 free credits; the free Basic
   plan is 15 try-ons a month and needs no card. One finished try-on costs
   1 credit; failed try-ons are refunded automatically.
2. Run the server (zero dependencies, Node 18+):
   ```sh
   CLOTHSY_API_KEY=<your key> node server/server.js
   ```
   Open http://localhost:3000 — the badge at the top reads "Live try-on".
3. Without a key, `node server/server.js` still serves the app in demo mode.

To bank real results + latency numbers (1 credit each):
```sh
CLOTHSY_API_KEY=<your key> node scripts/live-tryon.cjs ana sweater
```
Results land in `tests/` as `live-<shopper>-<garment>.jpg` plus a
`latency-<shopper>-<garment>.json` record.

## How the API is used

- `POST /api/v1/images` — uploads the shopper photo and the garment image
  (free, no credit). Images are JPEG/PNG, max 4 MB; the browser shrinks
  uploads to 1600 px first.
- `POST /api/v1/tryons` — `personImageId` + `garmentImageId` + `title` +
  `consent: true`, with a per-click `Idempotency-Key` so a retry never
  charges twice.
- `GET /api/v1/tryons/{id}` — polled every 2.5 s; `resultUrl` on success.
- The key lives only in the server environment — never in browser code.
  The server looks garments up from its own catalogue; it never trusts an
  image URL sent by the browser. Shoppers tick a consent box (18+, own
  photo) before anything is uploaded, and results are captioned
  "AI-generated try-on".

## Fit verdict (honest, deterministic)

`fit.js` — the same module the browser and the tests use — compares the
garment's stated chest measurement in the shopper's size with the standard
body chest for that size:

- `>= +3 cm` → **Size down — runs large**
- `<= -3 cm` → **Size up — runs small**
- otherwise → **True to size**

It never claims to measure the shopper's body from the photo. Test it with
`node scripts/test-fit.mjs`.

## Privacy and consent

- Sample shoppers Ana and Dev are AI-generated adults, made for this demo.
  No real person's photo is used without consent; no photo of a minor is
  ever used.
- Uploaded photos go to Clothsy AI only to create the try-on; per their
  docs, uploaded photos are kept up to 35 days, then deleted automatically.
- The demo catalogue prices are fictional (demo shop, no checkout).

## Project layout

```
index.html / styles.css / app.js / fit.js   static single-page app
catalog.json                                garments, shoppers, size chart
assets/                                     sample photos, garments, samples
server/server.js / server/clothsy.js        zero-dependency Node server + API client
scripts/test-fit.mjs                        fit-verdict unit tests
scripts/live-tryon.cjs                      bank real try-ons + latency
tests/                                      live-try-on evidence (after key run)
```

## License

MIT — see LICENSE.
