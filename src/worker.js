// Deputy CEO Desk — serves the static shell from ./public and the desk itself
// from KV, so the 06.00 / 12.00 / 18.00 rebuild can update the data without a
// deploy. Cloudflare Access sits in front of all of it.

const DESK_PATH = "/data/desk.json";
const DESK_KEY = "desk.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === DESK_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const desk = await env.DESK.get(DESK_KEY, { type: "stream" });
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
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
