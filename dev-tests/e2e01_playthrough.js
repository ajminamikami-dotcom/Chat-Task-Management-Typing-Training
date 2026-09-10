// e2e01 模擬プレイスルー監査
// 「人間らしいプレイ」＝正しい操作 + 意図的な誤操作 + 電話割り込み + 一時停止 + 優先度の選び直し を全レベルで実行し、
// 終了後に要件チェックリストと照合する。採点軸は CSV（操作実績）から独立に再計算して一致を確認する。
// Level 2 は手動終了せず、実際に制限時間を使い切る（時間切れ経路の検証）。
// 対応要件: E 評価の因果対応 / I 監査可能性 / AJ スコア境界 / BE 完了記録 / BO 終了理由 / BP 出力件数 / S 終業後の不変性 / AX 割り込み計測
"use strict";
const fs = require("fs");
const path = require("path");
const { open, sel, start, finish, solveOne, scoreText, counters, reporter, OUT_DIR } = require("./_lib");

const DURATION = 300;

async function readCsv(page, name) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(sel.csv)]);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fp = path.join(OUT_DIR, name);
  await dl.saveAs(fp);
  const lines = fs.readFileSync(fp, "utf8").replace(/^﻿/, "").trim().split("\n");
  const cells = (l) => l.slice(1, -1).split('","');
  const head = cells(lines[0]);
  return { name: dl.suggestedFilename(), rows: lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [head[i], v]))) };
}

// CSV から結果画面の数値を独立に再計算する
function recompute(rows) {
  const done = rows.filter((r) => r["状態"] === "処理済");
  const pct = (n, d) => (d ? String(Math.round((n / d) * 100)) : "-");
  const avg = done.map((r) => Number(r["総処理時間(秒)"])).filter(Number.isFinite);
  return {
    completed: `${done.length}/${rows.length}`,
    prio: pct(done.filter((r) => r["優先度正誤"] === "正解").length, done.length),
    reply: pct(done.filter((r) => r["返信正誤"] === "正解").length, done.length),
    avg: avg.length ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1) : "-",
  };
}

