// FitRoom fit verdict — single source of truth, shared by the browser app
// (app.js) and the Node test (scripts/test-fit.mjs).
//
// The verdict is deterministic and explainable: it compares the garment's
// stated chest measurement in the shopper's usual size against the standard
// body chest for that size. It never claims to measure the shopper's body
// from the photo — the photo is for the try-on image only.
//
//   diff = garmentChest(size) - standardChest(size)
//   diff >= +3  -> "size-down"  (runs large: the garment is roomier than standard)
//   diff <= -3  -> "size-up"    (runs small: the garment is tighter than standard)
//   otherwise   -> "true-to-size"
export function fitVerdict(garment, size, sizeChart) {
  const standard = sizeChart.standardChestCm[size];
  const chest = garment.chestCm[size];
  if (standard === undefined || chest === undefined) return null;
  const diff = chest - standard;
  let verdict;
  let headline;
  if (diff >= 3) {
    verdict = "size-down";
    headline = "Size down — runs large";
  } else if (diff <= -3) {
    verdict = "size-up";
    headline = "Size up — runs small";
  } else {
    verdict = "true-to-size";
    headline = "True to size";
  }
  const direction =
    diff > 0 ? `${diff} cm roomier than standard` :
    diff < 0 ? `${Math.abs(diff)} cm tighter than standard` :
    "exactly on standard";
  return {
    verdict,
    headline,
    diffCm: diff,
    garmentChestCm: chest,
    standardChestCm: standard,
    size,
    reason:
      `In size ${size} this ${garment.name.toLowerCase()} measures ${chest} cm ` +
      `across the chest, against a ${standard} cm standard for size ${size} — ` +
      `${direction}.`
  };
}
