export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (u.searchParams.get("k") !== "ここに合言葉") {
      return new Response("forbidden", { status: 403 });
    }
    const target = u.searchParams.get("url");
    if (!target) return new Response("no url", { status: 400 });

    const h = new Headers(req.headers);
    for (const k of [
      "host", "cf-connecting-ip", "cf-ipcountry", "x-forwarded-for",
      "x-real-ip", "cdn-loop", "cf-ray", "cf-visitor",
    ]) h.delete(k);

    const r = await fetch(target, {
      method: req.method,
      headers: h,
      body: req.method === "POST" ? req.body : undefined,
      redirect: "manual",
    });

    return new Response(r.body, { status: r.status, headers: r.headers });
  },
};