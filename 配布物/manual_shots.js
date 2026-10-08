// 実施マニュアル用のスクリーンショットを現行の本体から撮り直す（1366 幅）
const { open, sel, start, solveOne, finish, dismissPhone } = require('/home/user/Chat-Task-Management-Typing-Training/dev-tests/_lib');
const OUT = process.argv[2];
(async () => {
  const { browser, page, data } = await open({ viewport: { width: 1366, height: 768 } });
  // Level 1: 最初のチャットを開いた状態（優先度パネル）
  await start(page, 1, 300);
  await page.locator(sel.openChats).first().click(); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/image3.png' });
  await finish(page); await page.click(sel.menu); await page.waitForTimeout(300);
  // Level 2: チャットを開いて優先度を選び、入力パネルが出た状態
  await start(page, 2, 300);
  await page.waitForTimeout(800);
  await page.locator(sel.openChats).first().click(); await page.waitForTimeout(300);
  await page.click(sel.prio('mid')); await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/image1.png' });
  await finish(page); await page.click(sel.menu); await page.waitForTimeout(300);
  // 結果画面: Level 1 を数件処理してから終了
  await start(page, 1, 300);
  for (let i = 0; i < 5; i++) { try { await solveOne(page, data, i === 3 ? 'wrong' : 'ideal'); } catch (e) { break; } await page.waitForTimeout(150); }
  await finish(page); await page.waitForTimeout(500);
  await page.setViewportSize({ width: 1366, height: 909 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/image2.png' });
  await browser.close(); console.log('shots done');
})().catch((e) => { console.error(e); process.exit(1); });
