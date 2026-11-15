// Live try-on runner — run AFTER the Clothsy API key exists:
//   CLOTHSY_API_KEY=<key> node scripts/live-tryon.cjs <shopperId> <garmentId>
// Uploads the shopper photo + garment image to Clothsy AI, creates a try-on,
// polls until it finishes, downloads the result image and writes a latency
// record. Used to bank REAL try-on results + measured latency before filing.
// Costs 1 Clothsy credit per successful run.
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));
const clothsy = require(path.join(ROOT, "server", "clothsy.js"));

const [shopperId, garmentId] = process.argv.slice(2);
const shopper = catalog.shoppers.find((s) => s.id === shopperId);
const garment = catalog.garments.find((g) => g.id === garmentId);
if (!shopper || !garment) {
  console.error("Usage: CLOTHSY_API_KEY=<key> node scripts/live-tryon.cjs <shopperId> <garmentId>");
  console.error(`Shoppers: ${catalog.shoppers.map((s) => s.id).join(", ")}`);
  console.error(`Garments: ${catalog.garments.map((g) => g.id).join(", ")}`);
  process.exit(2);
}

function jpgPath(webpRel) {
  return path.join(ROOT, webpRel.replace(/\.webp$/, ".jpg"));
}

(async () => {
  const startedAt = Date.now();
  const personFile = jpgPath(shopper.photo);
  const garmentFile = jpgPath(garment.image);
  console.log(`Shopper: ${shopper.name} (${personFile})`);
  console.log(`Garment: ${garment.name} (${garmentFile})`);

  const person = await clothsy.uploadImage(
    fs.readFileSync(personFile),
    path.basename(personFile),
    "image/jpeg"
  );
  console.log(`Person image uploaded: ${person.id}`);
  const garmentImage = await clothsy.uploadImage(
    fs.readFileSync(garmentFile),
    path.basename(garmentFile),
    "image/jpeg"
  );
  console.log(`Garment image uploaded: ${garmentImage.id}`);

  const tryon = await clothsy.createTryon({
    personImageId: person.id,
    garmentImageId: garmentImage.id,
    title: garment.title,
    idempotencyKey: `live-${shopperId}-${garmentId}-${Date.now()}`,
  });
  console.log(`Try-on started: ${tryon.id} (status ${tryon.status})`);

  let result = null;
  for (let i = 0; i < 72; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    result = await clothsy.getTryon(tryon.id);
    console.log(`Poll ${i + 1}: ${result.status}`);
    if (result.status === "success" || result.status === "failed") break;
  }
  const latencyMs = Date.now() - startedAt;
  if (!result || result.status !== "success") {
    console.error(`Try-on did not succeed: ${JSON.stringify(result)}`);
    process.exit(1);
  }

  const outImage = path.join(ROOT, "tests", `live-${shopperId}-${garmentId}.jpg`);
  const imgRes = await fetch(result.resultUrl);
  if (!imgRes.ok) throw new Error(`Could not download result image (${imgRes.status})`);
  fs.writeFileSync(outImage, Buffer.from(await imgRes.arrayBuffer()));

  const record = {
    shopperId,
    garmentId,
    garmentName: garment.name,
    tryonId: tryon.id,
    resultUrl: result.resultUrl,
    latencyMs,
    latencySeconds: +(latencyMs / 1000).toFixed(1),
    ranAt: new Date().toISOString(),
    resultFile: path.relative(ROOT, outImage),
  };
  const outJson = path.join(ROOT, "tests", `latency-${shopperId}-${garmentId}.json`);
  fs.writeFileSync(outJson, JSON.stringify(record, null, 2));
  console.log(`Result saved: ${outImage}`);
  console.log(`Latency: ${record.latencySeconds} s — record: ${outJson}`);
})().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
