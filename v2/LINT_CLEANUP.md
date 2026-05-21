# ESLint クリーンアップ（✅ 解決済み 2026-05-21）

> **対応済み**: `npm run lint` は 0 件（exit 0）。採用した方針:
> - `@typescript-eslint/no-explicit-any` を設定で off（catch節・JSON解析・AI SDKメタデータ等の意図的な多用のため）
> - `react/jsx-key`（navItems等16件）と未使用import/変数はコードで修正
> - `react-hooks/set-state-in-effect`（localStorage初期化・ページリセットの正当なパターン2件）は行単位でdisable
> - 一回限りのデータ投入/移行スクリプトは globalIgnores に追加
>
> 以下は当時の分析記録（参考）。

## 内訳（計127件）

| ルール | 件数 | 内容 |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 100 | 主に `catch (e: any)`、JSON解析の `any[]`、AI SDKの `providerMetadata as any` 等 |
| `react/jsx-key` | 16 | navItems等の静的JSX配列に key 未付与（.map側には key あり、実害は小） |
| `@typescript-eslint/no-unused-vars` | 11 | 未使用のimport・変数（一部はwarning） |

## 対象ファイル（24）

- ルートスクリプト: `daily_pipeline.ts`(最多), `insert_300_seeds.ts`, `insert_precise_seeds.ts`, `migrate_data.ts`, `refresh_all.ts`, `test_models.ts`, `scripts/migrate_v3.ts`, `scripts/migrate_v4.ts`
- API: `src/app/api/{chat,collect,evolve,recategorize,report,report/weekly,report/monthly}/route.ts`
- 画面: `src/app/page.tsx`, `src/app/actions.ts`, `src/components/{ChatPanel,MobileChatModal}.tsx`, `src/components/tabs/{DataTab,OverviewTab,PerformanceTab,SettingsTab,SourcesTab}.tsx`

## 対応方針の候補

### A. 設定緩和＋実害分のみ修正（推奨・低リスク）
- `eslint` 設定で `@typescript-eslint/no-explicit-any` を `off`（または `warn`）に
- `react/jsx-key` と未使用importは**コードで修正**（実害があるため残す価値あり）
- 本番稼働中の `daily_pipeline.ts` のロジックに大きく触れずに `npm run lint` をクリーンにできる

### B. 全127件をコードで厳密修正（高品質・要検証）
- `any` を具体型/`unknown`+型ガードに置換。`catch (e: any)` は `catch (e)` + `e instanceof Error ? e.message : String(e)` に
- 型安全性は最大化されるが、GitHub Actionsで毎日動く `daily_pipeline.ts` 含む24ファイルに広範な変更 → 動作検証必須

### C. ビルド時lintだけ明示無効化
- `next.config.ts` に `eslint: { ignoreDuringBuilds: true }` を明記（現状もビルドは通るが意図を明示）
- コードは触らず、将来のビルドでlintに引っかからないことを保証

## メモ
- 既存の `catch (e: any)` パターンが多数。Bで進めるなら共通ヘルパー `errMsg(e: unknown)` を1つ作ると差分を抑えられる。
- `jsx-key` は `page.tsx` の `navItems`/`mobileNavItems` 配列が主因。
