// FitRoom — single-page try-on app.
// Two modes, detected at load:
//   LIVE — the FitRoom server is running with a Clothsy API key: real
//          try-on calls go through POST /api/tryon and are polled.
//   DEMO — no server: bundled sample shoppers get their pre-generated
//          sample results instantly, clearly labelled as samples. An
//          uploaded photo in demo mode gets an honest message, never a
//          faked result.
import { fitVerdict } from "./fit.js";

const ALL_SIZES = ["XS", "S", "M", "L", "XL"];
const LOOKBOOK_KEY = "fitroom-lookbook-v1";

const state = {
  catalog: null,
  mode: "demo", // "live" | "demo"
  credits: null,
  shopperId: "ana",
  upload: null, // { name, blob, dataUrl } when the shopper uploads a photo
  garmentId: "sweater",
  size: "M",
  currentResult: null,
};

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function loadCatalog() {
  const res = await fetch("catalog.json");
  if (!res.ok) throw new Error("Could not load catalog.json");
  state.catalog = await res.json();
}

async function detectMode() {
  const badge = $("mode-badge");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch("api/status", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("status not ok");
    const body = await res.json();
    if (body.live) {
      state.mode = "live";
      state.credits = body.credits;
      badge.textContent =
        `Live try-on — Clothsy AI connected` +
        (body.credits !== null && body.credits !== undefined
          ? ` · ${body.credits} credits left`
          : "");
      badge.classList.add("live");
      return;
    }
    throw new Error(body.message || "no key configured");
  } catch (err) {
    state.mode = "demo";
    badge.textContent =
      "Demo mode — sample shoppers with pre-generated results. Run the server with a Clothsy API key for live try-ons.";
    badge.classList.add("demo");
  }
}

function garment() {
  return state.catalog.garments.find((g) => g.id === state.garmentId);
}

function shopper() {
  return state.catalog.shoppers.find((s) => s.id === state.shopperId);
}

function renderShoppers() {
  const grid = $("shopper-grid");
  grid.innerHTML = "";
  for (const s of state.catalog.shoppers) {
    const card = el("button", "card", "");
    card.type = "button";
    card.setAttribute("aria-pressed", s.id === state.shopperId && !state.upload ? "true" : "false");
    if (s.id === state.shopperId && !state.upload) card.classList.add("selected");
    const img = document.createElement("img");
    img.src = s.photo;
    img.alt = s.label;
    const body = el("div", "card-body");
    body.append(el("div", "card-name", s.name));
    body.append(el("div", "card-sub", "Sample shopper — AI-generated adult"));
    card.append(img, body);
    card.addEventListener("click", () => {
      state.shopperId = s.id;
      state.upload = null;
      $("photo-input").value = "";
      renderShoppers();
      renderPhotoPreview();
    });
    grid.append(card);
  }
}

function renderGarments() {
  const grid = $("garment-grid");
  grid.innerHTML = "";
  for (const g of state.catalog.garments) {
    const card = el("button", "card", "");
    card.type = "button";
    card.setAttribute("aria-pressed", g.id === state.garmentId ? "true" : "false");
    if (g.id === state.garmentId) card.classList.add("selected");
    const img = document.createElement("img");
    img.src = g.image;
    img.alt = g.name;
    const body = el("div", "card-body");
    body.append(el("div", "card-name", g.name));
    body.append(el("div", "card-sub", `$${g.priceUsd} · ${g.fit}`));
    card.append(img, body);
    card.addEventListener("click", () => {
      state.garmentId = g.id;
      if (!g.sizes.includes(state.size)) state.size = "M";
      renderGarments();
      renderSizes();
    });
    grid.append(card);
  }
}

function renderSizes() {
  const row = $("size-row");
  row.innerHTML = "";
  const g = garment();
  for (const size of ALL_SIZES) {
    const btn = el("button", "size-btn", size);
    btn.type = "button";
    btn.disabled = !g.sizes.includes(size);
    if (size === state.size) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      state.size = size;
      renderSizes();
    });
    row.append(btn);
  }
}

