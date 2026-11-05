export const config = { path: "/api/p/*" };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SKIP_HEADERS = new Set([
  "content-encoding", "content-length", "transfer-encoding", "connection",
  "content-security-policy", "content-security-policy-report-only",
  "strict-transport-security", "x-frame-options", "set-cookie",
  "report-to", "nel", "alt-svc", "permissions-policy",
  "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

const b64e = (s) => Buffer.from(s, "utf8").toString("base64url");
const b64d = (s) => Buffer.from(s, "base64url").toString("utf8");

function toProxy(abs) {
  return "/api/p/" + b64e(abs);
}

function proxify(raw, base) {
  if (!raw) return raw;
  const t = raw.trim();
  if (
    !t ||
    t.startsWith("#") ||
    /^(data|blob|javascript|mailto|tel|about):/i.test(t)
  ) return raw;
  let abs;
  try {
    abs = new URL(t, base);
  } catch {
    return raw;
  }
  if (abs.protocol !== "http:" && abs.protocol !== "https:") return raw;
  return toProxy(abs.href);
}

function rewriteHtml(html, base) {
  // CSP メタを除去
  html = html.replace(
    /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
    ""
  );

  // 属性の URL を書き換え
  html = html.replace(
    /\b(href|src|action|formaction|poster|data-src|data-href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (m, attr, _all, dq, sq, uq) => {
      const val = dq ?? sq ?? uq ?? "";
      return `${attr}="${proxify(val, base)}"`;
    }
  );

  // srcset
  html = html.replace(
    /\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (m, _a, dq, sq) => {
      const val = dq ?? sq ?? "";
      const out = val
        .split(",")
        .map((part) => {
          const [u, ...d] = part.trim().split(/\s+/);
          return [proxify(u, base), ...d].join(" ");
        })
        .join(", ");
      return `srcset="${out}"`;
    }
  );

  // インライン style / <style> 内の url()
  html = html.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (m, q, u) => `url("${proxify(u, base)}")`
  );

  // 中身が変わるので integrity / crossorigin を落とす
  html = html.replace(/\s(integrity|crossorigin)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  return html;
}

function rewriteCss(css, base) {
  const abs = (u) => {
    try {
      return new URL(u, base).href;
    } catch {
      return u;
    }
  };
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
      if (/^(data:|blob:|#)/i.test(u)) return m;
      return `url("${abs(u)}")`;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import "${abs(u)}"`);
}

export default async (req) => {
  const url = new URL(req.url);
  const encoded = url.pathname.slice("/api/p/".length);

  if (!encoded) return new Response("Missing target", { status: 400 });

  let target;
  try {
    target = b64d(decodeURIComponent(encoded));
  } catch {
    return new Response("Bad target encoding", { status: 400 });
  }

  let t;
  try {
    t = new URL(target);
  } catch {
    return new Response("Invalid target URL", { status: 400 });
  }
  if (t.protocol !== "http:" && t.protocol !== "https:")
    return new Response("Only http(s) supported", { status: 400 });

  // ブラウザが付けたクエリ（GET フォーム等）をターゲットへ引き継ぐ
  if (url.search) t.search = url.search;

  const headers = new Headers({
    "user-agent": UA,
    accept: req.headers.get("accept") || "*/*",
    "accept-language": "ja,en-US;q=0.9,en;q=0.8",
    referer: t.origin + "/",
  });
  if (req.headers.get("content-type"))
    headers.set("content-type", req.headers.get("content-type"));

  let res;
  try {
    res = await fetch(t.href, {
      method: req.method === "POST" ? "POST" : "GET",
      headers,
      body: req.method === "POST" ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch (e) {
    return new Response(
      `取得に失敗しました: ${e.message}\n${t.href}`,
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  // リダイレクトはプロキシ経由に付け替え
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const next = new URL(loc, t).href;
      return new Response(null, {
        status: 302,
        headers: { location: toProxy(next) },
      });
    }
  }

  const out = new Headers();
  for (const [k, v] of res.headers) {
    if (!SKIP_HEADERS.has(k.toLowerCase())) out.set(k, v);
  }
  out.set("access-control-allow-origin", "*");

  const ct = res.headers.get("content-type") || "application/octet-stream";

  if (res.status === 204 || res.status === 304) {
    return new Response(null, { status: res.status, headers: out });
  }

  if (/text\/html/i.test(ct)) {
    const body = rewriteHtml(await res.text(), t.href);
    out.set("content-type", "text/html; charset=utf-8");
    return new Response(body, { status: res.status, headers: out });
  }

  if (/text\/css/i.test(ct)) {
    out.set("content-type", "text/css; charset=utf-8");
    return new Response(rewriteCss(await res.text(), t.href), {
      status: res.status,
      headers: out,
    });
  }

  return new Response(res.body, { status: res.status, headers: out });
};