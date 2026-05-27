// 稼働中のアプリ(dev/prod)をPlaywrightで開き、画面のスクショを .screenshots/ に保存する。
// 用途: UI変更の実機確認・「画面を見せて」用。
// 使い方: dev server起動後に  node scripts/screenshot.mjs   （BASEは環境変数で上書き可）
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = '.screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

// デスクトップ: トップ＋（あれば）オンボーディングツアー各ステップ
const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

const tourVisible = await page.getByText('使い方').first().isVisible().catch(() => false);
if (tourVisible) {
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: `${OUT}/step${i}.png` });
    const last = i === 5;
    const btn = page.getByRole('button', { name: last ? 'ログインせずに始める' : '次へ' });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(900); } else break;
  }
}
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/desktop.png` });

// モバイル
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const mp = await mobile.newPage();
await mp.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await mp.waitForTimeout(2500);
await mp.screenshot({ path: `${OUT}/mobile.png` });

await browser.close();
console.log(`saved screenshots to ${OUT}/`);