function renderPhotoPreview() {
  const line = $("photo-preview-line");
  const preview = $("photo-preview");
  if (state.upload) {
    line.textContent = `Your photo: ${state.upload.name}. It will be sent for a live try-on only.`;
    preview.src = state.upload.dataUrl;
    preview.hidden = false;
  } else {
    const s = shopper();
    line.textContent = `Using sample shopper ${s.name} (${s.note})`;
    preview.src = s.photo;
    preview.hidden = false;
  }
}

// Shrink an uploaded photo to at most 1600 px and re-encode as JPEG,
// following the Clothsy guide (API limit 4 MB; also drops camera EXIF).
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
}

function setStatus(text, isError) {
  const s = $("tryon-status");
  s.textContent = text;
  s.classList.toggle("error", !!isError);
}

function showResult({ beforeSrc, afterSrc, caption, meta, verdict }) {
  $("result-before").src = beforeSrc;
  $("result-after").src = afterSrc;
  $("result-caption").textContent = caption;
  $("result-meta").textContent = meta;
  const card = $("verdict-card");
  card.className = "verdict " + verdict.verdict;
  $("verdict-headline").textContent = `${verdict.headline} — take size ${state.size}`;
  $("verdict-reason").textContent = verdict.reason;
  $("verdict-numbers").textContent =
    `Garment chest ${verdict.garmentChestCm} cm · standard for size ${state.size} ${verdict.standardChestCm} cm · difference ${verdict.diffCm >= 0 ? "+" : ""}${verdict.diffCm} cm. ` +
    `Verdict is computed from the garment's stated measurements, not from the photo.`;
  $("result-section").hidden = false;
  $("result-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function currentVerdict() {
  return fitVerdict(garment(), state.size, state.catalog.sizeChart);
}

async function runTryOn() {
  const status = $("tryon-status");
  const go = $("tryon-go");
  const g = garment();
  const v = currentVerdict();

  if (!$("consent").checked) {
    setStatus("Tick the consent box first — try-ons need your agreement before any photo is sent.", true);
    return;
  }
  if (!v) {
    setStatus("That size is not offered for this garment. Pick another size.", true);
    return;
  }

  go.disabled = true;
  const startedAt = performance.now();

  try {
    if (state.mode === "live") {
      await runLiveTryOn(g, v, startedAt);
    } else {
      runDemoTryOn(g, v);
    }
  } catch (err) {
    setStatus(err.message || "The try-on failed. Please try again.", true);
  } finally {
    go.disabled = false;
  }
}

async function runLiveTryOn(g, v, startedAt) {
  setStatus("Uploading your photo and starting the try-on…");
  const form = new FormData();
  form.append("garmentId", g.id);
  form.append("size", state.size);
  form.append("consent", "true");
  form.append("requestId", crypto.randomUUID());
  if (state.upload) {
    form.append("photo", state.upload.blob, "photo.jpg");
  } else {
    form.append("shopperId", state.shopperId);
  }

  const start = await fetch("api/tryon", { method: "POST", body: form });
  const started = await start.json().catch(() => ({}));
  if (!start.ok) throw new Error(started.message || "Could not start the try-on.");

  setStatus("Try-on running — the image usually arrives in under 30 seconds…");
  for (let i = 0; i < 72; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`api/tryon/${encodeURIComponent(started.id)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || "Could not check the try-on.");
    if (body.status === "success") {
      const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
      const before = state.upload ? state.upload.dataUrl : shopper().photo;
      state.currentResult = {
        beforeSrc: before,
        afterSrc: body.resultUrl,
        caption: "AI-generated try-on",
        meta: `Live result via the Clothsy AI virtual try-on API · took ${secs} s · try-on ${started.id}`,
        verdict: v,
        mode: "live",
        latencyMs: Math.round(performance.now() - startedAt),
      };
      showResult(state.currentResult);
      setStatus(`Done in ${secs} s.`);
      return;
    }
    if (body.status === "failed") {
      throw new Error(body.message || "The try-on could not be made from this photo.");
    }
  }
  throw new Error("This is taking longer than usual. Please try again.");
}

function runDemoTryOn(g, v) {
  if (state.upload) {
    setStatus(
      "Demo mode can't try on your own photo — there is no live API here. " +
        "Use a sample shopper for an instant sample result, or run the included server with a Clothsy API key (see README) for a live try-on.",
      true
    );
    return;
  }
  const sample = g.samples[state.shopperId];
  state.currentResult = {
    beforeSrc: shopper().photo,
    afterSrc: sample,
    caption: "AI-generated try-on — sample result",
    meta:
      `Sample result — pre-generated for this demo, not a live API call. ` +
      `Run the server with a Clothsy API key for a live try-on of your own photo.`,
    verdict: v,
    mode: "demo",
    latencyMs: null,
  };
  showResult(state.currentResult);
  setStatus("Sample result shown. It is labelled as a sample — live try-ons need the server + API key.");
}

// ---- Lookbook (localStorage only) ----
function loadLookbook() {
  try {
    return JSON.parse(localStorage.getItem(LOOKBOOK_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLookbook(items) {
  localStorage.setItem(LOOKBOOK_KEY, JSON.stringify(items));
}

function renderLookbook() {
  const grid = $("lookbook-grid");
  const items = loadLookbook();
  grid.innerHTML = "";
  $("lookbook-empty").hidden = items.length > 0;
  for (const item of items) {
    const card = el("article", "card");
    const img = document.createElement("img");
    img.src = item.afterSrc;
    img.alt = `${item.garmentName} try-on result`;
    const body = el("div", "card-body");
    body.append(el("div", "card-name", item.garmentName));
    body.append(
      el("div", "card-sub", `$${item.priceUsd} · size ${item.size} · ${item.verdictHeadline}`)
    );
    const remove = el("button", "remove", "Remove from lookbook");
    remove.type = "button";
    remove.addEventListener("click", () => {
      saveLookbook(loadLookbook().filter((x) => x.id !== item.id));
      renderLookbook();
    });
    card.append(img, body, remove);
    grid.append(card);
  }
}

function saveCurrentToLookbook() {
  const r = state.currentResult;
  if (!r) return;
  const g = garment();
  const items = loadLookbook();
  items.unshift({
    id: `${Date.now()}-${g.id}`,
    garmentId: g.id,
    garmentName: g.name,
    priceUsd: g.priceUsd,
    size: state.size,
    verdictHeadline: r.verdict.headline,
    afterSrc: r.afterSrc,
    mode: r.mode,
    ts: new Date().toISOString(),
  });
  saveLookbook(items);
  renderLookbook();
  setStatus("Saved to your lookbook.");
}

async function init() {
  try {
    await loadCatalog();
  } catch (err) {
    setStatus("Could not load the catalogue. Check that catalog.json sits next to this page.", true);
    return;
  }
  renderShoppers();
  renderGarments();
  renderSizes();
  renderPhotoPreview();
  renderLookbook();
  await detectMode();

  $("photo-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setStatus("Please choose a JPEG or PNG photo.", true);
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setStatus("That photo is over 4 MB. Please choose a smaller one.", true);
      return;
    }
    const blob = await shrinkPhoto(file);
    state.upload = {
      name: file.name,
      blob,
      dataUrl: URL.createObjectURL(blob),
    };
    renderShoppers();
    renderPhotoPreview();
    setStatus("Photo ready. Pick a garment and run the try-on.");
  });

  $("tryon-go").addEventListener("click", runTryOn);
  $("save-look").addEventListener("click", saveCurrentToLookbook);
  $("try-another").addEventListener("click", () => {
    $("result-section").hidden = true;
    document.getElementById("h-garment").scrollIntoView({ behavior: "smooth" });
  });
}

init();
