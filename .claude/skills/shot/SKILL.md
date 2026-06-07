---
name: shot
description: UI変更をPlaywrightで実機検証してスクショを提示する。UI/CSS/レイアウト/レスポンシブの変更時、または「スクショ」「実機で見て」「shot」と言われた時に使う。next start(本番ビルド)＋_shot_*.mjs で撮影し、.screenshots の画像を Read で確認する。口頭説明だけにしない（プロジェクト方針）。
---

# shot — Playwright 実機検証

このプロジェクトの方針: **UI変更は口頭説明で済ませず、Playwrightスクショで実機検証して画像を示す**（[[feedback-visual-verification]]）。

ポイント:
- 検証は **`next start`（本番ビルド）** に対して行う。`next dev`(Turbopack) は OneDrive 配下で Ready 直後に落ちやすく不安定。
- スクショスクリプトは `v2/scripts/_shot_*.mjs`（**untracked運用・コミットしない**）。既存の `_shot_home.mjs`/`_shot_legal.mjs` 等が雛形。
- node 実行は **`dangerouslyDisableSandbox: true`**（外部接続=ローカルサーバへの接続がサンドボックスで拒否されるため）。
- 出力は `.screenshots/*.png` → **Read ツールで画像を開いて目視確認**し、ユーザーに示す。
- 本番に対して撮るなら `BASE=https://ai-tech-researcher.vercel.app` を渡す（ローカル不要）。

## 手順

1. **ビルド**（変更を反映。`.next` EPERM が出たら PowerShell で消す＝[[ship]] と同じ）
   ```
   cd v2
   npx kill-port 3000
   powershell.exe -NoProfile -Command "Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue"
   npx next build
   ```

2. **本番サーバを起動＋Ready待ち**（前景sleepは不可なので curl ポーリング）
   ```
   (npx next start -p 3000 > .next/_start.log 2>&1 &)
   for i in $(seq 1 12); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null); [ "$code" = "200" ] && { echo READY; break; }; sleep 2; done
   ```
   ※この起動＋ポーリングや node 実行は `dangerouslyDisableSandbox: true` で。

3. **撮影スクリプトを書いて実行**（`v2/scripts/_shot_<name>.mjs`）。要点:
   - `import { chromium } from 'playwright'`。`BASE = process.env.BASE ?? 'http://localhost:3000'`。
   - **デスクトップ**: `newContext({ viewport: { width: 1100, height: 950 } })`。
   - **モバイル検証**: `newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })`。
   - `page.goto(BASE+path, { waitUntil: 'networkidle', timeout: 90000 })` → `waitForTimeout` で安定待ち → `page.screenshot({ path: '.screenshots/x.png', fullPage: true })`。
   - 遷移/タップ検証は `click({ noWaitAfter: true })` 直後に短い待機でスケルトン等を捉える。`page.on('console'/'requestfailed'/'pageerror')` でエラーも拾える。
   - 期待値はコードで数える（例: `await page.locator('a[href^="/articles/"]').count()`）＝口頭でなく数値で確認。
   ```
   BASE=http://localhost:3000 node scripts/_shot_<name>.mjs
   ```

4. **画像を確認**: `Read .screenshots/<name>.png` で目視 → ユーザーに示す＋所見。

5. **後片付け**: `npx kill-port 3000`。

## 地雷（[[reference-dev-env]]）
- `rm -rf .next` は拒否される → PowerShell `Remove-Item -Recurse -Force .next`。
- WSL は日本語パス（ドキュメント）を `wsl.exe bash -lc` 越しに渡すと文字化けする。スクショは Git Bash + node（Windows側）で動かす。
- ポート専有のゾンビ dev が残ると次が起動できない → `npx kill-port 3000`。
