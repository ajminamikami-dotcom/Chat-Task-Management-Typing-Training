// e2e09 人間の速度でのプレイ（理不尽さの体感検査）
// 自動スイートは 0〜8ms で打鍵するため、実際の利用者の速度では見えない摩擦がある。
// ここでは「ゆっくりな人」（約40文字/分・本文を読む間・判断の間）を再現して Level 2/3 を遊び、
//  - 進行不能にならない／時計と着信が人間の間を邪魔しない
//  - 0.4秒の二重クリック防止ガードが、人間の普通の操作を飲み込まない
//  - Enter で送信できる（IME確定と区別）
//  - 20件滞留した結果画面でも狭い画面で操作要素に到達できる
//  - どれだけ完了できたかを記録し、難易度の判断材料にする
// 対応要件: CK 課題の作業時間保証 / CL 応答猶予 / L 誤操作からの回復 / AE 到達性 / K 結果の可知性
"use strict";
const { open, sel, start, finish, findAnswer, currentLevel, activeChatBody, scoreText, counters, reporter } = require("./_lib");

const CHAR_MS = 1500;          // 40文字/分 ≒ 1.5秒/文字（かな入力＋変換込みの体感）
const READ_MS_PER_CHAR = 120;  // 本文を読む速度（短縮。実際は250ms程度）
const THINK_MS = 1500;         // 優先度を決める間

async function humanSolve(page, data, R, level) {
  const openItems = page.locator(sel.openChats);
  if (!(await openItems.count())) return false;
  await openItems.first().click(); await page.waitForTimeout(300);
  if (await page.locator(sel.phone).count()) return "phone";
  const body = await activeChatBody(page);
  const a = findAnswer(data, body, level);
  await page.waitForTimeout(Math.min(6000, a.text.length * READ_MS_PER_CHAR));    // 読む
  await page.waitForTimeout(THINK_MS);                                              // 考える
  if (await page.locator(sel.phone).count()) return "phone";
  await page.click(sel.prio(a.prio)); await page.waitForTimeout(900);              // 人間は次の操作まで 1 秒前後空く
  if (a.req) {
    // 一文字ずつゆっくり打つ。途中で着信が来たら中断して戻る
    await page.locator(sel.input).fill("");
    for (const ch of a.reply) {
      if (await page.locator(sel.phone).count()) return "phone";
      await page.keyboard.type(ch); await page.waitForTimeout(CHAR_MS / 4);         // 4倍速（テスト時間の都合）。比率は維持
    }
    await page.waitForTimeout(400);
    if (await page.locator(sel.submit).isDisabled()) { R.ok(`H-${a.sender}`, false, "ゆっくり打っても一致しない: " + a.reply); return true; }
    await page.keyboard.press("Enter");                                             // Enter で送信
    await page.waitForTimeout(250);
  } else {
    await page.click(sel.noReply); await page.waitForTimeout(250);
  }
  return true;
}

