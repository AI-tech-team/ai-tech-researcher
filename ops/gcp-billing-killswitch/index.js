// 予算アラート(Pub/Sub)を受け取り、しきい値を超えたらプロジェクトの請求を無効化する。
// 公式パターン: https://cloud.google.com/billing/docs/how-to/notify
//
// ⚠️ 発動するとプロジェクト全体の請求がOFFになる＝Gemini APIが止まり、
//    日次パイプライン(GitHub Actions→Gemini)も失敗するようになる。復旧は手動で請求を再リンク。
//    予算データには数時間のラグがあるため「ピッタリ即時」ではない（瞬間の暴走止めは別途APIクォータで）。
const functions = require('@google-cloud/functions-framework');
const { CloudBillingClient } = require('@google-cloud/billing');

const billing = new CloudBillingClient();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const PROJECT_NAME = `projects/${PROJECT_ID}`;

// Pub/Sub(gen2 CloudEvent)経由で発火。entry-point は 'stopBilling'。
functions.cloudEvent('stopBilling', async (cloudEvent) => {
  const b64 = cloudEvent?.data?.message?.data;
  const payload = b64 ? JSON.parse(Buffer.from(b64, 'base64').toString()) : {};
  const cost = Number(payload.costAmount ?? 0);
  const budget = Number(payload.budgetAmount ?? 0);
  console.log(`受信: budget=${budget} cost=${cost} (${payload.budgetDisplayName ?? ''})`);

  if (cost <= budget) {
    console.log('しきい値未満。何もしない。');
    return;
  }
  if (!PROJECT_ID) {
    console.error('GOOGLE_CLOUD_PROJECT 未設定。中止。');
    return;
  }
  if (!(await isBillingEnabled(PROJECT_NAME))) {
    console.log('既に請求停止済み。');
    return;
  }
  await disableBilling(PROJECT_NAME);
  console.log('⚠️ 請求を無効化しました（プロジェクトのGemini等が停止）。復旧は手動で請求を再リンク。');
});

async function isBillingEnabled(name) {
  try {
    const [info] = await billing.getProjectBillingInfo({ name });
    return info.billingEnabled;
  } catch (e) {
    // 取れない時は安全側（有効とみなして停止処理に進む）
    console.warn('billing状態の取得失敗。有効と仮定:', e.message);
    return true;
  }
}

async function disableBilling(name) {
  // billingAccountName を空にする＝請求アカウントの紐付け解除＝無効化
  const [res] = await billing.updateProjectBillingInfo({
    name,
    projectBillingInfo: { billingAccountName: '' },
  });
  return res;
}