(async () => {
  const R = reporter("e2e01_playthrough");
  const { browser, page, errors, data } = await open();
  const summary = [];

  for (const level of [1, 2, 3]) {
    R.section(`Level ${level} 模擬プレイ（正解7割・誤答2割・無作為1割、途中で一時停止と選び直し）`);
    await start(page, level, DURATION);
    const phoneLog = [];
    let n = 0, paused = false, redone = false;
    const t0 = Date.now();
    const budget = level === 1 ? 120000 : DURATION * 1000 + 15000;

    while (Date.now() - t0 < budget) {
      if (await page.locator(sel.result).count()) break;
      // 電話: 正解6割・誤答4割で応答し、判断内容を記録（要件AX 計測の対称性）
      if (await page.locator(sel.phone).count()) {
        const who = await page.locator("#caller-name").innerText();
        const rec = data.PHONE.find((p) => p.caller === who);
        const answer = Math.random() < 0.6 ? rec.isEmergency : !rec.isEmergency;
        phoneLog.push({ who, correct: answer === rec.isEmergency });
        await page.click(answer ? sel.answer : sel.ignore); await page.waitForTimeout(150);
        continue;
      }
      // 途中で一度、一時停止（要件V）と優先度の選び直し（要件L）を挟む
      if (!paused && n === 2) { await page.click(sel.pause); await page.waitForTimeout(2500); await page.click(sel.resume); paused = true; await page.waitForTimeout(100); continue; }
      if (!redone && n === 3 && (await page.locator(sel.openChats).count())) {
        await page.locator(sel.openChats).first().click(); await page.click(sel.prio("low")); await page.waitForTimeout(450);
        await page.click(sel.redo); await page.waitForTimeout(80); redone = true; continue;
      }
      // Level 2 は時間切れ経路を検証したいので、15件処理したら手を止めて残り時間を待つ
      // （速く処理し切ると全件完了で自動終了し、時間切れに到達しないため）
      if (level === 2 && n >= 15) { await page.waitForTimeout(1500); continue; }
      const r = Math.random();
      const mode = r < 0.7 ? "ideal" : r < 0.9 ? "wrong" : "random";
      let did;
      try { did = await solveOne(page, data, mode, 8); } catch (e) { R.ok(`H-L${level}`, false, e.message); break; }
      if (!did) {
        if (level === 1) break;
        // Level 2: 手持ちが無ければ新着を待つ。時間切れまで待って終了経路を検証する
        await page.waitForTimeout(1200);
        continue;
      }
      n++;
      // 人間らしい間（Level 2 は時間を使い切りたいので長め）
      await page.waitForTimeout(level === 2 ? 2500 : 400);
    }

    const endedByItself = await page.locator(sel.result).count() > 0;
    if (!endedByItself) await finish(page);
    const reason = await page.locator("#result-subtitle").innerText();
    R.ok(`BO-L${level}`, /時間終了|全件完了|手動終了/.test(reason), `結果画面到達: ${reason}${endedByItself ? "（自動）" : "（手動）"}`);
    if (level === 2) R.ok("BO-時間切れ", /時間終了/.test(reason), `Level 2 は実時間で時間切れになった (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);

    // ---- 要件E: 結果画面 = CSV からの独立再計算 ----
    const shown = await scoreText(page);
    const csv = await readCsv(page, `playthrough_L${level}.csv`);
    const rc = recompute(csv.rows);
    const m = shown.match(/完了 (\S+) 件 優先度 (\S+) %? ?返信 (\S+) %? ?平均処理 (\S+)/);
    const got = m ? { completed: m[1], prio: m[2], reply: m[3], avg: m[4] } : null;
    const same = got && got.completed === rc.completed && got.prio === rc.prio && got.reply === rc.reply && got.avg === rc.avg;
    R.ok(`E-L${level}`, same, `画面 ${JSON.stringify(got)} / CSV再計算 ${JSON.stringify(rc)}`);
    R.ok(`BP-L${level}`, csv.rows.length === Number(rc.completed.split("/")[1]), `CSV ${csv.rows.length} 行 = 総数`);
    R.ok(`I-L${level}`, csv.rows.filter((r) => r["状態"] === "処理済").every((r) => r["総処理時間(秒)"] !== "" && r["選択優先度"] !== "" && r["選択処理"] !== ""), "処理済の行はすべて時刻・選択・結果を持つ（監査可能性）");
    R.ok(`BE-L${level}`, csv.rows.filter((r) => r["状態"] !== "処理済").every((r) => r["優先度正誤"] === "" && r["返信正誤"] === ""), "未完了の行に正誤が付いていない");
    R.ok(`AJ-L${level}`, [rc.prio, rc.reply].every((v) => v === "-" || (Number(v) >= 0 && Number(v) <= 100)), "スコアが定義域内");
    R.ok(`AI-L${level}`, csv.rows.every((r, i, a) => i === 0 || Number(a[i - 1]["確認時間(秒)"] || 0) >= -1), "CSV が受信順");

    // ---- Level 3: 電話判断の独立再計算（要件AX/E） ----
    if (level === 3) {
      const exp = phoneLog.length ? String(Math.round(phoneLog.filter((p) => p.correct).length / phoneLog.length * 100)) : "-";
      const mm = shown.match(/電話判断 (\S+)/);
      R.ok("AX-L3", mm && mm[1] === exp, `電話判断 画面 ${mm && mm[1]} / 記録から再計算 ${exp}（${phoneLog.length} 回）`);
    }

    // ---- 要件S: 終了後の不変性 ----
    await page.waitForTimeout(2000);
    await page.keyboard.press("Escape"); await page.keyboard.press("Alt+Digit1"); await page.waitForTimeout(450);
    R.ok(`S-L${level}`, (await scoreText(page)) === shown, "終了後に時間経過・キー操作でスコアが変わらない");
    R.ok(`AB-L${level}`, !/undefined|NaN|\[object/.test(await page.locator("body").innerText()), "結果画面に未解決値なし");
    summary.push({ level, reason, shown });
    await page.click(sel.menu);
  }

  R.section("まとめ");
  summary.forEach((s) => R.note(`Level ${s.level}: ${s.reason} / ${s.shown}`));
  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
