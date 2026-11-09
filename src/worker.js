// Deputy CEO Desk — serves the static shell from ./public and the desk itself
// from KV, so the 06.00 / 12.00 / 18.00 rebuild can update the data without a
// deploy. Cloudflare Access sits in front of the app hostname.
//
// The rebuild writes through a separate, write-only hostname (INGEST_HOST):
// PUT /desk with "Authorization: Bearer <DESK_WRITE_KEY>". That hostname has
// no Access in front of it and answers nothing else, so the key it needs can
// overwrite the desk but never read it.
//
// The "KMDesk systems sync" scheduled task writes the same way to PUT /systems:
// a snapshot of the scheduled tasks and the latest API health check, served
// to the app as /data/systems.json.

const DESK_PATH = "/data/desk.json";
const DESK_KEY = "desk.json";
const INGEST_PATH = "/desk";
const SYSTEMS_PATH = "/data/systems.json";
const SYSTEMS_KEY = "systems.json";
const SYSTEMS_INGEST_PATH = "/systems";
const MAX_BYTES = 5 * 1024 * 1024;
const REQUIRED = ["owe", "owed", "prj", "dec"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (env.INGEST_HOST && url.hostname === env.INGEST_HOST) {
      return ingest(request, env, url);
    }

    if (url.pathname === DESK_PATH) {
      return serveJson(request, env, DESK_KEY, "The desk has not been written yet.");
    }
    if (url.pathname === SYSTEMS_PATH) {
      return serveJson(request, env, SYSTEMS_KEY, "The systems snapshot has not been written yet.");
    }

    return env.ASSETS.fetch(request);
  },
};

async function serveJson(request, env, key, missing) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const { value, metadata } = await env.DESK.getWithMetadata(key, { type: "stream" });
  if (!value) {
    return Response.json({ error: missing }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(request.method === "HEAD" ? null : value, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Private data behind Access: never let a shared cache keep it.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // When it was written, for the app's "Rebuilt ..." line.
      ...(metadata && metadata.written ? { "X-Desk-Written": metadata.written } : {}),
    },
  });
}

async function ingest(request, env, url) {
  const notFound = () => new Response("Not found", { status: 404 });
  if (url.pathname !== INGEST_PATH && url.pathname !== SYSTEMS_INGEST_PATH) return notFound();
  if (request.method !== "PUT") return notFound();
  if (!env.DESK_WRITE_KEY || !(await keyMatches(request.headers.get("Authorization"), env.DESK_WRITE_KEY))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.text();
  if (url.pathname === SYSTEMS_INGEST_PATH) return ingestSystems(body, env);
  if (body.length > MAX_BYTES) return reply(413, "desk.json is over 5 MB");
  let desk;
  try { desk = JSON.parse(body); } catch { return reply(400, "Body is not valid JSON"); }
  const missing = REQUIRED.filter((k) => !Array.isArray(desk && desk[k]));
  if (missing.length) return reply(400, "Missing or non-list keys: " + missing.join(", "));

  const written = new Date().toISOString();
  await env.DESK.put(DESK_KEY, body, { metadata: { written } });
  // Report counts and shape problems only, never content.
  return Response.json({
    ok: true,
    written,
    counts: Object.fromEntries(REQUIRED.map((k) => [k, desk[k].length])),
    warnings: shapeWarnings(desk),
  });
}

// The systems snapshot: {built, tasks: [...], health?: {...}}. Reject anything
// without a tasks list, so a broken run cannot blank the Systems view.
const TASK_FIELDS = ["name", "schedule", "approval", "where", "lastLabel", "bucket"];
const BUCKETS = ["attn", "asks", "ok", "off"];
async function ingestSystems(body, env) {
  if (body.length > MAX_BYTES) return reply(413, "systems.json is over 5 MB");
  let sys;
  try { sys = JSON.parse(body); } catch { return reply(400, "Body is not valid JSON"); }
  if (!sys || !Array.isArray(sys.tasks)) return reply(400, "Missing or non-list key: tasks");
  if (sys.health !== undefined && (typeof sys.health !== "object" || sys.health === null || Array.isArray(sys.health))) {
    return reply(400, "health must be an object when present");
  }

  const written = new Date().toISOString();
  await env.DESK.put(SYSTEMS_KEY, body, { metadata: { written } });

  const warnings = [];
  for (const f of TASK_FIELDS) {
    const n = sys.tasks.filter((t) => !t || t[f] === undefined || t[f] === null || t[f] === "").length;
    if (n) warnings.push(`tasks: ${n} of ${sys.tasks.length} have no "${f}"`);
  }
  const odd = sys.tasks.filter((t) => t && t.bucket && !BUCKETS.includes(t.bucket)).length;
  if (odd) warnings.push(`tasks: ${odd} have a bucket other than ${BUCKETS.join("/")}`);
  if (!sys.built) warnings.push('"built" is missing; the app shows the write time instead');
  if (!sys.health) warnings.push('"health" is missing, so the API health section is empty');

  const counts = { tasks: sys.tasks.length };
  for (const b of BUCKETS) counts[b] = sys.tasks.filter((t) => t && t.bucket === b).length;
  return Response.json({ ok: true, written, counts, warnings });
}

// The app's field names (see public/data/desk.sample.json). Anything missing
// is reported back so the rebuild's run summary shows it.
const FIELDS = {
  owe: ["key", "who", "age", "hot", "sub", "links"],
  owed: ["key", "who", "age", "hot", "sub", "links"],
  prj: ["key", "name", "owner", "when", "next", "log", "links"],
  dec: ["key", "date", "what", "why", "links"],
};
function shapeWarnings(desk) {
  const out = [];
  for (const [list, fields] of Object.entries(FIELDS)) {
    for (const f of fields) {
      const n = desk[list].filter((r) => !r || r[f] === undefined || r[f] === null || r[f] === "").length;
      if (n) out.push(`${list}: ${n} of ${desk[list].length} items have no "${f}"`);
    }
  }
  for (const k of ["mkt", "ecom"]) if (!desk[k]) out.push(`"${k}" is missing, so the Numbers tab is empty`);
  if (!desk.built) out.push('"built" is missing; the app shows the write time instead');
  return out;
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
