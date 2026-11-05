export const config = {
  path: "/api/*",
  region: "ap-northeast-1",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const EGRESS = process.env.EGRESS_URL || "";
const EGRESS_SECRET = process.env.EGRESS_SECRET || "";

// オリジンに渡さないヘッダ（身元が漏れるもの）
const STRIP_REQ = new Set([
  "host", "connection", "content-length", "accept-encoding",
  "x-forwarded-for", "x-real-ip", "x-nf-client-connection-ip",
  "cf-connecting-ip", "cf-ipcountry", "cdn-loop", "forwarded",
  "via", "cookie", "x-request-id", "true-client-ip",
]);

const STRIP_RES = new Set([
  "content-encoding", "content-length", "transfer-encoding", "connection",
  "content-security-policy", "content-security-policy-report-only",
  "strict-transport-security", "x-frame-options", "set-cookie",
  "report-to", "nel", "alt-svc", "permissions-policy",
  "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy", "cache-control", "expires",
]);

// ダミー送信元 IP プール（オリジン側の地域判定・レート制限を撹乱）
const FAKE_XFF = [
  "203.0.113.24", "198.51.100.77", "192.0.2.145",
  "203.0.113.201", "198.51.100.13",
];

const b64e = (s) => Buffer.from(s, "utf8").toString("base64url");
const b64d = (s) => Buffer.from(s, "base64url").toString("utf8");

const isHttp = (u) => u.protocol === "http:" || u.protocol === "https:";

function buildProxy(abs, mode) {
  return `/api/${mode}/${b64e(abs)}`;
}

function proxify(raw, base, mode) {
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
  if (!isHttp(abs)) return raw;
  return buildProxy(abs.href, mode);
}

const ATTR_RE =
  /\b(href|src|action|formaction|poster|data-src|data-href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

const SRCSET_RE = /\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi;

const URLFUNC_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

const HEAD_EXTRAS = (base) =>
  `<meta name="referrer" content="no-referrer">` +
  `<link rel="preconnect" href="${base}" crossorigin>`;

const LITE_CSS =
  `<style>img,video{max-width:100%;height:auto}` +
  `*{scroll-behavior:auto!important}` +
  `[style*="animation"]{animation-duration:0s!important}</style>`;

const TEXT_CSS =
  `<style>body{max-width:44rem;margin:2rem auto;padding:0 1rem;` +
  `font:17px/1.75 system-ui,sans-serif;background:#0d0f12;color:#e6e9ef}` +
  `a{color:#5b9dff}img,video,svg,iframe{display:none!important}` +
  `pre{overflow:auto;background:#16191f;padding:1rem;border-radius:8px}</style>`;

function rewriteChunk(chunk, base, mode) {
  let html = chunk;

  if (mode !== "p") {
    html = html.replace(
      /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
      ""
    );
  }

  html = html.replace(ATTR_RE, (m, attr, _a, dq, sq, uq) => {
    const val = dq ?? sq ?? uq ?? "";
    if (mode === "l" && (attr === "src" || attr === "poster")) {
      // 軽量モード: 画像は直接読む（関数を1ホップ減らす）
      try {
        return `${attr}="${new URL(val, base).href}"`;
      } catch {
        return m;
      }
    }
    return `${attr}="${proxify(val, base, mode)}"`;
  });

  html = html.replace(SRCSET_RE, (m, _a, dq, sq) => {
    if (mode === "t") return "";
    const val = dq ?? sq ?? "";
    const out = val
      .split(",")
      .map((part) => {
        const [u, ...d] = part.trim().split(/\s+/);
        if (mode === "l") {
          try {
            return [new URL(u, base).href, ...d].join(" ");
          } catch {
            return part;
          }
        }
        return [proxify(u, base, mode), ...d].join(" ");
      })
      .join(", ");
    return `srcset="${out}"`;
  });

  if (mode === "p") {
    html = html.replace(URLFUNC_RE, (m, q, u) => `url("${proxify(u, base, mode)}")`);
  }

  if (mode === "l") {
    html = html.replace(/<img\b/gi, '<img loading="lazy" decoding="async" ');
  }

  html = html.replace(/\s(integrity|crossorigin)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  if (mode === "t") {
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "");
  }

  return html;
}

function htmlStream(base, mode) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  let injected = false;

  const emit = (ctrl, text) => {
    let out = text;
    if (!injected && /<head\b[^>]*>/i.test(out)) {
      const extra = HEAD_EXTRAS(base) + (mode === "l" ? LITE_CSS : mode === "t" ? TEXT_CSS : "");
      out = out.replace(/<head\b[^>]*>/i, (m) => m + extra);
      injected = true;
    }
    ctrl.enqueue(enc.encode(rewriteChunk(out, base, mode)));
  };

  return new TransformStream({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      let cut = buf.lastIndexOf("<");
      if (cut < 0) cut = buf.lastIndexOf(" ");
      if (cut <= 0) {
        if (buf.length < 65536) return;
        cut = buf.length;
      }
      const head = buf.slice(0, cut);
      buf = buf.slice(cut);
      emit(ctrl, head);
    },
    flush(ctrl) {
      if (buf) emit(ctrl, buf);
    },
  });
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
    .replace(URLFUNC_RE, (m, q, u) =>
      /^(data:|blob:|#)/i.test(u) ? m : `url("${abs(u)}")`
    )
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import "${abs(u)}"`);
}

async function upstream(url, init) {
  if (!EGRESS) return fetch(url, init);

  // Cloudflare Worker 経由（オリジンから見える IP をさらに遠ざける）
  const hop = new URL(EGRESS);
  hop.searchParams.set("url", url);
  if (EGRESS_SECRET) hop.searchParams.set("k", EGRESS_SECRET);
  return fetch(hop.href, init);
}

export default async (req) => {
  const url = new URL(req.url);
  const [, , mode, ...rest] = url.pathname.split("/");
  const encoded = rest.join("/");

  if (!["p", "l", "t"].includes(mode) || !encoded) {
    return new Response("Bad route", { status: 400 });
  }

  let target;
  try {
    target = b64d(decodeURIComponent(encoded));
  } catch {
    return new Response("Bad encoding", { status: 400 });
  }

  let t;
  try {
    t = new URL(target);
  } catch {
    return new Response("Invalid target", { status: 400 });
  }
  if (!isHttp(t)) return new Response("Only http(s)", { status: 400 });

  // ブラウザが付けたクエリ（検索フォーム等）を引き継ぐ
  if (url.search) t.search = url.search;

  const headers = new Headers();
  headers.set("user-agent", UA);
  headers.set("accept", req.headers.get("accept") || "*/*");
  headers.set("accept-language", "ja,en-US;q=0.9,en;q=0.8");
  headers.set("referer", t.origin + "/");
  headers.set("x-forwarded-for", FAKE_XFF[(Math.random() * FAKE_XFF.length) | 0]);
  headers.set("x-real-ip", headers.get("x-forwarded-for"));
  headers.set("dnt", "1");

  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const method = req.method === "POST" ? "POST" : "GET";
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), 9000);

  let res;
  try {
    res = await upstream(t.href, {
      method,
      headers,
      body: method === "POST" ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(kill);
    return new Response(`取得失敗: ${e.message}\n${t.href}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  clearTimeout(kill);

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      return new Response(null, {
        status: 302,
        headers: { location: buildProxy(new URL(loc, t).href, mode) },
      });
    }
  }

  const out = new Headers();
  for (const [k, v] of res.headers) {
    if (!STRIP_RES.has(k.toLowerCase())) out.set(k, v);
  }
  out.set("access-control-allow-origin", "*");
  out.set("referrer-policy", "no-referrer");

  const ctype = res.headers.get("content-type") || "application/octet-stream";

  if (res.status === 204 || res.status === 304) {
    out.set("cache-control", "no-cache");
    return new Response(null, { status: res.status, headers: out });
  }

  if (/text\/html/i.test(ctype)) {
    out.set("content-type", "text/html; charset=utf-8");
    out.set("cache-control", "no-cache");
    out.set(
      "netlify-cdn-cache-control",
      "public, max-age=0, s-maxage=60, stale-while-revalidate=600"
    );
    return new Response(res.body.pipeThrough(htmlStream(t.href, mode)), {
      status: res.status,
      headers: out,
    });
  }

  if (/text\/css/i.test(ctype)) {
    out.set("content-type", "text/css; charset=utf-8");
    out.set("cache-control", "public, max-age=86400");
    out.set(
      "netlify-cdn-cache-control",
      "public, max-age=604800, stale-while-revalidate=86400"
    );
    return new Response(rewriteCss(await res.text(), t.href), {
      status: res.status,
      headers: out,
    });
  }

  // 画像・フォント・動画はエッジで長期キャッシュ（2回目以降は関数を叩かない）
  const isStatic = /^(image|font|video|audio)\//i.test(ctype) ||
    /\/(woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)$/i.test(t.pathname);

  out.set(
    "cache-control",
    isStatic ? "public, max-age=604800" : "public, max-age=86400"
  );
  out.set(
    "netlify-cdn-cache-control",
    isStatic
      ? "public, max-age=2592000, stale-while-revalidate=604800"
      : "public, max-age=604800, stale-while-revalidate=86400"
  );

  return new Response(res.body, { status: res.status, headers: out });
};