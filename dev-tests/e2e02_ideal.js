// e2e02 理想プレイの構成的シミュレーション
// 完璧なプレイヤーを構成し、全レベルで最高評価（優先度100%・返信100%・電話100%・全件完了）に到達できることを実証する。
// 対応要件: CJ 最高評価の到達可能性 / CO 是正行動後の免責 / H 検証の対称性 / AF 進行不能状態の不存在
"use strict";
const { open, sel, start, finish, solveOne, handlePhoneIfAny, scoreText, reporter } = require("./_lib");

(async () => {
  const R = reporter("e2e02_ideal");
  const { browser, page, errors, data } = await open();

  for (const level of [1, 2, 3]) {
    R.section(`Level ${level} 理想プレイ`);
    await start(page, level, 300);
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 330000) {
      if (await page.locator(sel.result).count()) break;
      if (await handlePhoneIfAny(page, data, "ideal")) continue;
      let did;
      try { did = await solveOne(page, data, "ideal", 0); } catch (e) { R.ok(`H-L${level}`, false, e.message); break; }
      if (did) n++; else { if (level === 1) break; await page.waitForTimeout(700); }
    }
    const auto = (await page.locator(sel.result).count()) > 0;
    if (!auto) await finish(page);
    const s = await scoreText(page);
    const reason = await page.locator("#result-subtitle").innerText();
    R.ok(`AF-L${level}`, auto && /全件完了/.test(reason), `全件処理で自動終了: ${reason}`);
    R.ok(`CJ-L${level}`, /優先度 100 %/.test(s) && /返信 100 %/.test(s), `優先度・返信とも100%: ${s}`);
    if (level === 3) R.ok("CJ-電話", /電話判断 (100 %|-)/.test(s), "電話判断も100%（または着信なし）");
    const ins = await page.locator(sel.insight).innerText();
    R.ok(`CO-L${level}`, ins.includes("よかった点") && !/未完了タスクを減らす/.test(ins), "完璧なプレイに「次の練習」で未完了を指摘しない");
    R.ok(`AZ-L${level}`, (await page.locator(sel.review).innerText()).includes("要確認タスクはありません"), "要確認タスクが空の案内");
    R.note(`${n} 件処理 / ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    await page.click(sel.menu);
  }

  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
