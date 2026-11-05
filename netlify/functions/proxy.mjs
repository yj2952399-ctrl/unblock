const ALLOW = ['discord.com', 'discordapp.com', 'api.mail.tm', 'click.discord.com',
               'cdn.discordapp.com', '2captcha.com', 'api.yescaptcha.com'];
const FWD = ['content-type', 'authorization', 'x-super-properties', 'x-discord-locale',
             'x-discord-timezone', 'user-agent', 'proxy-authorization'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const q = event.queryStringParameters || {};
  if (!q.url) return { statusCode: 400, headers: cors, body: 'missing url' };
  if (process.env.PROXY_KEY && q.key !== process.env.PROXY_KEY)
    return { statusCode: 403, headers: cors, body: 'forbidden' };

  const t = new URL(q.url);
  if (!ALLOW.includes(t.hostname)) return { statusCode: 403, headers: cors, body: 'host not allowed' };

  const headers = {};
  for (const k of FWD) if (event.headers[k]) headers[k] = event.headers[k];

  const raw = event.body || '';
  const buf = event.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  const body = ['GET', 'HEAD'].includes(event.httpMethod) || buf.length === 0 ? undefined : buf;

  let dest = q.url;
  const up = event.headers['x-upstream-proxy'];
  if (up) {
    const [h, p, user, pass] = up.split(':');
    dest = `http://${h}:${p}${t.pathname}${t.search}`;
    if (user) headers['proxy-authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  const r = await fetch(dest, { method: event.httpMethod, headers, body });

  const out = { ...cors };
  r.headers.forEach((v, k) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v;
  });

  return {
    statusCode: r.status,
    headers: out,
    body: Buffer.from(await r.arrayBuffer()).toString('base64'),
    isBase64Encoded: true,
  };
};