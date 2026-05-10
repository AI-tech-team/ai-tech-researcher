# Skill: ソースの自動進化 (evolve-sources)

## 目的
`adoption_logs` の実績に基づき、各情報ソース（キーワード等）のスコアを更新し、昇格（candidate -> active）や降格（active -> low-priority -> stopped）を自動で行う。

## 手順
1. **実績の集計**:
   - `adoption_logs` から過去7日間のデータを集計する。
   - ソースごとに「採用数」と「ヒット数」を算出する。

2. **スコアの更新**:
   - 以下のロジックでスコアを計算し、`sources` テーブルの `score` を更新する。
     - 採用1回につき +10点
     - ヒット（収集）したが不採用1回につき -2点
     - ヒットすらしなかった場合 -1点

3. **ステータスの変更**:
   - **昇格**: `status = 'candidate'` かつ `score >= 30` の場合、`status = 'active'` に変更する。
   - **降格**: `status = 'active'` かつ `score < 0` の場合、`status = 'low-priority'` に変更する。
   - **停止**: `status = 'low-priority'` かつ `score < -20` の場合、`status = 'stopped'` に変更する。

4. **新規候補の発見 (オプション)**:
   - 収集された記事の内容から、頻出する新しいキーワードをLLMに抽出させ、`status = 'candidate'` として `sources` テーブルに追加する。

5. **完了報告**:
   - ステータスが変更されたソースの一覧を報告して終了する。
