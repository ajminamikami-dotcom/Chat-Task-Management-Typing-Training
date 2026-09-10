// e2e04 ゲームQA手法10種
// ポーズ連打 / スピードラン / 最大負荷 / ヒットボックス（モーダル貫通） / 境界値 / シーケンスブレイク /
// 乱数の統計検定 / 文字列走査 / CPUスロットリング / ソーク（時計ドリフト・短縮版）
// 対応要件: V 一時停止の完全性 / AK 時計の単調性 / P ペーシング上限 / AD フォーカス捕捉 / C 再入安全性 / AB 文言の完全性 / S 終業後の不変性
"use strict";
const { open, sel, start, solveOne, finish, counters, reporter, scoreText } = require("./_lib");

const secs = (t) => { const [m, s] = t.split(":").map(Number); return m * 60 + s; };

(async () => {
  const R = reporter("e2e04_gameqa");
  const { browser, page, errors, data, context } = await open();

  // ---------- 1. ポーズ連打 ----------
  R.section("1 ポーズ連打（一時停止/再開を高速に50往復）");
  await start(page, 2, 300);
  const t0 = secs(await page.locator(sel.timer).innerText());
  for (let i = 0; i < 50; i++) { await page.click(sel.pause); await page.click(sel.resume); }
  await page.waitForTimeout(300);
  R.ok("V-1", !(await page.locator("#pause-overlay.show").count()), "50往復後に停止画面が残っていない");
  await page.waitForTimeout(3000);
  const t1 = secs(await page.locator(sel.timer).innerText());
  R.ok("V-2", t0 - t1 >= 2 && t0 - t1 <= 6, `連打後もタイマーは1本だけ進む (${t0}→${t1}, 3秒待機)`);
  const before = await page.locator(sel.chatItems).count();
  await page.waitForTimeout(2500);
  const after = await page.locator(sel.chatItems).count();
  R.ok("V-3", after - before <= 2, `連打で新着タイマーが多重化していない (2.5秒で +${after - before} 件)`);
  for (let i = 0; i < 30; i++) await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  R.ok("V-4", !(await page.locator("#pause-overlay.show").count()), "Esc を偶数回連打しても停止画面が残らない");

  // ---------- 2. スピードラン ----------
  R.section("2 スピードラン（待ち時間ゼロで全件処理）");
  await page.click(sel.finish); await page.click(sel.menu);
  await start(page, 1);
  const s0 = Date.now();
  while (await solveOne(page, data, "ideal", 0)) { /* 最速（Level 1 は着信なし） */ }
  await page.waitForSelector(sel.result, { timeout: 5000 });
  R.ok("SR-1", true, `Level1 を ${((Date.now() - s0) / 1000).toFixed(1)} 秒で完走、自動終了`);
  const sc = await scoreText(page);
  R.ok("SR-2", /完了 11\/11/.test(sc) && /優先度 100 %/.test(sc), "最速でも全件が正しく計上: " + sc);

  // ---------- 3. 最大負荷 ----------
  R.section("3 最大負荷（何も処理せず全20件+電話を溜める）");
  await page.click(sel.menu); await start(page, 3, 300);
  const t3 = Date.now();
  let phones = 0;
  while (Date.now() - t3 < 240000 && (await page.locator(sel.chatItems).count()) < 20) {
    if (await page.locator(sel.phone).count()) { phones++; await page.click(sel.ignore); }
    await page.waitForTimeout(1000);
  }
  const c = await counters(page);
  R.ok("P-1", c.listed === 20 && c.unread === 20, `20件すべて未処理で滞留 ${JSON.stringify(c)}`);
  R.ok("P-2", phones <= 6, `4分間の着信 ${phones} 回（上限保証）`);
  const clickable = await page.evaluate(() => {
    const items = [...document.querySelectorAll("#chat-list .chat-item")];
    return items.filter((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return top && el.contains(top); }).length;
  });
  await page.evaluate(() => document.querySelector("#chat-list").scrollTo(0, 99999));
  const lastVisible = await page.evaluate(() => { const els = document.querySelectorAll("#chat-list .chat-item"); const el = els[els.length - 1]; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return top && el.contains(top); });
  R.ok("P-3", clickable >= 3 && lastVisible, `満杯でも受信トレイがスクロールでき、末尾まで押せる（初期表示で押せる件数 ${clickable}）`);
  R.ok("P-4", await page.locator(sel.finish).isVisible() && await page.locator(sel.pause).isVisible(), "満杯でも終了・一時停止に到達できる");

  // ---------- 4. ヒットボックス（モーダル貫通） ----------
  R.section("4 ヒットボックス（着信画面の背面が押せないこと）");
  if (!(await page.locator(sel.phone).count())) await page.waitForSelector(sel.phone, { timeout: 90000 });
  const finishBox = await page.locator(sel.finish).boundingBox();
  await page.mouse.click(finishBox.x + finishBox.width / 2, finishBox.y + finishBox.height / 2);
  await page.waitForTimeout(200);
  R.ok("AD-1", !(await page.locator(sel.result).count()) && (await page.locator(sel.phone).count()), "着信画面越しに「終了」を押しても効かない");
  const item = await page.locator(sel.chatItems).first().boundingBox();
  await page.mouse.click(item.x + 30, item.y + item.height / 2);
  await page.waitForTimeout(150);
  R.ok("AD-2", await page.locator(sel.phone).count(), "着信画面越しにチャットを押しても効かない");
  await page.mouse.click(5, 5);                                  // 背景クリック
  await page.waitForTimeout(150);
  R.ok("AD-3", await page.locator(sel.phone).count(), "背景クリックでは着信が消えない（応答/無視の判断を必ず求める）");
  await page.keyboard.press("Alt+Digit1"); await page.waitForTimeout(450);
  R.ok("AD-4", await page.locator(sel.phone).count(), "着信中に Alt+数字 を押しても背面が動かない");
  await page.click(sel.ignore); await page.waitForTimeout(150);
  await page.click(sel.finish); await page.click(sel.menu);

  // ---------- 5. 境界値 ----------
  R.section("5 境界値（残り時間0付近・一時停止と時間切れの競合）");
  {
    // 残り時間を強制的に短くするのは内部書き換えになるため、代わりに「一時停止中は時計が完全に止まる」ことを
    // 長めの停止で確かめ、時間切れ処理は e2e01 の実時間走行で検証する。
    await start(page, 2, 300);
    await page.waitForTimeout(1500);
    const a = secs(await page.locator(sel.timer).innerText());
    await page.click(sel.pause); await page.waitForTimeout(6000);
    const b = secs(await page.locator(sel.timer).innerText());
    await page.click(sel.resume);
    R.ok("AK-1", a === b, `6秒の一時停止中に時計が1秒も進まない (${a}=${b})`);
    // 時計の単調性（巻き戻らない）
    let prev = secs(await page.locator(sel.timer).innerText()), mono = true;
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); const now = secs(await page.locator(sel.timer).innerText()); if (now > prev) mono = false; prev = now; }
    R.ok("AK-2", mono, "時計が巻き戻らない");
    await page.click(sel.finish); await page.click(sel.menu);
  }

  // ---------- 6. シーケンスブレイク ----------
  R.section("6 シーケンスブレイク（想定外の順番）");
  await start(page, 1);
  await page.locator(sel.chatItems).nth(0).click(); await page.waitForTimeout(80);
  await page.click(sel.prio("high")); await page.waitForTimeout(450);
  await page.locator(sel.chatItems).nth(1).click(); await page.waitForTimeout(80);      // 途中で別のチャットへ
  await page.click(sel.prio("low")); await page.waitForTimeout(450);
  await page.locator(sel.chatItems).nth(0).click(); await page.waitForTimeout(80);      // 戻る
  R.ok("SB-1", (await page.locator("#chat-status-badge").innerText()).includes("保留 高"), "別チャットを経由しても最初の優先度が保持");
  await page.click(sel.redo); await page.waitForTimeout(80);
  await page.click(sel.prio("mid")); await page.waitForTimeout(450);
  await page.click(sel.option(0)); await page.waitForTimeout(100);
  await page.locator(sel.chatItems).nth(0).click(); await page.waitForTimeout(80);
  R.ok("SB-2", (await page.locator("#task-panel-content").innerText()).includes("処理済"), "選び直し→別優先度→完了 の経路が成立");
  // 処理済に対して Alt+数字 / Enter
  await page.keyboard.press("Alt+Digit1"); await page.waitForTimeout(450); await page.keyboard.press("Enter"); await page.waitForTimeout(80);
  R.ok("SB-3", (await page.locator("#task-panel-content").innerText()).includes("処理済"), "処理済に対するショートカットは無効");
  // 結果画面で Esc/Alt を連打しても何も起きない（要件S）
  await page.click(sel.finish); await page.waitForSelector(sel.result);
  const sc1 = await scoreText(page);
  for (let i = 0; i < 10; i++) { await page.keyboard.press("Escape"); await page.keyboard.press("Alt+Digit2"); await page.waitForTimeout(450); }
  await page.waitForTimeout(200);
  R.ok("S-1", sc1 === await scoreText(page) && (await page.locator(sel.result).count()), "結果画面でのキー連打で何も変化しない");
  // 「同じ条件でもう一度」→ 即「終了」→「メニュー」→ 別レベル
  await page.click(sel.retry); await page.waitForSelector(sel.game); await page.click(sel.finish); await page.waitForSelector(sel.result);
  await page.click(sel.menu); await page.waitForSelector(sel.start);
  await start(page, 3, 300);
  R.ok("SB-4", (await page.locator("#session-heading").innerText()) === "Level 3", "再挑戦→終了→メニュー→別レベル の遷移が正常");
  await page.click(sel.finish); await page.click(sel.menu);

  // ---------- 7. 乱数の統計検定 ----------
  R.section("7 乱数の統計検定（出題順・電話相手の偏り）");
  const firstSeen = {};
  for (let i = 0; i < 12; i++) {
    await start(page, 2, 300);
    const names = await page.evaluate(() => [...document.querySelectorAll("#chat-list .sender")].map((e) => e.textContent));
    names.forEach((n) => { firstSeen[n] = (firstSeen[n] || 0) + 1; });
    await page.click(sel.finish); await page.click(sel.menu);
  }
  const distinct = Object.keys(firstSeen).length;
  R.ok("RNG-1", distinct >= 12, `12回の開始で初期4件に現れた送信者の種類 ${distinct}/20（固定順でない）`);

  // ---------- 8. 文字列走査 ----------
  R.section("8 文字列走査（全画面の未解決値）");
  const BAD = /undefined|NaN|\[object|null(?![a-z])/;
  const hits = [];
  const scan = async (w) => { const t = await page.locator("body").innerText(); if (BAD.test(t)) hits.push(w + ":" + t.match(BAD)[0]); };
  await scan("開始"); await start(page, 3, 300); await scan("開始直後");
  await page.locator(sel.chatItems).first().click(); await scan("選択");
  await page.click(sel.prio("high")); await page.waitForTimeout(450); await scan("保留"); await page.click(sel.redo); await scan("選び直し");
  await page.click(sel.prio("low")); await page.waitForTimeout(450); await page.click(sel.noReply); await scan("完了直後");
  await page.locator("#chat-list .chat-item.completed").first().click(); await scan("処理済表示");
  await page.click(sel.pause); await scan("一時停止"); await page.click(sel.resume);
  await page.click(sel.finish); await page.waitForSelector(sel.result); await scan("結果");
  R.ok("AB-1", hits.length === 0, hits.length ? hits.join(" / ") : "未解決値なし");

  // ---------- 9. CPUスロットリング ----------
  R.section("9 CPUスロットリング（4倍遅い端末でも時計が正確か）");
  await page.click(sel.menu);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await start(page, 2, 300);
  const w0 = Date.now(); const c0 = secs(await page.locator(sel.timer).innerText());
  await page.waitForTimeout(8000);
  const c1 = secs(await page.locator(sel.timer).innerText()); const w1 = Date.now();
  const drift = Math.abs((c0 - c1) - (w1 - w0) / 1000);
  R.ok("CPU-1", drift <= 1.5, `4倍スロットリング下の8秒で誤差 ${drift.toFixed(1)} 秒`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.click(sel.finish); await page.click(sel.menu);

  // ---------- 10. ソーク（短縮版: 60秒の実時間との突合） ----------
  R.section("10 ソーク（60秒の時計ドリフト）");
  await start(page, 2, 300);
  const z0 = Date.now(); const k0 = secs(await page.locator(sel.timer).innerText());
  await page.waitForTimeout(60000);
  const k1 = secs(await page.locator(sel.timer).innerText());
  const d2 = Math.abs((k0 - k1) - (Date.now() - z0) / 1000);
  R.ok("SOAK-1", d2 <= 1.5, `60秒で誤差 ${d2.toFixed(1)} 秒`);
  await finish(page);

  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
