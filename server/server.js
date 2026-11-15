// FitRoom server — zero dependencies, plain node:http.
// Serves the static app and proxies try-on calls to the Clothsy AI API so
// the API key stays on the server (never in browser code), exactly as the
// Clothsy custom-store guide requires.
//
//   CLOTHSY_API_KEY=<key> node server/server.js   # live mode (port 3000)
//   node server/server.js                          # demo mode (no key)
//
// Routes:
//   GET  /                       -> index.html (static app)
//   GET  /api/status             -> { live, credits, message }
//   POST /api/tryon              -> multipart: garmentId, shopperId|photo,
//                                  requestId, consent. Returns 202 { id }.
//   GET  /api/tryon/:id          -> { status, resultUrl?, message? }
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const clothsy = require("./clothsy");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

// Minimal multipart/form-data parser: one file field ("photo") plus text
// fields. Returns { fields: {name: string}, files: {photo: {buffer, filename, contentType}} }.
function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = {};
  const sep = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(sep);
  if (start === -1) throw new Error("Malformed multipart body.");
  while (start !== -1) {
    const headerEnd = buffer.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;
    const header = buffer.slice(start + sep.length, headerEnd).toString("utf8");
    const nameMatch = header.match(/name="([^"]+)"/);
    if (!nameMatch) break;
    const name = nameMatch[1];
    const filenameMatch = header.match(/filename="([^"]*)"/);
    const contentStart = headerEnd + 4;
    let next = buffer.indexOf(sep, contentStart);
    if (next === -1) break;
    let contentEnd = next - 2; // strip the CRLF before the boundary
    const content = buffer.slice(contentStart, contentEnd);
    if (filenameMatch && filenameMatch[1]) {
      const typeMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
      files[name] = {
        buffer: content,
        filename: filenameMatch[1],
        contentType: (typeMatch && typeMatch[1].trim()) || "application/octet-stream",
      };
    } else {
      fields[name] = content.toString("utf8");
    }
    start = next;
    // A boundary followed by "--" is the closing boundary: stop.
    if (buffer.slice(start + sep.length, start + sep.length + 2).toString() === "--") break;
  }
  return { fields, files };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_PHOTO_BYTES + 65536) {
        reject(Object.assign(new Error("Upload is too large (4 MB limit)."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

let statusCache = { at: 0, body: null };
async function handleStatus(res) {
  const now = Date.now();
  if (statusCache.body && now - statusCache.at < 60000) {
    return sendJson(res, 200, statusCache.body);
  }
  if (!process.env.CLOTHSY_API_KEY) {
    const body = { live: false, credits: null, message: "No API key configured on this server." };
    statusCache = { at: now, body };
    return sendJson(res, 200, body);
  }
  // A key is configured: the server IS live-capable. The credit balance is
  // best-effort — a slow or failing balance check never reports the server
  // as dead, because a timeout says nothing about the key's validity.
  let credits = null;
  let message = "Live try-on connected.";
  try {
    const account = await clothsy.getAccount();
    credits =
      account.creditsRemaining ?? account.credits_remaining ?? account.credits ?? null;
  } catch (err) {
    message = "Live try-on connected. Credit balance could not be read just now.";
  }
  const body = { live: true, credits, message };
  statusCache = { at: now, body };
  return sendJson(res, 200, body);
}

async function handleCreateTryon(req, res) {
  if (!process.env.CLOTHSY_API_KEY) {
    return sendJson(res, 503, {
      message: clothsy.friendlyMessage("NO_API_KEY"),
    });
  }
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) {
    return sendJson(res, 400, { message: "Expected a multipart form upload." });
  }
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { message: err.message });
  }
  let parts;
  try {
    parts = parseMultipart(body, boundary);
  } catch (err) {
    return sendJson(res, 400, { message: err.message });
  }
  const { fields, files } = parts;

  if (fields.consent !== "true") {
    return sendJson(res, 403, { message: clothsy.friendlyMessage("CONSENT_REQUIRED") });
  }
  const garment = catalog.garments.find((g) => g.id === fields.garmentId);
  if (!garment) {
    return sendJson(res, 400, { message: "Unknown garment." });
  }
  const requestId = (fields.requestId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    return sendJson(res, 400, {
      message: "A requestId of 8-128 letters, digits, _ or - is required.",
    });
  }

  // Person photo: the shopper's upload, or a bundled sample shopper's file.
  // The garment image always comes from our own catalogue on disk — the
  // browser is never trusted to name an image URL (credits protection).
  let personBuffer;
  let personName;
  let personType;
  if (files.photo) {
    if (files.photo.buffer.length > MAX_PHOTO_BYTES) {
      return sendJson(res, 413, { message: "Please use a JPEG or PNG photo under 4 MB." });
    }
    if (!["image/jpeg", "image/png"].includes(files.photo.contentType)) {
      return sendJson(res, 400, { message: "Please use a JPEG or PNG photo." });
    }
    personBuffer = files.photo.buffer;
    personName = "photo.jpg";
    personType = "image/jpeg";
  } else if (fields.shopperId) {
    const shopper = catalog.shoppers.find((s) => s.id === fields.shopperId);
    if (!shopper) return sendJson(res, 400, { message: "Unknown shopper." });
    // The API takes JPEG or PNG only, so uploads use the JPEG copy of the
    // sample photo (the .webp is what the browser displays).
    const photoPath = path.join(ROOT, shopper.photo.replace(/\.webp$/, ".jpg"));
    personBuffer = fs.readFileSync(photoPath);
    personName = path.basename(photoPath);
    personType = "image/jpeg";
  } else {
    return sendJson(res, 400, { message: "Choose a photo or a sample shopper first." });
  }

  try {
    const person = await clothsy.uploadImage(personBuffer, personName, personType);
    // JPEG copy again: the API takes JPEG or PNG only, not webp.
    const garmentPath = path.join(ROOT, garment.image.replace(/\.webp$/, ".jpg"));
    const garmentBuffer = fs.readFileSync(garmentPath);
    const garmentImage = await clothsy.uploadImage(
      garmentBuffer,
      path.basename(garmentPath),
      "image/jpeg"
    );
    const tryon = await clothsy.createTryon({
      personImageId: person.id,
      garmentImageId: garmentImage.id,
      title: garment.title,
      idempotencyKey: requestId,
    });
    statusCache = { at: 0, body: null }; // credits may have changed
    return sendJson(res, 202, { id: tryon.id });
  } catch (err) {
    return sendJson(res, err.status || 502, { message: err.message });
  }
}

async function handleGetTryon(req, res, id) {
  if (!process.env.CLOTHSY_API_KEY) {
    return sendJson(res, 503, { message: clothsy.friendlyMessage("NO_API_KEY") });
  }
  try {
    const tryon = await clothsy.getTryon(id);
    return sendJson(res, 200, {
      status: tryon.status,
      resultUrl: tryon.resultUrl || null,
      message: tryon.message || null,
    });
  } catch (err) {
    return sendJson(res, err.status || 502, { message: err.message });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  // Never serve anything outside the repo root, and never serve the server dir.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT) || filePath.startsWith(path.join(ROOT, "server"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (req.method === "GET" && url === "/api/status") return handleStatus(res);
  if (req.method === "POST" && url === "/api/tryon") return handleCreateTryon(req, res);
  const pollMatch = req.method === "GET" && url.match(/^\/api\/tryon\/([A-Za-z0-9-]+)$/);
  if (pollMatch) return handleGetTryon(req, res, pollMatch[1]);
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(
    `FitRoom listening on http://localhost:${PORT} — ` +
      (process.env.CLOTHSY_API_KEY ? "LIVE mode (Clothsy API key set)" : "DEMO mode (no CLOTHSY_API_KEY)")
  );
});
