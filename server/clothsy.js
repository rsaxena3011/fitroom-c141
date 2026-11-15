// Clothsy AI virtual try-on API client (built on FabricVTON).
// Docs: https://clothsyai.fabricvton.com/docs/api/endpoints/upload-image
//       https://clothsyai.fabricvton.com/docs/api/endpoints/create-try-on
// Zero dependencies — uses Node's global fetch / FormData / Blob.
// The API key lives only here, on the server. It never reaches the browser.
//
// Every call carries a 15 s timeout: the API host's TLS handshake has been
// observed stalling from this VM's egress proxy, and a stalled upstream
// must never hang the server or the shopper's browser.
const API_BASE = "https://api.clothsyai.fabricvton.com/api/v1";
const FETCH_TIMEOUT_MS = 15000;

async function apiFetch(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err && err.name === "TimeoutError") {
      const timeout = new Error(
        "The try-on service took too long to answer. Please try again."
      );
      timeout.code = "UPSTREAM_TIMEOUT";
      timeout.status = 504;
      throw timeout;
    }
    throw err;
  }
}

function apiKey() {
  const key = process.env.CLOTHSY_API_KEY;
  if (!key) {
    const err = new Error("CLOTHSY_API_KEY is not set on the server.");
    err.code = "NO_API_KEY";
    err.status = 503;
    throw err;
  }
  return key;
}

function friendlyMessage(code, fallback) {
  switch (code) {
    case "NO_API_KEY":
      return "Live try-on is not configured on this server (no API key). Run in demo mode or set CLOTHSY_API_KEY.";
    case "PERSON_PHOTO_REJECTED":
      return "Please use a clear, well-lit photo of just you, facing the camera.";
    case "IMAGE_REJECTED":
    case "GARMENT_REJECTED":
      return "Virtual try-on isn't available for this photo or item.";
    case "IMAGE_TOO_LARGE":
    case "UNSUPPORTED_IMAGE":
      return "Please use a JPEG or PNG photo under 4 MB.";
    case "RATE_LIMITED":
      return "Lots of people are trying things on right now. Try again in a minute.";
    case "INSUFFICIENT_CREDITS":
      return "The try-on credits are used up. The shop owner has been alerted.";
    case "INVALID_API_KEY":
      return "The server's try-on key is invalid. The shop owner has been alerted.";
    case "CONSENT_REQUIRED":
      return "Consent is required before a try-on can run.";
    default:
      return fallback || "Virtual try-on isn't available right now. Please try again later.";
  }
}

async function readError(res) {
  let code = null;
  let message = null;
  try {
    const body = await res.json();
    code = body.code || null;
    message = body.message || null;
  } catch {
    // Non-JSON error body — keep the HTTP status only.
  }
  const err = new Error(friendlyMessage(code, message));
  err.code = code;
  err.status = res.status;
  return err;
}

// POST /api/v1/images — uploading is free, no credit used.
// Returns { id: "img_…", expiresAt } — the id works for 24 hours.
async function uploadImage(buffer, filename, contentType) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  const res = await apiFetch(`${API_BASE}/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// POST /api/v1/tryons — 1 credit per finished try-on, refunded on failure.
// Returns 202 { id, status: "pending", pollUrl }.
async function createTryon({ personImageId, garmentImageId, title, idempotencyKey }) {
  const res = await apiFetch(`${API_BASE}/tryons`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Idempotency-Key": idempotencyKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personImageId,
      garmentImageId,
      title,
      consent: true,
    }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// GET /api/v1/tryons/{id} — poll until status is "success" or "failed".
// Success carries resultUrl (valid 24 hours, no key needed to load it).
async function getTryon(id) {
  const res = await apiFetch(`${API_BASE}/tryons/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// GET /account — key check + remaining credits (used by /api/status).
// The MCP docs name the route GET /account; the REST endpoints live under
// /api/v1/, so try /account first and fall back to /api/v1/account.
// Each attempt gets a short timeout: this is a best-effort balance check,
// never a reason to block the app.
async function getAccount() {
  const paths = [
    "https://api.clothsyai.fabricvton.com/account",
    `${API_BASE}/account`,
  ];
  let lastErr = null;
  for (const url of paths) {
    try {
      const res = await apiFetch(
        url,
        { headers: { Authorization: `Bearer ${apiKey()}` } },
        8000
      );
      if (res.ok) return res.json();
      lastErr = await readError(res);
      if (res.status !== 404) throw lastErr;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = {
  API_BASE,
  apiKey,
  friendlyMessage,
  uploadImage,
  createTryon,
  getTryon,
  getAccount,
};
