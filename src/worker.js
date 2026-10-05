// Deputy CEO Desk — serves the static shell from ./public and the desk itself
// from KV, so the 06.00 / 12.00 / 18.00 rebuild can update the data without a
// deploy. Cloudflare Access sits in front of the app hostname.
//
// The rebuild writes through a separate, write-only hostname (INGEST_HOST):
// PUT /desk with "Authorization: Bearer <DESK_WRITE_KEY>". That hostname has
// no Access in front of it and answers nothing else, so the key it needs can
// overwrite the desk but never read it.

const DESK_PATH = "/data/desk.json";
const DESK_KEY = "desk.json";
const INGEST_PATH = "/desk";
const MAX_BYTES = 5 * 1024 * 1024;
const REQUIRED = ["owe", "owed", "prj", "dec"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (env.INGEST_HOST && url.hostname === env.INGEST_HOST) {
      return ingest(request, env, url);
    }

    if (url.pathname === DESK_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const { value: desk, metadata } = await env.DESK.getWithMetadata(DESK_KEY, { type: "stream" });
      if (!desk) {
        return Response.json({ error: "The desk has not been written yet." }, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return new Response(request.method === "HEAD" ? null : desk, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          // Private data behind Access: never let a shared cache keep it.
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          // When the desk was written, for the app's "Rebuilt ..." line.
          ...(metadata && metadata.written ? { "X-Desk-Written": metadata.written } : {}),
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

async function ingest(request, env, url) {
  const notFound = () => new Response("Not found", { status: 404 });
  if (url.pathname !== INGEST_PATH) return notFound();
  if (request.method !== "PUT") return notFound();
  if (!env.DESK_WRITE_KEY || !(await keyMatches(request.headers.get("Authorization"), env.DESK_WRITE_KEY))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.text();
  if (body.length > MAX_BYTES) return reply(413, "desk.json is over 5 MB");
  let desk;
  try { desk = JSON.parse(body); } catch { return reply(400, "Body is not valid JSON"); }
  const missing = REQUIRED.filter((k) => !Array.isArray(desk && desk[k]));
  if (missing.length) return reply(400, "Missing or non-list keys: " + missing.join(", "));

  const written = new Date().toISOString();
  await env.DESK.put(DESK_KEY, body, { metadata: { written } });
  // Report counts only, never content.
  return Response.json({
    ok: true,
    written,
    counts: Object.fromEntries(REQUIRED.map((k) => [k, desk[k].length])),
  });
}

function reply(status, error) {
  return Response.json({ ok: false, error }, { status });
}

// Constant-time comparison of "Bearer <key>" against the stored key.
async function keyMatches(header, key) {
  const given = (header || "").replace(/^Bearer\s+/i, "");
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(key)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