(async () => {
  const R = reporter("e2e09_humanpace");
  const { browser, page, errors, data } = await open();

  // ---------- Enter 送信と 0.4秒ガードの人間操作との相性 ----------
  R.section("Enter 送信 / 二重クリック防止ガードが人間の操作を邪魔しないか");
  await start(page, 2, 300);
  await page.locator(sel.chatItems).first().click(); await page.waitForTimeout(300);
  let a = findAnswer(data, await activeChatBody(page), 2);
  await page.click(sel.prio(a.prio)); await page.waitForTimeout(700);              // 人間の間（0.7秒）→ ガード(0.4秒)より後
  const c0 = await counters(page);
  if (a.req) {
    await page.locator(sel.input).fill(a.reply.slice(0, -1)); await page.waitForTimeout(100);
    await page.keyboard.press("Enter"); await page.waitForTimeout(200);
    R.ok("ENTER-1", (await counters(page)).completed === c0.completed, "未一致のまま Enter を押しても送信されない");
    await page.locator(sel.input).fill(a.reply); await page.waitForTimeout(100);
    await page.keyboard.press("Enter"); await page.waitForTimeout(250);
    R.ok("ENTER-2", (await counters(page)).completed === c0.completed + 1, "一致した状態で Enter → 送信される");
  } else {
    await page.click(sel.noReply); await page.waitForTimeout(250);
    R.ok("GUARD-1", (await counters(page)).completed === c0.completed + 1, "優先度→0.7秒後の「返信せずに完了」が通る");
  }
  // 優先度 → 0.7秒 → 選択（人間の最速に近い間隔）が通ることを Level 1 でも確認
  await page.click(sel.finish); await page.click(sel.menu); await start(page, 1);
  await page.locator(sel.chatItems).first().click(); await page.waitForTimeout(300);
  await page.click(sel.prio("high")); await page.waitForTimeout(650);
  const c1 = await counters(page);
  await page.click(sel.option(0)); await page.waitForTimeout(250);
  R.ok("GUARD-2", (await counters(page)).completed === c1.completed + 1, "優先度→0.65秒後の選択肢クリックが通る（ガードは0.4秒）");
  await page.click(sel.finish); await page.click(sel.menu);

  // ---------- 人間の速度で Level 2 → 5分 ----------
  for (const level of [2, 3]) {
    R.section(`Level ${level} を「ゆっくりな人」の速度で 5分プレイ（打鍵 1.5秒/文字 相当・読む間・考える間）`);
    await start(page, level, 300);
    const t0 = Date.now(); let done = 0, phones = 0, phoneOk = 0;
    while (Date.now() - t0 < 320000) {
      if (await page.locator(sel.result).count()) break;
      if (await page.locator(sel.phone).count()) {
        const who = await page.locator("#caller-name").innerText();
        const rec = data.PHONE.find((p) => p.caller === who);
        await page.waitForTimeout(2500);                                              // 人間が相手名を読んで判断する間
        phones++; phoneOk++;
        await page.click(rec.isEmergency ? sel.answer : sel.ignore); await page.waitForTimeout(300);
        continue;
      }
      const r = await humanSolve(page, data, R, level);
      if (r === "phone") continue;
      if (!r) { await page.waitForTimeout(1500); continue; }
      done++;
    }
    const auto = await page.locator(sel.result).count() > 0;
    if (!auto) await finish(page);
    const s = await scoreText(page);
    const reason = await page.locator("#result-subtitle").innerText();
    R.ok(`AF-L${level}`, /時間終了|全件完了/.test(reason), `結果画面に到達（${reason}）`);
    R.ok(`CJ-L${level}`, /優先度 100 %/.test(s) && /返信 100 %/.test(s), "ゆっくりでも正しく操作した分は 100%: " + s);
    R.note(`5分で ${done} 件完了（${s.match(/完了 (\S+)/)[1]}）、着信 ${phones} 回`);
    if (level === 3) R.ok("CL-L3", phones >= 1 && phones <= 7, `着信 ${phones} 回（2.5秒考えてから応答しても、猶予が切れない）`);

    // 結果画面: 20件滞留・狭い画面で操作要素に到達できるか（要件AE）
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const reach = await page.evaluate(() => {
      const ids = ["download-csv-btn", "retry-btn", "menu-btn"];
      return ids.map((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return (top && (el === top || el.contains(top))) ? null : id; }).filter(Boolean);
    });
    const tableScroll = await page.evaluate(() => { const w = document.querySelector("#review-table"); return w ? w.scrollWidth <= w.clientWidth + 2 || getComputedStyle(w).overflowX !== "visible" : true; });
    R.ok(`AE-結果-L${level}`, reach.length === 0 && tableScroll, `390px幅・${(await page.locator("#review-table tbody tr").count())}行の要確認表でも CSV/再挑戦/メニュー が押せ、表は横スクロールで収まる`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click(sel.menu);
  }

  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
