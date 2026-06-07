---
name: ship
description: 変更を安全に本番へ出して検証する儀式。ユーザーがコミット/プッシュを承認した時、または「デプロイして」「出して」「ship」と言われた時に使う。ローカルビルド(.next EPERM対処込み)→コミット→push(=Vercel自動デプロイ)→反映待ち→本番で実機確認、までを取りこぼさず回す。
---

# ship — 安全デプロイ＆本番検証

このプロジェクトは **deploy = `git push origin main`（Vercel が自動デプロイ・本番DB直結）**。pushした瞬間に本番へ出る。だから「ビルドが通る」「本番で実際に直っている」までを必ず確認する。

前提ルール:
- **コミット/プッシュはユーザーが頼んだ時だけ**。risky な差分は先に [[precheck]] を回す。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 検証スクリプト（`scripts/_*.mjs` `_*.ts`）は**コミットしない**（untracked運用）。`.gitignore`/`package-lock` 等、自分が変えていないものは add しない。

## 手順

1. **ローカルビルドで先に落とす**（Vercel = `next build`＋TSチェック。手元で通してから出す）
   ```
   cd v2 && npx next build
   ```
   - **`.next` の EPERM(`operation not permitted, unlink ...static/...`) が出たら**＝OneDrive×Turbopack のロック。`rm -rf .next` は**Permission deniedで拒否される**ので PowerShell で消す：
     ```
     npx kill-port 3000
     powershell.exe -NoProfile -Command "Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue"
     npx next build
     ```
   - **本番だけ落ちる罠**: 手元の `tsc`/`build` が通るのに Vercel だけ型エラー → 未コミットの `schema.ts` 等を `git status` で確認（部分コミットで schema と利用側がズレている）。[[reference-dev-env]]

2. **コミット**（ユーザー承認済みの単位で。意味のある粒度に分ける）
   ```
   git add <自分が変えたファイルだけ> && git commit -F - <<'EOF'
   <type(scope): 要約>

   <本文: 何を・なぜ>

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   EOF
   ```
   LF→CRLF 警告は無害。

3. **push**（= 本番デプロイ開始）
   ```
   git push origin main
   ```

4. **デプロイ反映を待つ（~1〜2分）**。確実なマーカーが無ければ、変更が表れる短い `WAIT` で本番をポーリングして「旧版→新版」の切替を検知する（例: 直すバグの症状が消える瞬間を loop で捉える）。`sleep` は短い間隔のループで（長い前景sleepは不可）。

5. **本番で実機確認**（口頭で済ませない）
   - 静的/テキスト: `WebFetch https://ai-tech-researcher.vercel.app/<path>` で内容を確認。
   - 挙動/UI: [[shot]] で本番に対し Playwright 検証（`BASE=https://ai-tech-researcher.vercel.app`）。
   - セキュリティ修正は特に「本当に塞がったか」を本番で叩いて確認（例: `/reports/67` が 404 になったか）。

6. **結果を正直に報告**。直ったら本番で確認できた事実を、ダメなら出力付きで。

## よくある地雷（[[reference-dev-env]]）
- OneDrive 配下のため `.next` ロック頻発 → PowerShell Remove-Item。
- `next start`（本番）は OneDrive でも比較的安定。`next dev`(Turbopack) は Ready 直後に落ちやすい。
- Turso はローカルから一時的に ConnectTimeout になることがあるが本番(Vercel同リージョン)は正常 → 本番の生死は公開ページを叩いて判断。
