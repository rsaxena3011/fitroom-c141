// Fit verdict unit tests — run: node scripts/test-fit.mjs
// Uses the same fit.js the browser app uses.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fitVerdict } from "../fit.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8"));

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

const g = Object.fromEntries(catalog.garments.map((x) => [x.id, x]));
const chart = catalog.sizeChart;

check("sweater M is size-down", fitVerdict(g.sweater, "M", chart).verdict, "size-down");
check("sweater M diff is +8", fitVerdict(g.sweater, "M", chart).diffCm, 8);
check("blazer M is true-to-size", fitVerdict(g.blazer, "M", chart).verdict, "true-to-size");
check("blazer M diff is +1", fitVerdict(g.blazer, "M", chart).diffCm, 1);
check("jacket M is size-up", fitVerdict(g.jacket, "M", chart).verdict, "size-up");
check("jacket M diff is -3", fitVerdict(g.jacket, "M", chart).diffCm, -3);
check("shirt M is true-to-size", fitVerdict(g.shirt, "M", chart).verdict, "true-to-size");
check("shirt M diff is +2", fitVerdict(g.shirt, "M", chart).diffCm, 2);
check("sweater XS is size-down", fitVerdict(g.sweater, "XS", chart).verdict, "size-down");
check("jacket XL is size-up", fitVerdict(g.jacket, "XL", chart).verdict, "size-up");
check("blazer XL is true-to-size", fitVerdict(g.blazer, "XL", chart).verdict, "true-to-size");
check("unknown size returns null", fitVerdict(g.sweater, "XXL", chart), null);
check(
  "sweater M reason names both numbers",
  fitVerdict(g.sweater, "M", chart).reason.includes("110 cm") &&
    fitVerdict(g.sweater, "M", chart).reason.includes("102 cm"),
  true
);

if (failures > 0) {
  console.error(`${failures} test(s) failed.`);
  process.exit(1);
}
console.log("All fit-verdict tests passed.");
