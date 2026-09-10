// e2e03 進行不能（ソフトロック）探索
// 対応要件: AF 進行不能状態の不存在 / D 遷移経路の完全性 / CE 解決可能性の維持 / L 誤操作からの回復可能性 / O 配慮機能の不可侵性
// 手法: 無作為な操作列（モンキー）を全レベルで実行し、毎ステップ「いま正解に到達できるか」を機械判定する。
//       ランダムには一時停止・電話・優先度の選び直し・誤操作・連打を混ぜる。
"use strict";
const { open, sel, start, finish, solvabilityOracle, counters, reporter, handlePhoneIfAny } = require("./_lib");

const ROUNDS = Number(process.env.ROUNDS || 3);      // 1レベルあたりの試行回数
const STEPS = Number(process.env.STEPS || 120);       // 1試行あたりの操作数
const SEED = Number(process.env.SEED || 20260909);
const STEP_DELAY = Number(process.env.STEP_DELAY || 0);   // 操作間隔(ms)。電話・新着を発生させるには 500 以上
const LEVELS = (process.env.LEVELS || "1,2,3").split(",").map(Number);

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// 利用者が押せるものだけを候補にした無作為操作
async function randomAction(page, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  if (await page.locator("#pause-overlay.show").count()) {
    if (rnd() < 0.85) { await page.click(sel.resume); return "再開"; }
    await page.keyboard.press("Escape"); return "Esc(再開)";
  }
  if (await page.locator(sel.phone).count()) {
    const r = rnd();
    if (r < 0.4) { await page.click(sel.answer); return "電話:応答"; }
    if (r < 0.8) { await page.click(sel.ignore); return "電話:無視"; }
    if (r < 0.9) { await page.keyboard.press("Tab"); return "電話:Tab"; }
    await page.keyboard.press("Escape"); return "電話中にEsc(一時停止)";
  }
  const cands = [];
  const items = await page.locator(sel.chatItems).count();
  if (items) cands.push(async () => { const i = Math.floor(rnd() * items); await page.locator(sel.chatItems).nth(i).click(); return `チャット${i}を開く`; });
  for (const p of ["high", "mid", "low"]) if (await page.locator(sel.prio(p)).count()) cands.push(async () => { await page.click(sel.prio(p)); return `優先度:${p}`; });
  for (let i = 0; i < 3; i++) if (await page.locator(sel.option(i)).count()) cands.push(async () => { await page.click(sel.option(i)); return `選択肢${i}`; });
  if (await page.locator(sel.noReply).count()) cands.push(async () => { await page.click(sel.noReply); return "返信せずに完了"; });
  if (await page.locator(sel.redo).count()) cands.push(async () => { await page.click(sel.redo); return "優先度を選び直す"; });
  if (await page.locator(sel.input).count()) {
    cands.push(async () => { await page.locator(sel.input).type(pick(["あ", "承知", "いたしました。", "ｘ", " ", "😀"]), { delay: 2 }); return "入力"; });
    cands.push(async () => { await page.locator(sel.input).fill(""); return "入力クリア"; });
    cands.push(async () => { await page.locator(sel.input).press("Escape"); return "入力欄でEsc"; });
    if (!(await page.locator(sel.submit).isDisabled())) cands.push(async () => { await page.click(sel.submit); return "送信"; });
  }
  cands.push(async () => { await page.click(sel.pause); return "一時停止"; });
  cands.push(async () => { await page.keyboard.press("Escape"); return "Esc"; });
  cands.push(async () => { await page.keyboard.press("Alt+Digit" + (1 + Math.floor(rnd() * 3))); return "Alt+数字"; });
  cands.push(async () => { await page.keyboard.press("Tab"); return "Tab"; });
  cands.push(async () => { await page.keyboard.press("Enter"); return "Enter"; });
  cands.push(async () => { await page.mouse.dblclick(300 + rnd() * 600, 200 + rnd() * 400); return "画面をダブルクリック"; });
  return pick(cands)();
}

(async () => {
  const R = reporter("e2e03_softlock");
  const { browser, page, errors, data } = await open();
  const rnd = rng(SEED);
  let totalSteps = 0, stuck = 0;

  for (const level of LEVELS) {
    for (let round = 0; round < ROUNDS; round++) {
      R.section(`Level ${level} / 試行 ${round + 1} (${STEPS}操作)`);
      await page.click(sel.menu).catch(() => {});
      if (!(await page.locator(sel.start).count())) { await finish(page); await page.click(sel.menu); }
      await start(page, level, 300);
      const log = [];
      let ended = false;
      for (let s = 0; s < STEPS; s++) {
        if (await page.locator(sel.result).count()) { ended = true; break; }
        let what;
        try { what = await randomAction(page, rnd); } catch (e) { what = "操作失敗:" + e.message.split("\n")[0].slice(0, 60); }
        log.push(what);
        totalSteps++;
        if (STEP_DELAY) await page.waitForTimeout(STEP_DELAY);
        const problems = await solvabilityOracle(page);
        if (problems.length) {
          stuck++;
          R.ok(`AF-L${level}-${round}-${s}`, false, `進行不能候補: ${problems.join(" / ")}  直前の操作: ${log.slice(-5).join(" > ")}`);
          break;
        }
        // 表示計数の真実性を毎ステップ確認（要件T/G）
        if (!(await page.locator(sel.result).count()) && !(await page.locator("#pause-overlay.show").count())) {
          const c = await counters(page);
          if (c.unread + c.pending + c.completed !== c.listed || c.done + c.open !== c.listed) {
            R.ok(`T-L${level}-${round}-${s}`, false, `計数不一致 ${JSON.stringify(c)} 直前: ${log.slice(-3).join(" > ")}`);
          }
        }
      }
      // 最後に必ず終了経路が生きていることを確認（要件D）
      if (!ended) {
        try { await finish(page); ended = true; } catch (e) { R.ok(`D-L${level}-${round}`, false, "終了経路が壊れた: " + e.message.slice(0, 80)); }
      }
      if (ended) R.ok(`AF-L${level}-${round}`, true, `結果画面に到達（操作 ${log.length} 回、電話/停止/選び直し/誤操作を含む）`);
      const score = (await page.locator(sel.score).innerText()).replace(/\s+/g, " ");
      R.ok(`AB-L${level}-${round}`, !/undefined|NaN|\[object/.test(score), "結果表示に未解決値なし: " + score);
    }
  }

  R.section("まとめ");
  R.ok("AF-総計", stuck === 0, `無作為操作 ${totalSteps} 回で進行不能候補 ${stuck} 件`);
  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
