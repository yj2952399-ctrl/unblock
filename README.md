# Kage Proxy

Netlify Functions ベースの軽量プロキシ。

## デプロイ

1. このフォルダを GitHub に push
2. Netlify → Add new site → Import an existing project → リポジトリ選択
3. Build command は空、Publish directory は `public`
4. Deploy

CLI の場合:

    npm i -g netlify-cli
    netlify login
    netlify init
    netlify deploy --prod

## 制限

- ログインセッション（Cookie）は関数がステートレスなため基本保持されない
- WebSocket / SSE は非対応
- Cloudflare 等の bot 判定が厳しいサイトは 403 になりやすい
- `location.href` を JS で直接書き換える SPA は壊れることがある
- Netlify 無料枠は関数実行 125k 回/月・10 秒タイムアウト